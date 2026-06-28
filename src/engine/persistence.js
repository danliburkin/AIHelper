/**
 * R2 — local persistence. One user-owned file (Markdown with an embedded JSON
 * snapshot) round-trips the full record: every field including status,
 * timestamps, provenance, tags, links. No backend, no localStorage.
 *
 * File format:
 *   - The top of the file is a human-readable Markdown render of the record
 *     (active goals, timeline, ambient context). This is also the R2 "rendered
 *     view" — same renderer is used in the UI panel.
 *   - At the bottom an HTML comment block holds the canonical JSON envelope.
 *     Importers prefer this comment; pure-JSON files are also accepted.
 */

const FORMAT = 'context-lens-record';
const VERSION = 1;
const JSON_FENCE_RE = /<!--\s*CONTEXT_LENS_RECORD\s*([\s\S]+?)\s*-->/;

function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepClone);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = deepClone(v);
  return out;
}

/**
 * Build the canonical snapshot envelope from engine state.
 * Boards keep their full per-board shape so import is loss-free.
 */
export function buildSnapshot(state) {
  return {
    format: FORMAT,
    version: VERSION,
    exported_at: new Date().toISOString(),
    originalTask: state.originalTask || '',
    topic: state.topic || '',
    memory: state.memory.map(deepClone),
    facts: state.facts.map(deepClone),
    assumptions: state.assumptions.map(deepClone),
    ambient: (state.ambient || []).map(deepClone),
  };
}

/**
 * Apply a previously built snapshot back onto engine state. Mutates state in place.
 * @throws Error on unrecognised format.
 */
export function applySnapshot(state, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Snapshot is empty or not an object.');
  }
  if (snapshot.format !== FORMAT) {
    throw new Error(`Unrecognised format: expected "${FORMAT}", got "${snapshot.format}".`);
  }
  if (typeof snapshot.version !== 'number') {
    throw new Error('Snapshot has no version number.');
  }

  state.originalTask = snapshot.originalTask || '';
  state.topic = snapshot.topic || '';
  state.memory = (snapshot.memory || []).map(deepClone);
  state.facts = (snapshot.facts || []).map(deepClone);
  state.assumptions = (snapshot.assumptions || []).map(deepClone);
  state.ambient = (snapshot.ambient || []).map(deepClone);
  state.hasCorrectiveEdits = false;
}

function tagsSuffix(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return ' ' + tags.map((t) => `#${t}`).join(' ');
}

function statefulBadge(item) {
  const parts = [];
  if (item.status) parts.push(item.status);
  if (item.confidence) parts.push(`${item.confidence} conf`);
  if (parts.length === 0) return '';
  return ` _(${parts.join(' · ')})_`;
}

function memoryLine(item) {
  const text = item.committedText || item.originalText || '';
  return `- ${text}${statefulBadge(item)}${tagsSuffix(item.tags)}`;
}

function factLine(item) {
  if (item.type === 'retrieved') {
    const meta = [item.sourceUrl, item.sourceDate].filter(Boolean).join(' · ');
    return `- [retrieved] ${item.content}${meta ? ` (${meta})` : ''}${statefulBadge(item)}${tagsSuffix(item.tags)}`;
  }
  return `- [computed] ${item.content}${statefulBadge(item)}${tagsSuffix(item.tags)}`;
}

function assumptionLine(item) {
  return `- ${item.statement} — likely because: ${item.reason}${statefulBadge(item)}${tagsSuffix(item.tags)}`;
}

function ambientLine(item) {
  const intensity = item.intensity ? ` _(intensity: ${item.intensity})_` : '';
  return `- ${item.text}${intensity}${tagsSuffix(item.tags)}`;
}

const ACTIVE_STATUSES = new Set(['active', 'open', 'revived']);
const ARCHIVED_STATUSES = new Set(['done', 'dropped']);

function classifyStateful(items) {
  const active = [];
  const archived = [];
  const stale = [];
  for (const item of items) {
    if (item.provenance === 'stale_superseded') stale.push(item);
    else if (ARCHIVED_STATUSES.has(item.status)) archived.push(item);
    else if (ACTIVE_STATUSES.has(item.status)) active.push(item);
    else active.push(item);
  }
  return { active, archived, stale };
}

/**
 * Render a snapshot as a Markdown body — same renderer is reused for the in-app
 * read-only "Record view" panel via `renderSnapshotMarkdown`.
 */
export function renderSnapshotMarkdown(snapshot) {
  const lines = [];
  lines.push(`# Context Lens record`);
  lines.push('');
  lines.push(`_Exported ${snapshot.exported_at}_`);
  if (snapshot.originalTask) {
    lines.push('');
    lines.push(`> **Question / topic:** ${snapshot.originalTask}`);
  }
  lines.push('');

  const memory = classifyStateful(snapshot.memory || []);
  const facts = classifyStateful(snapshot.facts || []);
  const assumptions = classifyStateful(snapshot.assumptions || []);

  lines.push('## Active goals & memory');
  if (memory.active.length === 0) lines.push('_None._');
  else memory.active.forEach((m) => lines.push(memoryLine(m)));
  lines.push('');

  lines.push('## Active facts');
  if (facts.active.length === 0) lines.push('_None._');
  else facts.active.forEach((f) => lines.push(factLine(f)));
  lines.push('');

  lines.push('## Open questions / assumptions');
  if (assumptions.active.length === 0) lines.push('_None._');
  else assumptions.active.forEach((a) => lines.push(assumptionLine(a)));
  lines.push('');

  lines.push('## Ambient context');
  const ambient = (snapshot.ambient || []).filter((x) => x.intensity !== 'stale');
  if (ambient.length === 0) lines.push('_None._');
  else ambient.forEach((x) => lines.push(ambientLine(x)));
  lines.push('');

  const archived = [...memory.archived, ...facts.archived, ...assumptions.archived];
  const stale = [...memory.stale, ...facts.stale, ...assumptions.stale, ...(snapshot.ambient || []).filter((x) => x.intensity === 'stale')];

  if (archived.length > 0) {
    lines.push('## Done / dropped (collapsed)');
    for (const item of archived) {
      if (item.committedText) lines.push(memoryLine(item));
      else if (item.statement) lines.push(assumptionLine(item));
      else lines.push(factLine(item));
    }
    lines.push('');
  }

  if (stale.length > 0) {
    lines.push('## Stale / superseded (collapsed)');
    for (const item of stale) {
      if (item.committedText) lines.push(memoryLine(item));
      else if (item.statement) lines.push(assumptionLine(item));
      else if (item.text && !item.type) lines.push(ambientLine(item));
      else lines.push(factLine(item));
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Produce the full export file: human-readable markdown + embedded JSON.
 */
export function snapshotToMarkdown(snapshot) {
  const body = renderSnapshotMarkdown(snapshot);
  const json = JSON.stringify(snapshot, null, 2);
  return `${body}\n---\n\n<!-- CONTEXT_LENS_RECORD\n${json}\n-->\n`;
}

/**
 * Parse a Context Lens record file. Accepts both Markdown-wrapped exports and
 * pure-JSON files. Throws on malformed input.
 */
export function snapshotFromMarkdown(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty file.');
  }
  const m = text.match(JSON_FENCE_RE);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch (err) {
      throw new Error(`Embedded JSON is malformed: ${err.message}`);
    }
  }
  // fall back to whole-file JSON
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('No Context Lens record JSON found (looked for HTML comment and pure JSON).');
  }
}
