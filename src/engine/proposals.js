/**
 * R4 — propose-and-confirm. The model proposes record changes; the user commits.
 *
 * The user is the only authority on the record. Proposals never auto-apply.
 *
 * Wire format (parsed off the chatbot reply):
 *
 *   ===PROPOSE===
 *   - mark <id> <status> | rationale: <one-liner>
 *   - supersede <old_id> with <new_id> | rationale: <one-liner>
 *   - new <board>: <text> | tags: t1,t2 | rationale: <one-liner>
 *   - tag <id> <comma-separated tags> | rationale: <one-liner>
 *   ===END===
 *
 * Where:
 *   - <board> is one of memory | facts | assumptions
 *   - <status> is one of the R1 statuses (active | open | done | dropped | revived)
 *   - <id> may be an existing record id or a freshly proposed id (with the prefix
 *     `prop-`) referenced by a sibling proposal in the same batch
 *
 * High-impact rule: any proposal touching a record tagged with one of the
 * HIGH_IMPACT_TAGS, or referencing a record of kind `goal` / `decision`, is
 * flagged `requiresIndividualConfirm=true`. The UI surfaces this flag and
 * "Accept all" must skip them.
 */

import { isValidStatus } from './records.js';

const PROPOSE_START = '===PROPOSE===';
const PROPOSE_END = '===END===';
const VALID_BOARDS = new Set(['memory', 'facts', 'assumptions']);

export const HIGH_IMPACT_TAGS = Object.freeze([
  'health',
  'medical',
  'financial',
  'money',
  'finance',
  'legal',
]);

const HIGH_IMPACT_KINDS = new Set(['goal', 'decision']);

function newProposalId() {
  return 'p_' + Math.random().toString(36).slice(2, 10);
}

function extractTrailingRationale(body) {
  const m = body.match(/^(.*?)(?:\s*\|\s*rationale:\s*(.+?))?\s*$/i);
  if (!m) return { rest: body.trim(), rationale: '' };
  return { rest: (m[1] || '').trim(), rationale: (m[2] || '').trim() };
}

function extractTrailingTags(body) {
  const m = body.match(/^(.*?)\s*\|\s*tags:\s*(.+?)\s*$/i);
  if (!m) return { rest: body.trim(), tags: [] };
  const tags = m[2]
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return { rest: m[1].trim(), tags };
}

function parseLine(rawLine) {
  const body = rawLine.replace(/^-\s*/, '').trim();
  if (!body) return null;

  // Strip rationale first (it's the rightmost optional field).
  const { rest: afterRationale, rationale } = extractTrailingRationale(body);

  // "mark <id> <status>"
  const markMatch = afterRationale.match(/^mark\s+(\S+)\s+([a-z_]+)\s*$/i);
  if (markMatch) {
    const status = markMatch[2].toLowerCase();
    if (!isValidStatus(status)) return null;
    return {
      type: 'mark_status',
      target_id: markMatch[1],
      status,
      rationale,
    };
  }

  // "supersede <old_id> with <new_id>"
  const supMatch = afterRationale.match(/^supersede\s+(\S+)\s+with\s+(\S+)\s*$/i);
  if (supMatch) {
    return {
      type: 'supersede',
      target_id: supMatch[1],
      new_id: supMatch[2],
      rationale,
    };
  }

  // "tag <id> <tags>"
  const tagMatch = afterRationale.match(/^tag\s+(\S+)\s+(.+?)\s*$/i);
  if (tagMatch) {
    const tags = tagMatch[2]
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return null;
    return {
      type: 'tag',
      target_id: tagMatch[1],
      tags,
      rationale,
    };
  }

  // "new <board>: <text> | tags: ..."
  const newMatch = afterRationale.match(/^new\s+(memory|facts|assumptions)\s*:\s*(.+?)\s*$/i);
  if (newMatch) {
    const board = newMatch[1].toLowerCase();
    if (!VALID_BOARDS.has(board)) return null;
    const { rest: text, tags } = extractTrailingTags(newMatch[2]);
    if (!text) return null;
    return {
      type: 'new',
      board,
      text,
      tags,
      rationale,
    };
  }

  return null;
}

/**
 * Parse model-proposed record changes out of a chatbot reply.
 * @param {string} text
 * @returns {Array<object>} proposals
 */
export function parseProposals(text) {
  if (!text || typeof text !== 'string') return [];

  const startIdx = text.indexOf(PROPOSE_START);
  if (startIdx === -1) return [];

  // ===END=== is shared with the block format; we scan forward from PROPOSE_START.
  const afterStart = startIdx + PROPOSE_START.length;
  const endIdx = text.indexOf(PROPOSE_END, afterStart);
  const section = text.slice(afterStart, endIdx === -1 ? text.length : endIdx);

  const proposals = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('-')) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    proposals.push({
      id: newProposalId(),
      created_at: new Date().toISOString(),
      requiresIndividualConfirm: false,
      ...parsed,
    });
  }
  return proposals;
}

/**
 * Tag each proposal with `requiresIndividualConfirm` based on whether its
 * target is high-impact (health / financial / legal / kind=goal|decision).
 * Mutates the proposals array in place.
 */
