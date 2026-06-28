import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';
import {
  buildSnapshot,
  applySnapshot,
  snapshotToMarkdown,
  snapshotFromMarkdown,
  renderSnapshotMarkdown,
} from '../src/engine/persistence.js';

const FULL_REPLY = `===MEMORY===
- User is mid-career and considering a pivot | confidence: medium | provenance: model_proposed_user_confirmed | tags: career
- User has been at current company for 7 years | confidence: high | provenance: user_asserted | tags: career, tenure
===ASSUMPTIONS===
- assumption: User wants more autonomy | reason: phrased in terms of agency | status: open | confidence: low | tags: career, motivation
===FACTS===
- type: retrieved | content: Tech tenure median is 2.2 years | source: https://example.com/tenure | date: 2024-08-12 | confidence: high | tags: career, industry
- type: computed | content: A 7-year tenure is ~3x the industry median | confidence: medium | tags: career
===AMBIENT===
- text: burnt out by micromanaging boss | intensity: high | tags: mood, work
===END===`;

describe('R2 snapshot envelope', () => {
  it('buildSnapshot captures every field on every board', async () => {
    const engine = createEngine();
    engine.setOriginalTask('What should I do about my career?');
    await engine.ingestReplyWithFallback(FULL_REPLY);

    const snap = engine.exportSnapshot();
    expect(snap.format).toBe('context-lens-record');
    expect(snap.version).toBe(1);
    expect(snap.exported_at).toBeTruthy();
    expect(snap.originalTask).toBe('What should I do about my career?');
    expect(snap.memory).toHaveLength(2);
    expect(snap.facts).toHaveLength(2);
    expect(snap.assumptions).toHaveLength(1);
    expect(snap.ambient).toHaveLength(1);

    const mem0 = snap.memory[0];
    expect(mem0.id).toBeTruthy();
    expect(mem0.committedText).toBe('User is mid-career and considering a pivot');
    expect(mem0.status).toBe('active');
    expect(mem0.confidence).toBe('medium');
    expect(mem0.provenance).toBe('model_proposed_user_confirmed');
    expect(mem0.tags).toEqual(['career']);
    expect(mem0.links).toEqual([]);
    expect(mem0.created_at).toBeTruthy();
    expect(mem0.updated_at).toBeTruthy();
    expect(mem0.active).toBe(true);
    expect(mem0.source).toBe('imported');

    const ambient0 = snap.ambient[0];
    expect(ambient0).not.toHaveProperty('status');
    expect(ambient0.intensity).toBe('high');
    expect(ambient0.last_seen_at).toBeTruthy();
  });

  it('round-trip: export → markdown → import preserves all fields including status/timestamps/provenance/tags/links', async () => {
    const engine = createEngine();
    engine.setOriginalTask('What should I do about my career?');
    await engine.ingestReplyWithFallback(FULL_REPLY);

    // Add a supersession link and flip a status, so we cover non-default fields.
    const memId = engine.getBoards().memory[0].id;
    engine.updateRecordStatus(memId, 'done');

    const before = engine.exportSnapshot();
    const markdownFile = snapshotToMarkdown(before);

    expect(markdownFile).toContain('# Context Lens record');
    expect(markdownFile).toContain('<!-- CONTEXT_LENS_RECORD');

    // Round-trip through file format into a fresh engine.
    const engine2 = createEngine();
    const result = engine2.importRecord(markdownFile);
    expect(result.memory).toBe(2);
    expect(result.facts).toBe(2);
    expect(result.assumptions).toBe(1);
    expect(result.ambient).toBe(1);

    const after = engine2.exportSnapshot();

    // exported_at is the only field we expect to differ.
    delete before.exported_at;
    delete after.exported_at;
    expect(after).toEqual(before);

    // Also verify the typed-record fields specifically.
    const m = engine2.getBoards().memory[0];
    expect(m.status).toBe('done');
    expect(m.provenance).toBe('model_proposed_user_confirmed');
    expect(m.confidence).toBe('medium');
    expect(m.tags).toEqual(['career']);
    expect(m.created_at).toBe(before.memory[0].created_at);
    expect(m.updated_at).toBe(before.memory[0].updated_at);
  });

  it('round-trip preserves links[] including supersedes relations', () => {
    const engine = createEngine();
    // Hand-craft a state with a link to make sure it survives.
    const memId = 'a';
    const memId2 = 'b';
    const supersession = { rel: 'supersedes', target_id: memId2 };
    const state = engine.exportSnapshot();
    state.memory.push(
      {
        id: memId,
        committedText: 'newer',
        active: true,
        kind: 'fact',
        status: 'active',
        provenance: 'user_asserted',
        confidence: 'high',
        tags: ['x'],
        links: [supersession],
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-02T00:00:00Z',
      },
      {
        id: memId2,
        committedText: 'older',
        active: true,
        kind: 'fact',
        status: 'active',
        provenance: 'stale_superseded',
        confidence: 'low',
        tags: ['x'],
        links: [],
        created_at: '2023-01-01T00:00:00Z',
        updated_at: '2023-06-01T00:00:00Z',
      },
    );
    const text = snapshotToMarkdown(state);
    const engine2 = createEngine();
    engine2.importRecord(text);
    const newer = engine2.getBoards().memory.find((m) => m.id === memId);
    expect(newer.links).toEqual([supersession]);
  });

  it('rejects a non-record file with a helpful error', () => {
    const engine = createEngine();
    expect(() => engine.importRecord('not a context lens record at all')).toThrow();
    expect(() => engine.importRecord('{"format":"other","version":1}')).toThrow(/Unrecognised format/);
    expect(() => engine.importRecord('')).toThrow();
  });

  it('snapshotFromMarkdown accepts pure JSON', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(FULL_REPLY);
    const snap = engine.exportSnapshot();
    const pureJson = JSON.stringify(snap);
    const parsed = snapshotFromMarkdown(pureJson);
    expect(parsed.format).toBe('context-lens-record');
    expect(parsed.memory).toHaveLength(2);
  });

  it('renderSnapshotMarkdown groups by lifecycle and shows ambient separately', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(FULL_REPLY);
    const memId = engine.getBoards().memory[0].id;
    engine.updateRecordStatus(memId, 'done');
    const md = renderSnapshotMarkdown(engine.exportSnapshot());
    expect(md).toContain('## Active goals & memory');
    expect(md).toContain('## Active facts');
    expect(md).toContain('## Open questions / assumptions');
    expect(md).toContain('## Ambient context');
    expect(md).toContain('## Done / dropped (collapsed)');
    expect(md).toContain('burnt out by micromanaging boss');
  });

  it('applySnapshot resets hasCorrectiveEdits so the next copy is a fresh task prompt', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(FULL_REPLY);
    engine.toggleAssumption(engine.getBoards().assumptions[0].id, false);
    expect(engine.needsRegeneratePrompt()).toBe(true);

    const text = engine.exportRecordMarkdown();
    const engine2 = createEngine();
    engine2.importRecord(text);
    // The suppressed assumption is preserved (still inactive), so a regenerate prompt
    // is still appropriate; but the corrective-edits flag itself is reset.
    expect(engine2.hasCorrectiveEdits()).toBe(false);
  });
});
