import { parseReplyBlocks, hasStructuredBlocks } from './parser.js';
import { buildContextSpec, buildRevocations } from './contextSpec.js';
import { composePrompt, composeSmartPrompt, needsRegeneratePrompt, restateMemory } from './prompts.js';
import { parseWithNanoFallback, polishPromptWithNano } from './nano.js';

function appendParsed(state, parsed) {
  const added = { memory: 0, assumptions: 0, facts: 0 };

  for (const bullet of parsed.memory) {
    state.memory.push({
      id: crypto.randomUUID(),
      originalText: bullet,
      committedText: bullet,
      active: true,
      source: 'imported',
    });
    added.memory += 1;
  }

  for (const assumption of parsed.assumptions) {
    state.assumptions.push({
      id: crypto.randomUUID(),
      originalStatement: assumption.statement,
      originalReason: assumption.reason,
      statement: assumption.statement,
      reason: assumption.reason,
      active: true,
      source: 'inferred',
    });
    added.assumptions += 1;
  }

  for (const fact of parsed.facts) {
    state.facts.push({
      id: crypto.randomUUID(),
      content: fact.content,
      type: fact.type,
      sourceUrl: fact.sourceUrl,
      sourceDate: fact.sourceDate,
      active: true,
    });
    added.facts += 1;
  }

  return added;
}

function cloneBoards(state) {
  return {
    memory: state.memory.map((m) => ({ ...m })),
    facts: state.facts.map((f) => ({ ...f })),
    assumptions: state.assumptions.map((a) => ({ ...a })),
  };
}

export function createEngine() {
  const state = {
    memory: [],
    facts: [],
    assumptions: [],
    originalTask: '',
    topic: '',
    hasCorrectiveEdits: false,
  };

  function markEdited() {
    state.hasCorrectiveEdits = true;
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
      parsed.facts.length === 0;

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

  toggleMemory(id, active) {
    const item = state.memory.find((m) => m.id === id);
    if (item) {
      item.active = active;
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
    markEdited();
  },

  toggleFact(id, active) {
    const item = state.facts.find((f) => f.id === id);
    if (item) {
      item.active = active;
      markEdited();
    }
  },

  toggleAssumption(id, active) {
    const item = state.assumptions.find((a) => a.id === id);
    if (item) {
      item.active = active;
      markEdited();
    }
  },

  editAssumption(id, statement, reason) {
    const item = state.assumptions.find((a) => a.id === id);
    if (!item) return;

    if (!item.originalStatement) {
      item.originalStatement = item.statement;
      item.originalReason = item.reason;
    }
    item.statement = statement;
    item.reason = reason;
    item.source = 'user_override';
    item.active = true;
    markEdited();
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
