import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';

describe('engine.addMemory', () => {
  it('adds a memory item as user_asserted / high confidence / active', () => {
    const engine = createEngine();
    const item = engine.addMemory('I have a dog named Biscuit', { tags: ['pets'] });

    expect(item).toBeTruthy();
    expect(item.committedText).toBe('I have a dog named Biscuit');
    expect(item.provenance).toBe('user_asserted');
    expect(item.confidence).toBe('high');
    expect(item.status).toBe('active');
    expect(item.active).toBe(true);
    expect(item.source).toBe('user_added');
    expect(item.tags).toEqual(['pets']);

    const boards = engine.getBoards();
    expect(boards.memory).toHaveLength(1);
    expect(boards.memory[0].id).toBe(item.id);
  });

  it('trims whitespace and rejects empty text', () => {
    const engine = createEngine();
    expect(engine.addMemory('   ')).toBeNull();
    expect(engine.addMemory('')).toBeNull();
    const item = engine.addMemory('  padded text  ');
    expect(item.committedText).toBe('padded text');
  });

  it('bumps lastActivityAt', () => {
    const engine = createEngine();
    expect(engine.exportSnapshot().lastActivityAt).toBeFalsy();
    engine.addMemory('something new');
    expect(engine.exportSnapshot().lastActivityAt).toBeTruthy();
  });

  it('appears immediately in the briefing', () => {
    const engine = createEngine();
    engine.setOriginalTask('tell me about pets');
    engine.addMemory('I have a dog named Biscuit', { tags: ['pets'] });
    const { text } = engine.buildBriefing({ topicTags: ['pets'] });
    expect(text).toContain('Biscuit');
  });
});

describe('engine.addAssumption', () => {
  it('adds an assumption as user_asserted / high confidence / active status', () => {
    const engine = createEngine();
    const item = engine.addAssumption('I work remotely', 'stated directly', { tags: ['work'] });

    expect(item.statement).toBe('I work remotely');
    expect(item.reason).toBe('stated directly');
    expect(item.provenance).toBe('user_asserted');
    expect(item.confidence).toBe('high');
    expect(item.status).toBe('active');
    expect(item.originalStatement).toBe('I work remotely');
    expect(item.tags).toEqual(['work']);

    const boards = engine.getBoards();
    expect(boards.assumptions).toHaveLength(1);
  });

  it('defaults reason to empty string when omitted', () => {
    const engine = createEngine();
    const item = engine.addAssumption('Some assumption');
    expect(item.reason).toBe('');
  });

  it('rejects an empty statement', () => {
    const engine = createEngine();
    expect(engine.addAssumption('')).toBeNull();
    expect(engine.addAssumption('   ')).toBeNull();
  });
});

describe('engine.addFact', () => {
  it('adds a computed fact by default', () => {
    const engine = createEngine();
    const item = engine.addFact('I graduated in 2019', { tags: ['career'] });

    expect(item.content).toBe('I graduated in 2019');
    expect(item.type).toBe('computed');
    expect(item.provenance).toBe('user_asserted');
    expect(item.confidence).toBe('high');
    expect(item.tags).toEqual(['career']);
  });

  it('supports an explicit retrieved type', () => {
    const engine = createEngine();
    const item = engine.addFact('Population is 8B', { type: 'retrieved' });
    expect(item.type).toBe('retrieved');
  });

  it('rejects empty content', () => {
    const engine = createEngine();
    expect(engine.addFact('')).toBeNull();
  });
});

describe('engine.addAmbientItem', () => {
  it('adds an ambient item with no status field', () => {
    const engine = createEngine();
    const item = engine.addAmbientItem('stressed about the move', 'high', { tags: ['mood'] });

    expect(item.text).toBe('stressed about the move');
    expect(item.intensity).toBe('high');
    expect(item.kind).toBe('ambient');
    expect(item).not.toHaveProperty('status');
    expect(item.tags).toEqual(['mood']);

    const boards = engine.getBoards();
    expect(boards.ambient).toHaveLength(1);
  });

  it('defaults intensity to medium', () => {
    const engine = createEngine();
    const item = engine.addAmbientItem('some context');
    expect(item.intensity).toBe('medium');
  });

  it('rejects empty text', () => {
    const engine = createEngine();
    expect(engine.addAmbientItem('')).toBeNull();
  });

  it('shows up in the briefing regardless of topic tags', () => {
    const engine = createEngine();
    engine.addAmbientItem('burnt out', 'high', { tags: ['mood'] });
    const { text } = engine.buildBriefing({ topicTags: ['unrelated-topic'] });
    expect(text).toContain('burnt out');
  });
});

