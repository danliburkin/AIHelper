/**
 * R3 — the briefing assembler. Each turn, compose the prompt from the relevant,
 * currently-valid slice of the record. No embeddings, no semantic search — just
 * the ordered filter the spec lays out:
 *
 *   1. Status gate (deterministic): active / open / revived only.
 *   2. Tag match: intersect tags[] with the current topic tags. Fall back to the
 *      whole pool if no records match — better an over-broad briefing than an
 *      empty one.
 *   3. Recency: prefer newer updated_at.
 *   4. Ambient always-in: include all ambient records whose intensity is not stale.
 *   5. Hard cap: drop lowest confidence first, then oldest, until the assembled
 *      text fits the token budget. Ambient is protected from this pruning.
 *
 * Supersession is honoured both ways: records with provenance=stale_superseded
 * are dropped entirely, and live records that supersede an older one emit an
 * explicit "no-longer-true" note pointing at the superseded id.
 */

import { toStatefulRecord, toAmbientRecord } from './records.js';

const ACTIVE_STATUSES = new Set(['active', 'open', 'revived']);
const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'is', 'are', 'was', 'were', 'be', 'been',
  'i', 'me', 'my', 'mine', 'you', 'your', 'yours', 'we', 'us', 'our',
  'this', 'that', 'these', 'those', 'it', 'its',
  'to', 'of', 'in', 'on', 'for', 'with', 'as', 'at', 'by', 'from', 'into',
  'do', 'does', 'did', 'has', 'have', 'had',
  'what', 'how', 'why', 'when', 'where', 'who', 'which',
  'should', 'would', 'could', 'will', 'can', 'may', 'might',
  'about', 'into', 'over', 'than', 'then', 'so', 'if', 'but', 'not',
]);

const CONF_RANK = { high: 0, medium: 1, low: 2 };
const DEFAULT_TOKEN_BUDGET = 1500;
const CHARS_PER_TOKEN = 4;
const ELAPSED_GAP_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/**
 * Derive topic tags for the current turn:
 *   1. Any explicit #tags in the question take priority.
 *   2. Otherwise: tokenize the question and intersect with the set of tags
 *      already in the record. This is exactly the cheap set lookup the spec calls
 *      for — no inference, no embeddings.
 */