export function annotateImpact(proposals, state) {
  const findItem = (id) => {
    for (const board of [state.memory, state.facts, state.assumptions]) {
      const item = board.find((x) => x.id === id);
      if (item) return item;
    }
    return null;
  };

  for (const p of proposals) {
    let highImpact = false;
    let target = null;
    if (p.type === 'new') {
      highImpact = (p.tags || []).some((t) => HIGH_IMPACT_TAGS.includes(String(t).toLowerCase()));
    } else if (p.target_id) {
      target = findItem(p.target_id);
      if (target) {
        const tags = target.tags || [];
        const isHighTag = tags.some((t) => HIGH_IMPACT_TAGS.includes(String(t).toLowerCase()));
        const isHighKind = HIGH_IMPACT_KINDS.has(target.kind);
        // Marking a goal/decision as done or dropped is irreversibly high-impact.
        const isLifecycleChange =
          p.type === 'mark_status' && ['done', 'dropped'].includes(p.status);
        highImpact = isHighTag || (isHighKind && isLifecycleChange);
      }
    }
    p.requiresIndividualConfirm = highImpact;
  }
}

/**
 * Apply a single proposal to engine state. Pure mutation, no I/O.
 * Returns { applied: boolean, reason?: string }.
 *
 * Resolves proposal-local ids (`prop-...` in supersede references) against
 * `localIdMap` so a `new` proposal accepted earlier in the same batch can be
 * referenced by a sibling `supersede` proposal.
 *
 * @param {object} state
 * @param {object} proposal
 * @param {Map<string,string>} [localIdMap] - proposal id -> created record id
 */
export function applyProposal(state, proposal, localIdMap = new Map()) {
  const now = new Date().toISOString();
  const findItem = (id) => {
    for (const board of [state.memory, state.facts, state.assumptions]) {
      const item = board.find((x) => x.id === id);
      if (item) return { item, board };
    }
    return null;
  };

  function resolveId(id) {
    return localIdMap.get(id) || id;
  }

  if (proposal.type === 'mark_status') {
    const realId = resolveId(proposal.target_id);
    const found = findItem(realId);
    if (!found) return { applied: false, reason: `unknown target id: ${proposal.target_id}` };
    found.item.status = proposal.status;
    found.item.provenance = 'model_proposed_user_confirmed';
    found.item.updated_at = now;
    return { applied: true, target_id: realId };
  }

  if (proposal.type === 'tag') {
    const realId = resolveId(proposal.target_id);
    const found = findItem(realId);
    if (!found) return { applied: false, reason: `unknown target id: ${proposal.target_id}` };
    const existing = new Set(found.item.tags || []);
    for (const tag of proposal.tags) existing.add(tag);
    found.item.tags = [...existing];
    found.item.provenance = 'model_proposed_user_confirmed';
    found.item.updated_at = now;
    return { applied: true, target_id: realId };
  }

  if (proposal.type === 'supersede') {
    const oldRealId = resolveId(proposal.target_id);
    const newRealId = resolveId(proposal.new_id);
    const oldFound = findItem(oldRealId);
    const newFound = findItem(newRealId);
    if (!oldFound || !newFound) {
      return {
        applied: false,
        reason: `supersede missing target(s): ${proposal.target_id} / ${proposal.new_id}`,
      };
    }
    // Mark the older one stale and link both directions.
    oldFound.item.provenance = 'stale_superseded';
    oldFound.item.status = 'dropped';
    oldFound.item.updated_at = now;
    oldFound.item.links = oldFound.item.links || [];
    if (!oldFound.item.links.some((l) => l.rel === 'updated_by' && l.target_id === newRealId)) {
      oldFound.item.links.push({ rel: 'updated_by', target_id: newRealId });
    }
    newFound.item.links = newFound.item.links || [];
    if (!newFound.item.links.some((l) => l.rel === 'supersedes' && l.target_id === oldRealId)) {
      newFound.item.links.push({ rel: 'supersedes', target_id: oldRealId });
    }
    newFound.item.provenance = 'model_proposed_user_confirmed';
    newFound.item.updated_at = now;
    return { applied: true, target_id: oldRealId, new_id: newRealId };
  }

  if (proposal.type === 'new') {
    const board = state[proposal.board];
    if (!Array.isArray(board)) {
      return { applied: false, reason: `unknown board: ${proposal.board}` };
    }
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'r_' + Math.random().toString(36).slice(2, 10);
    const created = {
      id,
      active: true,
      tags: proposal.tags || [],
      links: [],
      status: 'active',
      provenance: 'model_proposed_user_confirmed',
      confidence: 'medium',
      created_at: now,
      updated_at: now,
    };
    if (proposal.board === 'memory') {
      created.kind = 'fact';
      created.committedText = proposal.text;
      created.originalText = proposal.text;
      created.source = 'model_proposed';
    } else if (proposal.board === 'facts') {
      created.kind = 'fact';
      created.type = 'computed';
      created.content = proposal.text;
    } else if (proposal.board === 'assumptions') {
      created.kind = 'open_question';
      created.status = 'open';
      created.statement = proposal.text;
      created.reason = 'model_proposed';
    }
    board.push(created);
    if (proposal.id) localIdMap.set(proposal.id, id);
    return { applied: true, target_id: id };
  }

  return { applied: false, reason: `unknown proposal type: ${proposal.type}` };
}
