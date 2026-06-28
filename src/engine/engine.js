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
  };

  function markEdited() {
    state.hasCorrectiveEdits = true;
  }

  function touch(item) {
    if (!item) return;
    item.updated_at = nowIso();
  }

  return {
    ingestReply(text) {
      return appendParsed(state, parseReplyBlocks(text));
    },

    async ingestReplyWithFallback(text) {
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

      return {
        ...added,
        hadStructuredBlocks: hasStructuredBlocks(text),
        usedNano,
      };
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

    editAssumption(id, statement, reason) {
      const item = state.assumptions.find((a) => a.id === id);
      if (!item) return;

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

    setTopic(topic) {
      state.topic = topic;
    },
  };
}