export function deriveTopicTags(questionText, knownTags) {
  const text = String(questionText || '');
  const explicit = [...text.matchAll(/#([a-z][a-z0-9_-]*)/gi)].map((m) => m[1].toLowerCase());
  if (explicit.length > 0) return [...new Set(explicit)];

  const tokens = tokenize(text);
  const known = (knownTags || []).map((t) => String(t).toLowerCase());
  const matched = [];
  const seen = new Set();
  for (const tag of known) {
    if (tokens.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      matched.push(tag);
    }
  }
  return matched;
}

function allKnownTags(state) {
  const out = new Set();
  for (const board of [state.memory, state.facts, state.assumptions, state.ambient || []]) {
    for (const item of board) {
      for (const tag of item.tags || []) out.add(String(tag).toLowerCase());
    }
  }
  return [...out];
}

function statefulCandidates(state) {
  // Items the user has toggled off in the UI (`active === false`) are revoked —
  // they must not appear in the briefing. The revocation handling in
  // `prompts.js` is what tells the chatbot to DELETE those items from its prior
  // reasoning.
  const out = [];
  for (const m of state.memory) if (m.active !== false) out.push(toStatefulRecord(m, 'memory'));
  for (const f of state.facts) if (f.active !== false) out.push(toStatefulRecord(f, 'facts'));
  for (const a of state.assumptions) if (a.active !== false) out.push(toStatefulRecord(a, 'assumptions'));
  return out;
}

function ambientCandidates(state) {
  return (state.ambient || [])
    .filter((x) => x.active !== false && x.intensity !== 'stale')
    .map(toAmbientRecord);
}

function compareRecency(a, b) {
  const av = a.updated_at || a.created_at || '';
  const bv = b.updated_at || b.created_at || '';
  if (av === bv) return 0;
  return av < bv ? 1 : -1;
}

function compareForPruning(a, b) {
  const ca = CONF_RANK[a.confidence] ?? 1;
  const cb = CONF_RANK[b.confidence] ?? 1;
  if (ca !== cb) return ca - cb;
  return compareRecency(a, b);
}

function tagSuffix(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return ' [' + tags.map((t) => `#${t}`).join(' ') + ']';
}

function renderStateful(rec) {
  const board = rec.board;
  const status = rec.status ? `(${rec.status})` : '';
  const confidence = rec.confidence ? ` ⟨${rec.confidence} conf⟩` : '';
  const provenance = rec.provenance ? ` ⟨${rec.provenance}⟩` : '';
  const id = rec.id ? ` id=${rec.id}` : '';
  return `- ${status} [${board}]${id} ${rec.text}${confidence}${provenance}${tagSuffix(rec.tags)}`;
}

function renderAmbient(rec) {
  const intensity = rec.intensity ? ` (intensity: ${rec.intensity})` : '';
  return `- ${rec.text}${intensity}${tagSuffix(rec.tags)}`;
}

/**
 * Find supersession edges so we can emit a no-longer-true line for the older record
 * when its newer replacement still appears in the briefing.
 */
function collectSupersession(allStateful) {
  const newerForOlder = new Map();
  const byId = new Map(allStateful.map((r) => [r.id, r]));
  for (const rec of allStateful) {
    for (const link of rec.links || []) {
      if (link.rel === 'supersedes' && link.target_id) {
        newerForOlder.set(link.target_id, rec.id);
      } else if (link.rel === 'updated_by' && link.target_id) {
        newerForOlder.set(rec.id, link.target_id);
      }
    }
  }
  return { newerForOlder, byId };
}

function formatElapsed(prevIso, nowIso) {
  if (!prevIso) return null;
  const prev = new Date(prevIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(prev) || !Number.isFinite(now) || now <= prev) return null;
  const ms = now - prev;
  if (ms < ELAPSED_GAP_HOURS * HOUR_MS) return null;
  if (ms < DAY_MS) {
    const hours = Math.round(ms / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.round(ms / DAY_MS);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Build the briefing. Pure function over (state, opts) — no I/O.
 *
 * @param {object} state - engine state
 * @param {object} [opts]
 * @param {string} [opts.questionText] - the user's current question; used to derive topic tags
 * @param {string[]} [opts.topicTags] - explicit override of the derived topic tags
 * @param {number} [opts.tokenBudget=1500] - approximate token cap (~ 4 chars/token)
 * @param {string} [opts.now] - ISO timestamp for "now"; defaults to current time
 * @param {string} [opts.lastActivityAt] - ISO of the last meaningful activity; used for elapsed line
 * @returns {{ text: string, meta: object }}
 */
export function buildBriefing(state, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const tokenBudget = opts.tokenBudget || DEFAULT_TOKEN_BUDGET;
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  const knownTags = allKnownTags(state);
  const topicTags = Array.isArray(opts.topicTags)
    ? opts.topicTags.map((t) => String(t).toLowerCase())
    : deriveTopicTags(opts.questionText, knownTags);

  const allStateful = statefulCandidates(state);

  // Gate 1: status + drop stale_superseded provenance.
  let pool = allStateful.filter(
    (r) => ACTIVE_STATUSES.has(r.status) && r.provenance !== 'stale_superseded',
  );

  // Gate 2: tag match (deterministic set intersection). Fall back to the whole pool
  // when nothing matches, so a fresh-topic thread still gets a briefing.
  let tagFallback = false;
  if (topicTags.length > 0) {
    const want = new Set(topicTags);
    const matched = pool.filter((r) => (r.tags || []).some((t) => want.has(String(t).toLowerCase())));
    if (matched.length > 0) {
      pool = matched;
    } else {
      tagFallback = true;
    }
  }

  // Gate 3: recency display order.
  pool.sort(compareRecency);

  // Gate 4: ambient always-in (after the topic filter; ambient is independent of tags).
  const ambient = ambientCandidates(state);

  // Gate 5: token cap. Ambient is protected; trim stateful items by (low conf first,
  // then oldest). Iterate BEST-to-WORST and keep whatever fits; everything that
  // doesn't fit is dropped — which is exactly "drop lowest confidence first, then oldest".
  const ambientText = ambient.map(renderAmbient).join('\n');
  let remainingBudget = charBudget - ambientText.length;

  const keepOrder = [...pool].sort(compareForPruning); // best-to-keep first
  const keptSet = new Set();
  const dropped = [];
  for (const rec of keepOrder) {
    const renderedLen = renderStateful(rec).length + 1;
    if (renderedLen <= remainingBudget) {
      keptSet.add(rec.id);
      remainingBudget -= renderedLen;
    } else {
      dropped.push(rec);
    }
  }
  const kept = pool.filter((r) => keptSet.has(r.id));

  // Supersession notes.
  const { newerForOlder, byId } = collectSupersession(allStateful);
  const supersessionNotes = [];
  for (const rec of kept) {
    for (const link of rec.links || []) {
      if (link.rel === 'supersedes' && link.target_id) {
        const older = byId.get(link.target_id);
        if (older) {
          supersessionNotes.push(
            `- NO LONGER TRUE: ${older.text} (id=${older.id}) — superseded by ${rec.text}`,
          );
        }
      }
    }
  }
  // Also emit a note for any item flagged stale_superseded that has a newer counterpart.
  for (const stale of allStateful.filter((r) => r.provenance === 'stale_superseded')) {
    const newerId = newerForOlder.get(stale.id);
    if (newerId && byId.get(newerId)) {
      supersessionNotes.push(
        `- NO LONGER TRUE: ${stale.text} (id=${stale.id}) — superseded by ${byId.get(newerId).text}`,
      );
    } else {
      supersessionNotes.push(`- NO LONGER TRUE: ${stale.text} (id=${stale.id})`);
    }
  }

  // Time awareness.
  const elapsed = formatElapsed(opts.lastActivityAt, now);

  // Assemble.
  const lines = [];
  lines.push('===BRIEFING===');
  lines.push('You have a longitudinal record. Use ONLY the items below as binding context.');
  lines.push('The user — not you — is the authority over this record. Do not pretend an item is here that is not.');
  if (elapsed) {
    lines.push(`Time elapsed since last activity: ${elapsed}. Do not assume things stood still during the gap.`);
  }
  if (topicTags.length > 0) {
    lines.push(`Topic tags for this turn: ${topicTags.map((t) => `#${t}`).join(' ')}${tagFallback ? ' (no matches found — falling back to whole active record)' : ''}`);
  } else {
    lines.push('Topic tags for this turn: (none derived — whole active record included)');
  }
  lines.push('');

  lines.push('## Active stateful record');
  if (kept.length === 0) {
    lines.push('_(none active)_');
  } else {
    for (const r of kept) lines.push(renderStateful(r));
  }
  lines.push('');

  lines.push('## Ambient context (always shown)');
  if (ambient.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const a of ambient) lines.push(renderAmbient(a));
  }

  if (supersessionNotes.length > 0) {
    lines.push('');
    lines.push('## Supersession — items that are NO LONGER TRUE');
    for (const note of supersessionNotes) lines.push(note);
  }

  if (dropped.length > 0) {
    lines.push('');
    lines.push(`_(${dropped.length} lower-confidence/older item${dropped.length === 1 ? '' : 's'} omitted to fit the token budget)_`);
  }

  lines.push('===END_BRIEFING===');

  return {
    text: lines.join('\n'),
    meta: {
      keptCount: kept.length,
      droppedCount: dropped.length,
      ambientCount: ambient.length,
      topicTags,
      tagFallback,
      elapsed,
      supersessionCount: supersessionNotes.length,
    },
  };
}
