/**
 * Typed record schema for the longitudinal ledger (R1).
 *
 * Two record types coexist:
 *   - stateful: discrete things with a lifecycle (goal / fact / decision / task / open_question)
 *   - ambient:  soft context (mood, tone, standing constraints) — no status, decays via intensity
 *
 * The board items (memory / facts / assumptions / ambient) keep their existing shape and
 * are extended in-place with these typed fields. `toStatefulRecord` / `toAmbientRecord`
 * produce the canonical shape used by tests, persistence (R2), and the briefing assembler (R3).
 */

export const STATUSES = Object.freeze(['open', 'active', 'done', 'dropped', 'revived']);

export const KINDS = Object.freeze(['goal', 'fact', 'decision', 'task', 'open_question']);

export const PROVENANCES = Object.freeze([
  'user_asserted',
  'model_proposed_user_confirmed',
  'inferred_from_tool',
  'stale_superseded',
]);

export const CONFIDENCES = Object.freeze(['high', 'medium', 'low']);

export const INTENSITIES = Object.freeze(['low', 'medium', 'high', 'stale']);

export const LINK_RELATIONS = Object.freeze(['depends_on', 'updated_by', 'supersedes']);

const WEAK_PROVENANCE = new Set(['stale_superseded']);

export function isValidStatus(value) {
  return STATUSES.includes(value);
}

export function isValidKind(value) {
  return KINDS.includes(value);
}

export function isValidProvenance(value) {
  return PROVENANCES.includes(value);
}

export function isValidConfidence(value) {
  return CONFIDENCES.includes(value);
}

export function isValidIntensity(value) {
  return INTENSITIES.includes(value);
}

/**
 * Defaults for an item coming from a given board, before any user action.
 * @param {'memory' | 'facts' | 'assumptions'} board
 * @param {object} [hints] - per-item hints, e.g. { factType: 'retrieved' | 'computed' }
 */
export function defaultsForBoard(board, hints = {}) {
  if (board === 'memory') {
    return {
      kind: 'fact',
      status: 'active',
      provenance: 'model_proposed_user_confirmed',
      confidence: 'low',
    };
  }
  if (board === 'facts') {
    if (hints.factType === 'retrieved') {
      return {
        kind: 'fact',
        status: 'active',
        provenance: 'inferred_from_tool',
        confidence: 'high',
      };
    }
    return {
      kind: 'fact',
      status: 'active',
      provenance: 'model_proposed_user_confirmed',
      confidence: 'medium',
    };
  }
  if (board === 'assumptions') {
    return {
      kind: 'open_question',
      status: 'open',
      provenance: 'model_proposed_user_confirmed',
      confidence: 'low',
    };
  }
  throw new Error(`Unknown board: ${board}`);
}

/**
 * Apply (or merge) typed-record fields onto a board item in place. The legacy fields
 * (committedText, content, statement, reason, etc.) are left alone — this only adds the
 * R1 fields with safe defaults.
 *
 * @param {object} item
 * @param {'memory' | 'facts' | 'assumptions'} board
 * @param {object} [parsedMeta] - meta parsed off the reply line: { status, confidence, provenance, tags }
 * @param {object} [hints]
 */
export function applyRecordDefaults(item, board, parsedMeta = {}, hints = {}) {
  const defaults = defaultsForBoard(board, hints);
  const now = new Date().toISOString();

  if (!item.kind) item.kind = defaults.kind;
  if (!item.status) {
    item.status = isValidStatus(parsedMeta.status) ? parsedMeta.status : defaults.status;
  }
  if (!item.provenance) {
    item.provenance = isValidProvenance(parsedMeta.provenance)
      ? parsedMeta.provenance
      : defaults.provenance;
  }
  if (!item.confidence) {
    item.confidence = isValidConfidence(parsedMeta.confidence)
      ? parsedMeta.confidence
      : defaults.confidence;
  }
  if (!Array.isArray(item.tags)) {
    item.tags = Array.isArray(parsedMeta.tags) ? [...parsedMeta.tags] : [];
  }
  if (!Array.isArray(item.links)) item.links = [];
  if (!item.created_at) item.created_at = now;
  if (!item.updated_at) item.updated_at = now;

  return item;
}

/**
 * Build a fresh ambient record. Ambient items have no `status` — that's the whole point.
 * @param {{ text: string, intensity?: string, tags?: string[] }} input
 */
export function createAmbientRecord(input) {
  const now = new Date().toISOString();
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : randomId(),
    kind: 'ambient',
    text: String(input.text || '').trim(),
    intensity: isValidIntensity(input.intensity) ? input.intensity : 'medium',
    tags: Array.isArray(input.tags) ? [...input.tags] : [],
    created_at: now,
    last_seen_at: now,
    active: true,
  };
}

/**
 * Canonical text accessor — abstracts away the per-board legacy field names.
 */
export function recordText(item, board) {
  if (board === 'memory') return item.committedText || item.originalText || item.text || '';
  if (board === 'facts') return item.content || item.text || '';
  if (board === 'assumptions') return item.statement || item.text || '';
  if (board === 'ambient') return item.text || '';
  return item.text || '';
}

/**
 * Produce the canonical stateful-record shape from a board item. Used by R2 export and
 * R3 assembler. Does not mutate the input.
 *
 * @param {object} item
 * @param {'memory' | 'facts' | 'assumptions'} board
 */
export function toStatefulRecord(item, board) {
  return {
    id: item.id,
    kind: item.kind,
    text: recordText(item, board),
    status: item.status,
    provenance: item.provenance,
    confidence: item.confidence,
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    links: Array.isArray(item.links) ? item.links.map((l) => ({ ...l })) : [],
    created_at: item.created_at,
    updated_at: item.updated_at,
    board,
  };
}

/**
 * Produce the canonical ambient-record shape from a board item. Critically: no `status` field.
 */
export function toAmbientRecord(item) {
  const out = {
    id: item.id,
    kind: 'ambient',
    text: recordText(item, 'ambient'),
    intensity: isValidIntensity(item.intensity) ? item.intensity : 'medium',
    tags: Array.isArray(item.tags) ? [...item.tags] : [],
    created_at: item.created_at,
    last_seen_at: item.last_seen_at,
  };
  return out;
}

/**
 * Low confidence + weak provenance = cannot be treated as operative fact. The UI flags these.
 */
export function isWeak(record) {
  if (!record) return false;
  return record.confidence === 'low' && WEAK_PROVENANCE.has(record.provenance);
}

/**
 * The board UI uses this to decide whether to render a "weak — verify" pill. The threshold
 * is intentionally generous: low confidence alone, or stale_superseded provenance alone,
 * is enough — a user shouldn't have to think about the AND in the formal definition.
 */
export function isVisiblyUntrusted(record) {
  if (!record) return false;
  if (record.provenance === 'stale_superseded') return true;
  return record.confidence === 'low';
}

function randomId() {
  return 'r_' + Math.random().toString(36).slice(2, 10);
}
