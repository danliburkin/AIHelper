import { parseReplyBlocks, hasStructuredBlocks } from './parser.js';
import { buildContextSpec, buildRevocations } from './contextSpec.js';
import { composePrompt, composeSmartPrompt, needsRegeneratePrompt, restateMemory } from './prompts.js';
import { parseWithNanoFallback, polishPromptWithNano } from './nano.js';
import {
  applyRecordDefaults,
  createAmbientRecord,
  isValidStatus,
  isValidConfidence,
  isValidIntensity,
  toStatefulRecord,
  toAmbientRecord,
} from './records.js';
import {
  buildSnapshot,
  applySnapshot,
  snapshotToMarkdown,
  snapshotFromMarkdown,
  renderSnapshotMarkdown,
} from './persistence.js';
import { buildBriefing, deriveTopicTags } from './briefing.js';
import { parseProposals, annotateImpact, applyProposal } from './proposals.js';

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'r_' + Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function appendParsed(state, parsed) {
  const added = { memory: 0, assumptions: 0, facts: 0, ambient: 0 };

  for (const bullet of parsed.memory) {
    const text = typeof bullet === 'string' ? bullet : bullet.text;
    const meta = (typeof bullet === 'object' && bullet.meta) || {};
    const item = {
      id: newId(),
      originalText: text,
      committedText: text,
      active: true,
      source: 'imported',
    };
    applyRecordDefaults(item, 'memory', meta);
    state.memory.push(item);
    added.memory += 1;
  }

  for (const assumption of parsed.assumptions) {
    const meta = assumption.meta || {};
    const item = {
      id: newId(),
      statement: assumption.statement,
      reason: assumption.reason,
      originalStatement: assumption.statement,
      originalReason: assumption.reason,
      active: true,
    };
    applyRecordDefaults(item, 'assumptions', meta);
    state.assumptions.push(item);
    added.assumptions += 1;
  }

  for (const fact of parsed.facts) {
    const meta = fact.meta || {};
    const item = {
      id: newId(),
      content: fact.content,
      type: fact.type,
      sourceUrl: fact.sourceUrl,
      sourceDate: fact.sourceDate,
      active: true,
    };
    applyRecordDefaults(item, 'facts', meta, { factType: fact.type });
    state.facts.push(item);
    added.facts += 1;
  }

  for (const ambient of parsed.ambient || []) {
    const record = createAmbientRecord({
      text: ambient.text,
      intensity: ambient.intensity,
      tags: ambient.tags,
    });
    state.ambient.push(record);
    added.ambient += 1;
  }

  return added;
}

function cloneBoards(state) {
  return {
    memory: state.memory.map((m) => ({ ...m, tags: [...(m.tags || [])], links: [...(m.links || [])] })),
    facts: state.facts.map((f) => ({ ...f, tags: [...(f.tags || [])], links: [...(f.links || [])] })),
    assumptions: state.assumptions.map((a) => ({ ...a, tags: [...(a.tags || [])], links: [...(a.links || [])] })),
    ambient: state.ambient.map((x) => ({ ...x, tags: [...(x.tags || [])] })),
  };
}

function findStatefulItem(state, id) {
  return (
    state.memory.find((m) => m.id === id) ||
    state.facts.find((f) => f.id === id) ||
    state.assumptions.find((a) => a.id === id) ||
    null
  );
}

function boardOf(state, id) {
  if (state.memory.some((m) => m.id === id)) return 'memory';
  if (state.facts.some((f) => f.id === id)) return 'facts';
  if (state.assumptions.some((a) => a.id === id)) return 'assumptions';
  if (state.ambient.some((x) => x.id === id)) return 'ambient';
  return null;
}