describe('engine.reset', () => {
  it('wipes all state back to a blank conversation, preserving object identity', () => {
    const engine = createEngine();
    engine.setOriginalTask('some task');
    engine.addMemory('a fact');
    engine.addAssumption('an assumption');
    engine.addAmbientItem('a mood');
    engine.addTurn('some task', { memory: 1, facts: 0, assumptions: 1, ambient: 0 });

    engine.reset();

    const boards = engine.getBoards();
    expect(boards.memory).toHaveLength(0);
    expect(boards.facts).toHaveLength(0);
    expect(boards.assumptions).toHaveLength(0);
    expect(boards.ambient).toHaveLength(0);
    expect(engine.getTurns()).toHaveLength(0);
    expect(engine.getPendingProposals()).toHaveLength(0);
    expect(engine.hasCorrectiveEdits()).toBe(false);
    expect(engine.exportSnapshot().originalTask).toBe('');
  });

  it('the SAME engine object still works after reset — can add new items', () => {
    const engine = createEngine();
    engine.addMemory('old data');
    engine.reset();
    const item = engine.addMemory('new data');
    expect(item).toBeTruthy();
    expect(engine.getBoards().memory).toHaveLength(1);
    expect(engine.getBoards().memory[0].committedText).toBe('new data');
  });
});

describe('engine.restoreSnapshot', () => {
  it('applies an external snapshot object directly (no markdown parsing)', () => {
    const engineA = createEngine();
    engineA.setOriginalTask('conversation A');
    engineA.addMemory('fact from A');
    const snapshotA = engineA.exportSnapshot();

    const engineB = createEngine();
    engineB.setOriginalTask('conversation B — should be replaced');
    engineB.addMemory('fact from B — should be replaced');

    engineB.restoreSnapshot(snapshotA);

    const boards = engineB.getBoards();
    expect(boards.memory).toHaveLength(1);
    expect(boards.memory[0].committedText).toBe('fact from A');
    expect(engineB.exportSnapshot().originalTask).toBe('conversation A');
  });

  it('clears pending proposals when switching snapshots', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(`===MEMORY===
- topic
===PROPOSE===
- new memory: proposed item | tags: x | rationale: test
===END===`);
    expect(engine.getPendingProposals().length).toBeGreaterThan(0);

    const blankSnapshot = createEngine().exportSnapshot();
    engine.restoreSnapshot(blankSnapshot);
    expect(engine.getPendingProposals()).toHaveLength(0);
  });

  it('restores lastActivityAt from the snapshot', () => {
    const engineA = createEngine();
    engineA.addMemory('something');
    const snapshotA = engineA.exportSnapshot();
    expect(snapshotA.lastActivityAt).toBeTruthy();

    const engineB = createEngine();
    engineB.restoreSnapshot(snapshotA);
    expect(engineB.exportSnapshot().lastActivityAt).toBe(snapshotA.lastActivityAt);
  });
});

describe('turn replyText', () => {
  it('addTurn stores the raw reply text', () => {
    const engine = createEngine();
    engine.addTurn('question', { memory: 1, facts: 0, assumptions: 0, ambient: 0 }, 0, 'the raw chatbot reply text');
    const turns = engine.getTurns();
    expect(turns[0].replyText).toBe('the raw chatbot reply text');
  });

  it('defaults replyText to empty string when omitted', () => {
    const engine = createEngine();
    engine.addTurn('question', { memory: 0, facts: 0, assumptions: 0, ambient: 0 });
    expect(engine.getTurns()[0].replyText).toBe('');
  });

  it('replyText survives export/import round-trip', async () => {
    const engine = createEngine();
    engine.addTurn('q', { memory: 0, facts: 0, assumptions: 0, ambient: 0 }, 0, 'reply body');
    const file = engine.exportRecordMarkdown();

    const engine2 = createEngine();
    engine2.importRecord(file);
    expect(engine2.getTurns()[0].replyText).toBe('reply body');
  });
});
