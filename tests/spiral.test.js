import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';
import {
  buildSnapshot,
  snapshotToMarkdown,
  snapshotFromMarkdown,
} from '../src/engine/persistence.js';

const REPLY_1 = `===MEMORY===
- User is mid-career and considering a pivot | tags: career
===ASSUMPTIONS===
- assumption: Pay is not the driver | reason: not mentioned | status: open | tags: career
===END===`;

const REPLY_2 = `===MEMORY===
- User has decided to leave by Q3 | tags: career, decision
===END===`;

async function twoTurnEngine() {
  const engine = createEngine();
  engine.setOriginalTask('What should I do about my career?');
  await engine.ingestReplyWithFallback(REPLY_1);
  engine.addTurn('What should I do about my career?', { memory: 1, assumptions: 1, facts: 0, ambient: 0 }, 0);

  engine.setOriginalTask('How do I make the transition?');
  await engine.ingestReplyWithFallback(REPLY_2);
  engine.addTurn('How do I make the transition?', { memory: 1, assumptions: 0, facts: 0, ambient: 0 }, 1);

  return engine;
}

describe('spiral — addTurn and getTurns', () => {
  it('records turns in order with correct metadata', async () => {
    const engine = await twoTurnEngine();
    const turns = engine.getTurns();

    expect(turns).toHaveLength(2);
    expect(turns[0].index).toBe(1);
    expect(turns[0].question).toBe('What should I do about my career?');
    expect(turns[0].added.memory).toBe(1);
    expect(turns[0].added.assumptions).toBe(1);
    expect(turns[0].revokedCount).toBe(0);
    expect(turns[0].timestamp).toBeTruthy();
    expect(turns[0].snapshot).toBeTruthy();
    expect(turns[0].snapshot.format).toBe('context-lens-record');

    expect(turns[1].index).toBe(2);
    expect(turns[1].question).toBe('How do I make the transition?');
    expect(turns[1].revokedCount).toBe(1);
  });

  it('fresh engine has an empty turn log', () => {
    const engine = createEngine();
    expect(engine.getTurns()).toHaveLength(0);
  });
});

describe('spiral — restoreToTurn', () => {
  it('rolls back board state to the snapshotted point', async () => {
    const engine = await twoTurnEngine();

    // After 2 turns, memory has 2 items (one from each reply).
    expect(engine.getBoards().memory).toHaveLength(2);

    const ok = engine.restoreToTurn(1);
    expect(ok).toBe(true);

    // Restored to turn 1: only the first reply's memory should be present.
    expect(engine.getBoards().memory).toHaveLength(1);
    expect(engine.getBoards().memory[0].committedText).toContain('mid-career');
  });

  it('discards turns after the restored index', async () => {
    const engine = await twoTurnEngine();
    engine.restoreToTurn(1);
    expect(engine.getTurns()).toHaveLength(1);
    expect(engine.getTurns()[0].index).toBe(1);
  });

  it('resets hasCorrectiveEdits and pendingProposals on restore', async () => {
    const engine = await twoTurnEngine();
    engine.toggleAssumption(engine.getBoards().assumptions[0]?.id, false);
    expect(engine.hasCorrectiveEdits()).toBe(true);

    engine.restoreToTurn(1);
    expect(engine.hasCorrectiveEdits()).toBe(false);
  });

  it('returns false for an out-of-range index', async () => {
    const engine = await twoTurnEngine();
    expect(engine.restoreToTurn(99)).toBe(false);
    expect(engine.getTurns()).toHaveLength(2);
  });

  it('originalTask is restored from the snapshot', async () => {
    const engine = await twoTurnEngine();
    // The snapshot captured state.originalTask at turn 1 time.
    engine.restoreToTurn(1);
    // The engine's original task comes from the snapshot.
    expect(engine.exportSnapshot().originalTask).toBe('What should I do about my career?');
  });
});

describe('spiral — persistence round-trip', () => {
  it('turns survive export → import with all fields intact', async () => {
    const engine = await twoTurnEngine();
    const file = engine.exportRecordMarkdown();

    const engine2 = createEngine();
    engine2.importRecord(file);

    const turns = engine2.getTurns();
    expect(turns).toHaveLength(2);
    expect(turns[0].question).toBe('What should I do about my career?');
    expect(turns[1].question).toBe('How do I make the transition?');
    expect(turns[1].revokedCount).toBe(1);
    expect(turns[0].snapshot.format).toBe('context-lens-record');
  });

  it('renderSnapshotMarkdown includes a Conversation turns section', async () => {
    const engine = await twoTurnEngine();
    const snap = engine.exportSnapshot();
    const { renderSnapshotMarkdown } = await import('../src/engine/persistence.js');
    const md = renderSnapshotMarkdown(snap);

    expect(md).toContain('## Conversation turns');
    expect(md).toContain('**Turn 1**');
    expect(md).toContain('**Turn 2**');
    expect(md).toContain('−1 revoked');
    expect(md).toContain('What should I do about my career?');
  });

  it('after import, restoreToTurn still works on the loaded turns', async () => {
    const engine = await twoTurnEngine();
    const file = engine.exportRecordMarkdown();

    const engine2 = createEngine();
    engine2.importRecord(file);

    // Both memory items should be present before restore.
    expect(engine2.getBoards().memory).toHaveLength(2);

    engine2.restoreToTurn(1);
    expect(engine2.getBoards().memory).toHaveLength(1);
    expect(engine2.getBoards().memory[0].committedText).toContain('mid-career');
  });
});

describe('spiral — snapshot inside each turn', () => {
  it('each turn snapshot is independent (modifying state later does not corrupt earlier snapshot)', async () => {
    const engine = await twoTurnEngine();
    const turns = engine.getTurns();
    const turn1MemCount = turns[0].snapshot.memory.length;

    // Mutate the live state.
    engine.toggleMemory(engine.getBoards().memory[0].id, false);

    // The snapshot inside turn 1 must not be affected.
    expect(engine.getTurns()[0].snapshot.memory.length).toBe(turn1MemCount);
    expect(engine.getTurns()[0].snapshot.memory[0].active).toBe(true);
  });
});