export function createEngine() {
  const state = {
    memory: [],
    facts: [],
    assumptions: [],
    ambient: [],
    originalTask: '',
    topic: '',
    hasCorrectiveEdits: false,
    lastActivityAt: null,
    pendingProposals: [],
    turns: [],
    proposalIdMap: {},
  };

  function markEdited() {
    state.hasCorrectiveEdits = true;
    state.lastActivityAt = nowIso();
  }

  function clearProposalIdMap() {
    state.proposalIdMap = {};
  }

  function touch(item) {
    if (!item) return;
    const stamp = nowIso();
    item.updated_at = stamp;
    state.lastActivityAt = stamp;
  }

  function harvestProposals(text) {
    const fresh = parseProposals(text);
    annotateImpact(fresh, state);
    state.pendingProposals.push(...fresh);
    return fresh.length;
  }

  return {
    ingestReply(text) {
      clearProposalIdMap();
      const added = appendParsed(state, parseReplyBlocks(text));
      const proposalsAdded = harvestProposals(text);
      if (added.memory + added.assumptions + added.facts + added.ambient > 0) {
        state.lastActivityAt = nowIso();
      }
      return { ...added, proposals: proposalsAdded };
    },

    async ingestReplyWithFallback(text) {
      clearProposalIdMap();
      let parsed = parseReplyBlocks(text);
      const usedNano =
        parsed.memory.length === 0 &&
        parsed.assumptions.length === 0 &&
        parsed.facts.length === 0 &&
        (parsed.ambient || []).length === 0;

      if (usedNano) {
        parsed = await parseWithNanoFallback(text);
      }

      const added = appendParsed(state, parsed);
      state.hasCorrectiveEdits = false;
      if (added.memory + added.assumptions + added.facts + added.ambient > 0) {
        state.lastActivityAt = nowIso();
      }
      const proposalsAdded = harvestProposals(text);

      return {
        ...added,
        proposals: proposalsAdded,
        hadStructuredBlocks: hasStructuredBlocks(text),
        usedNano,
      };
    },

    /**
     * R4 — return the queue of pending model-proposed record changes.
     */
    getPendingProposals() {
      return state.pendingProposals.map((p) => ({ ...p, tags: [...(p.tags || [])] }));
    },

    /**
     * R4 — accept a single proposal by id. Applies the mutation and removes it
     * from the queue. Returns the result envelope from applyProposal.
     */
    acceptProposal(proposalId) {
      const idx = state.pendingProposals.findIndex((p) => p.id === proposalId);
      if (idx === -1) return { applied: false, reason: 'no such proposal' };
      const proposal = state.pendingProposals[idx];
      const result = applyProposal(state, proposal);
      if (result.applied) {
        state.pendingProposals.splice(idx, 1);
        state.lastActivityAt = nowIso();
        // Confirming a proposal IS a state change but the briefing is now in
        // sync with the new record, so don't trigger a regenerate prompt.
      }
      return result;
    },

    /**
     * R4 — reject (discard) a single proposal by id.
     */
    rejectProposal(proposalId) {
      const idx = state.pendingProposals.findIndex((p) => p.id === proposalId);
      if (idx === -1) return false;
      state.pendingProposals.splice(idx, 1);
      return true;
    },

    /**
     * R4 — accept all proposals in the queue EXCEPT those flagged
     * requiresIndividualConfirm. High-impact items cannot be swept by accept-all.
     */
    acceptAllSafeProposals() {
      const results = [];
      const survivors = [];
      for (const proposal of state.pendingProposals) {
        if (proposal.requiresIndividualConfirm) {
          survivors.push(proposal);
          continue;
        }
        const result = applyProposal(state, proposal);
        results.push({ proposal_id: proposal.id, ...result });
        if (!result.applied) survivors.push(proposal);
      }
      state.pendingProposals = survivors;
      if (results.some((r) => r.applied)) state.lastActivityAt = nowIso();
      return results;
    },

    /**
     * R4 — reject all proposals in the queue.
     */
    rejectAllProposals() {
      const n = state.pendingProposals.length;
      state.pendingProposals = [];
      return n;
    },

    getBoards() {
      return cloneBoards(state);
    },

    /**
     * Canonical record snapshot — used by R2 export and R3 assembler.
     */
    getRecords() {
      return {
        stateful: [
          ...state.memory.map((m) => toStatefulRecord(m, 'memory')),
          ...state.facts.map((f) => toStatefulRecord(f, 'facts')),
          ...state.assumptions.map((a) => toStatefulRecord(a, 'assumptions')),
        ],
        ambient: state.ambient.map(toAmbientRecord),
      };
    },

    toggleMemory(id, active) {
      const item = state.memory.find((m) => m.id === id);
      if (item) {
        item.active = active;
        touch(item);
        markEdited();
      }
    },

    async overrideMemory(id, userText) {
      const item = state.memory.find((m) => m.id === id);
      if (!item) return '';

      let committedText = restateMemory(userText);
      committedText = await polishPromptWithNano(
        `Restate this user memory bullet as the precise phrasing you will carry forward. Output only the restated bullet, no preamble:\n\n${userText}`,
        committedText,
      );

      return committedText;
    },

    ratifyMemory(id, committedText) {
      const item = state.memory.find((m) => m.id === id);
      if (!item) return;

      item.committedText = committedText;
      item.source = 'user_override';
      item.active = true;
      // user override is the strongest provenance and high confidence.
      item.provenance = 'user_asserted';
      item.confidence = 'high';
      touch(item);
      markEdited();
    },

    toggleFact(id, active) {
      const item = state.facts.find((f) => f.id === id);
      if (item) {
        item.active = active;
        touch(item);
        markEdited();
      }
    },

    toggleAssumption(id, active) {
      const item = state.assumptions.find((a) => a.id === id);
      if (item) {
        item.active = active;
        touch(item);
        markEdited();
      }
    },

    toggleAmbient(id, active) {
      const item = state.ambient.find((x) => x.id === id);
      if (item) {
        item.active = active;
        item.last_seen_at = nowIso();
        markEdited();
      }
    },

    /**
     * Manually add a memory bullet the user asserts directly (not parsed from
     * a reply). Provenance is user_asserted / confidence high since the user
     * is the strongest source of truth about themselves.
     * @param {string} text
     * @param {{ tags?: string[] }} [opts]
     * @returns {object|null} the created item, or null if text is empty
     */
    addMemory(text, opts = {}) {
      const trimmed = String(text || '').trim();
      if (!trimmed) return null;
      const item = {
        id: newId(),
        originalText: trimmed,
        committedText: trimmed,
        active: true,
        source: 'user_added',
        provenance: 'user_asserted',
        confidence: 'high',
        tags: Array.isArray(opts.tags) ? [...opts.tags] : [],
      };
      applyRecordDefaults(item, 'memory');
      state.memory.push(item);
      state.lastActivityAt = item.updated_at;
      return { ...item };
    },

    /**
     * Manually add an assumption the user wants tracked, without waiting for
     * the model to propose it.
     * @param {string} statement
     * @param {string} [reason]
     * @param {{ tags?: string[] }} [opts]
     * @returns {object|null}
     */
    addAssumption(statement, reason = '', opts = {}) {
      const trimmed = String(statement || '').trim();
      if (!trimmed) return null;
      const item = {
        id: newId(),
        statement: trimmed,
        reason: String(reason || '').trim(),
        originalStatement: trimmed,
        originalReason: String(reason || '').trim(),
        active: true,
        provenance: 'user_asserted',
        confidence: 'high',
        status: 'active',
        tags: Array.isArray(opts.tags) ? [...opts.tags] : [],
      };
      applyRecordDefaults(item, 'assumptions');
      state.assumptions.push(item);
      state.lastActivityAt = item.updated_at;
      return { ...item };
    },

    /**
     * Manually add a fact the user knows to be true.
     * @param {string} content
     * @param {{ tags?: string[], type?: 'computed'|'retrieved' }} [opts]
     * @returns {object|null}
     */
    addFact(content, opts = {}) {
      const trimmed = String(content || '').trim();
      if (!trimmed) return null;
      const item = {
        id: newId(),
        content: trimmed,
        type: opts.type === 'retrieved' ? 'retrieved' : 'computed',
        sourceUrl: undefined,
        sourceDate: undefined,
        active: true,
        provenance: 'user_asserted',
        confidence: 'high',
        tags: Array.isArray(opts.tags) ? [...opts.tags] : [],
      };
      applyRecordDefaults(item, 'facts', {}, { factType: item.type });
      state.facts.push(item);
      state.lastActivityAt = item.updated_at;
      return { ...item };
    },

    /**
     * Manually add an ambient (soft context) item — mood, standing constraint, etc.
     * @param {string} text
     * @param {'low'|'medium'|'high'} [intensity]
     * @param {{ tags?: string[] }} [opts]
     * @returns {object|null}
     */
    addAmbientItem(text, intensity = 'medium', opts = {}) {
      const trimmed = String(text || '').trim();
      if (!trimmed) return null;
      const record = createAmbientRecord({
        text: trimmed,
        intensity,
        tags: Array.isArray(opts.tags) ? opts.tags : [],
      });
      state.ambient.push(record);
      state.lastActivityAt = record.created_at;
      return { ...record };
    },

    editAssumption(id, statement, reason) {
      const item = state.assumptions.find((a) => a.id === id);
      if (!item) return;

      // Preserve the original text so the DELETE block can emit old vs new.
      if (item.originalStatement === undefined) item.originalStatement = item.statement;
      if (item.originalReason === undefined) item.originalReason = item.reason;

      item.statement = statement;
      item.reason = reason;
      touch(item);
      markEdited();
    },

    /**
     * R1 — let the user set status on any stateful record.
     */
    updateRecordStatus(id, status) {
      if (!isValidStatus(status)) return false;
      const item = findStatefulItem(state, id);
      if (!item) return false;
      item.status = status;
      touch(item);
      markEdited();
      return true;
    },

    updateRecordConfidence(id, confidence) {
      if (!isValidConfidence(confidence)) return false;
      const item = findStatefulItem(state, id);
      if (!item) return false;
      item.confidence = confidence;
      touch(item);
      markEdited();
      return true;
    },

    updateAmbientIntensity(id, intensity) {
      if (!isValidIntensity(intensity)) return false;
      const item = state.ambient.find((x) => x.id === id);
      if (!item) return false;
      item.intensity = intensity;
      item.last_seen_at = nowIso();
      markEdited();
      return true;
    },

    /**
     * Report which board owns an id — useful for UI badge styling and R4 proposals.
     */
    boardOf(id) {
      return boardOf(state, id);
    },

    async getComposedPrompt(kind) {
      const prompt = composePrompt(kind, state);
      return polishPromptWithNano(
        'Polish this prompt for clarity without changing its requirements. Output only the prompt:',
        prompt,
      );
    },

    buildContextSpec() {
      return buildContextSpec(state);
    },

    previewPrompt(kind) {
      return composePrompt(kind, state);
    },

    previewSmartPrompt() {
      return composeSmartPrompt(state);
    },

    needsRegeneratePrompt() {
      return needsRegeneratePrompt(state);
    },

    buildRevocationsPreview() {
      return buildRevocations(state);
    },

    hasCorrectiveEdits() {
      return state.hasCorrectiveEdits;
    },

    setOriginalTask(task) {
      state.originalTask = task;
    },

    /**
     * Read the current question/task text — used by the UI to sync the
     * question input box after loading a conversation from storage.
     * @returns {string}
     */
    getOriginalTask() {
      return state.originalTask || '';
    },

    setTopic(topic) {
      state.topic = topic;
    },

    /**
     * Record a turn in the conversation spiral. Call after a successful ingest.
     * Captures a full record snapshot so the turn can be restored later.
     *
     * @param {string} question - the question that produced this reply
     * @param {{ memory: number, facts: number, assumptions: number, ambient: number }} added
     * @param {number} [revokedCount] - items the user had suppressed before sending this turn's prompt
     * @param {string} [replyText] - the raw chatbot reply text that was ingested, kept for the notepad view
     */
    addTurn(question, added, revokedCount = 0, replyText = '') {
      const snapshot = buildSnapshot(state, { includeTurns: false });
      snapshot.lastActivityAt = state.lastActivityAt;
      state.turns.push({
        index: state.turns.length + 1,
        question: String(question || '').trim(),
        replyText: String(replyText || ''),
        timestamp: nowIso(),
        added: { ...added },
        revokedCount,
        snapshot,
      });
    },

    /**
     * Return a shallow copy of the turn log.
     * @returns {Array<object>}
     */
    getTurns() {
      return state.turns.map((t) => ({ ...t, added: { ...t.added } }));
    },

    /**
     * Restore board state to a previous turn's snapshot. Turns after the
     * rewound index are discarded. hasCorrectiveEdits and pendingProposals
     * are reset; originalTask is updated to the rewound turn's question.
     *
     * @param {number} turnIndex - 1-based turn number to restore to
     * @returns {boolean} false when turnIndex is out of range
     */
    restoreToTurn(turnIndex) {
      const turn = state.turns.find((t) => t.index === turnIndex);
      if (!turn) return false;
      // Save the live turn log before applySnapshot overwrites state.turns
      // with the (typically empty) turns inside the nested snapshot.
      const savedTurns = state.turns.filter((t) => t.index <= turnIndex);
      applySnapshot(state, turn.snapshot);
      if (turn.snapshot.lastActivityAt) state.lastActivityAt = turn.snapshot.lastActivityAt;
      state.pendingProposals = [];
      state.turns = savedTurns;
      return true;
    },

    /**
     * R3 — compose the briefing block (the slice of the record to inject this turn).
     * @param {object} [opts] - forwarded to buildBriefing
     */
    buildBriefing(opts = {}) {
      const merged = {
        questionText: state.originalTask || state.topic || '',
        lastActivityAt: opts.lastActivityAt || state.lastActivityAt,
        ...opts,
      };
      return buildBriefing(state, merged);
    },

    /**
     * R3 — exposed for the UI / R4: derive topic tags from a question string.
     */
    deriveTopicTags(text) {
      const knownTags = new Set();
      for (const board of [state.memory, state.facts, state.assumptions, state.ambient || []]) {
        for (const item of board) {
          for (const tag of item.tags || []) knownTags.add(String(tag).toLowerCase());
        }
      }
      return deriveTopicTags(text, [...knownTags]);
    },

    /**
     * R2 — persistence. Build the canonical snapshot envelope.
     */
    exportSnapshot() {
      const snap = buildSnapshot(state);
      snap.lastActivityAt = state.lastActivityAt;
      return snap;
    },

    /**
     * R2 — produce the full export file (markdown body + embedded JSON).
     */
    exportRecordMarkdown() {
      return snapshotToMarkdown(buildSnapshot(state));
    },

    /**
     * R2 — render the human-readable view of the current record without exporting.
     */
    renderRecordMarkdown() {
      return renderSnapshotMarkdown(buildSnapshot(state));
    },

    /**
     * R2 — apply a previously exported record. Replaces working state.
     * @param {string} text - file contents
     * @returns {{ memory: number, facts: number, assumptions: number, ambient: number, exported_at: string|null }}
     */
    importRecord(text) {
      const snapshot = snapshotFromMarkdown(text);
      applySnapshot(state, snapshot);
      // Preserve lastActivityAt from the exported snapshot when present,
      // otherwise derive it from the max updated_at across boards.
      if (snapshot.lastActivityAt) {
        state.lastActivityAt = snapshot.lastActivityAt;
      } else {
        let max = null;
        for (const board of [state.memory, state.facts, state.assumptions, state.ambient]) {
          for (const item of board) {
            const stamp = item.updated_at || item.last_seen_at || item.created_at;
            if (stamp && (!max || stamp > max)) max = stamp;
          }
        }
        state.lastActivityAt = max;
      }
      return {
        memory: state.memory.length,
        facts: state.facts.length,
        assumptions: state.assumptions.length,
        ambient: state.ambient.length,
        exported_at: snapshot.exported_at || null,
        originalTask: state.originalTask,
        lastActivityAt: state.lastActivityAt,
      };
    },

    /**
     * Apply a snapshot object directly (as opposed to importRecord, which
     * parses a markdown/JSON file). Used by the multi-conversation UI when
     * switching between conversations stored in localStorage.
     * @param {object} snapshot - shape produced by exportSnapshot()
     */
    restoreSnapshot(snapshot) {
      applySnapshot(state, snapshot);
      state.lastActivityAt = snapshot.lastActivityAt || null;
      state.pendingProposals = [];
      clearProposalIdMap();
    },

    /**
     * Wipe all state back to a blank conversation. Used by "+ New conversation".
     * The engine object identity is preserved so existing UI closures keep working.
     */
    reset() {
      state.memory = [];
      state.facts = [];
      state.assumptions = [];
      state.ambient = [];
      state.originalTask = '';
      state.topic = '';
      state.hasCorrectiveEdits = false;
      state.lastActivityAt = null;
      state.pendingProposals = [];
      state.turns = [];
      clearProposalIdMap();
    },
  };
}
