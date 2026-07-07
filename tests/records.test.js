import { describe, it, expect, vi } from 'vitest';
import { parseReplyBlocks, extractTrailingMeta } from '../src/engine/parser.js';
import { createEngine } from '../src/engine/engine.js';
import {
  STATUSES,
  KINDS,
  PROVENANCES,
  CONFIDENCES,
  INTENSITIES,
  defaultsForBoard,
  applyRecordDefaults,
  createAmbientRecord,
  toStatefulRecord,
  toAmbientRecord,
  isWeak,
  isVisiblyUntrusted,
} from '../src/engine/records.js';

describe('R1 schema constants', () => {
  it('exposes the documented vocabularies', () => {
    expect(STATUSES).toEqual(['open', 'active', 'done', 'dropped', 'revived']);
    expect(KINDS).toEqual(['goal', 'fact', 'decision', 'task', 'open_question']);
    expect(PROVENANCES).toEqual([
      'user_asserted',
      'model_proposed_user_confirmed',
      'inferred_from_tool',
      'stale_superseded',
    ]);
    expect(CONFIDENCES).toEqual(['high', 'medium', 'low']);
    expect(INTENSITIES).toEqual(['low', 'medium', 'high', 'stale']);
  });

  it('returns sane defaults per board', () => {
    expect(defaultsForBoard('memory').status).toBe('active');
    expect(defaultsForBoard('memory').provenance).toBe('model_proposed_user_confirmed');
    expect(defaultsForBoard('assumptions').status).toBe('open');
    expect(defaultsForBoard('facts', { factType: 'retrieved' }).provenance).toBe(
      'inferred_from_tool',
    );
    expect(defaultsForBoard('facts', { factType: 'computed' }).provenance).toBe(
      'model_proposed_user_confirmed',
    );
  });

  it('applyRecordDefaults fills missing fields and respects parsed meta', () => {
    const item = { id: 'x', committedText: 'foo', active: true };
    applyRecordDefaults(item, 'memory', { confidence: 'high', tags: ['career'] });
    expect(item.status).toBe('active');
    expect(item.confidence).toBe('high');
    expect(item.tags).toEqual(['career']);
    expect(item.created_at).toBeTruthy();
    expect(item.updated_at).toBeTruthy();
  });
});

describe('R1 ambient records', () => {
  it('createAmbientRecord has NO status field', () => {
    const ambient = createAmbientRecord({ text: 'burnt out by micromanaging boss', intensity: 'high', tags: ['mood'] });
    expect(ambient).not.toHaveProperty('status');
    expect(ambient.kind).toBe('ambient');
    expect(ambient.intensity).toBe('high');
    expect(ambient.tags).toEqual(['mood']);
    expect(ambient.last_seen_at).toBeTruthy();
  });

  it('defaults intensity to medium when invalid', () => {
    const ambient = createAmbientRecord({ text: 'mild constraint', intensity: 'enormous' });
    expect(ambient.intensity).toBe('medium');
  });

  it('toAmbientRecord canonical shape has NO status', () => {
    const ambient = createAmbientRecord({ text: 'tone-matters' });
    const canonical = toAmbientRecord(ambient);
    expect(canonical).not.toHaveProperty('status');
    expect(canonical.kind).toBe('ambient');
  });
});

describe('R1 weak/untrusted flagging', () => {
  it('isWeak only for low + stale_superseded', () => {
    expect(isWeak({ confidence: 'low', provenance: 'stale_superseded' })).toBe(true);
    expect(isWeak({ confidence: 'low', provenance: 'model_proposed_user_confirmed' })).toBe(false);
    expect(isWeak({ confidence: 'high', provenance: 'stale_superseded' })).toBe(false);
  });

  it('isVisiblyUntrusted catches low confidence OR stale provenance', () => {
    expect(isVisiblyUntrusted({ confidence: 'low', provenance: 'model_proposed_user_confirmed' })).toBe(true);
    expect(isVisiblyUntrusted({ confidence: 'high', provenance: 'stale_superseded' })).toBe(true);
    expect(isVisiblyUntrusted({ confidence: 'high', provenance: 'user_asserted' })).toBe(false);
  });
});

describe('R1 parser — trailing meta extraction', () => {
  it('extracts status/confidence/provenance/tags in any order', () => {
    const { rest, meta } = extractTrailingMeta(
      'memory bullet text | tags: career, planning | status: active | confidence: high | provenance: user_asserted',
    );
    expect(rest).toBe('memory bullet text');
    expect(meta.status).toBe('active');
    expect(meta.confidence).toBe('high');
    expect(meta.provenance).toBe('user_asserted');
    expect(meta.tags).toEqual(['career', 'planning']);
  });

  it('ignores invalid enum values silently', () => {
    const { meta } = extractTrailingMeta('text | status: bogus | confidence: super');
    expect(meta.status).toBeUndefined();
    expect(meta.confidence).toBeUndefined();
  });

  it('leaves URL-bearing content alone when no trailing meta', () => {
    const { rest, meta } = extractTrailingMeta(
      'content: thing | source: https://x.com/a?b=1 | date: 2025-06-01',
    );
    expect(rest).toBe('content: thing | source: https://x.com/a?b=1 | date: 2025-06-01');
    expect(meta).toEqual({});
  });
});

describe('R1 parser — memory/fact/assumption with trailing meta', () => {
  const REPLY = `===MEMORY===
- User prefers brief answers | confidence: high | provenance: user_asserted | tags: style
===ASSUMPTIONS===
- assumption: Python stack | reason: prior code | status: open | confidence: low | tags: stack
===FACTS===
- type: retrieved | content: ES8 supports dense vectors | source: https://example.com/es | date: 2024-01-15 | status: active | confidence: high | tags: search
- type: computed | content: 3 strategies compared | confidence: medium
===AMBIENT===
- text: burnt out by micromanaging boss | intensity: high | tags: mood, work
===END===`;

  const parsed = parseReplyBlocks(REPLY);

  it('extracts meta on memory bullets', () => {
    expect(parsed.memory[0].text).toBe('User prefers brief answers');
    expect(parsed.memory[0].meta).toEqual({
      confidence: 'high',
      provenance: 'user_asserted',
      tags: ['style'],
    });
  });

  it('extracts meta on assumptions', () => {
    expect(parsed.assumptions[0].statement).toBe('Python stack');
    expect(parsed.assumptions[0].reason).toBe('prior code');
    expect(parsed.assumptions[0].meta).toEqual({
      status: 'open',
      confidence: 'low',
      tags: ['stack'],
    });
  });

  it('extracts meta on facts while preserving source fields', () => {
    expect(parsed.facts[0].sourceUrl).toBe('https://example.com/es');
    expect(parsed.facts[0].sourceDate).toBe('2024-01-15');
    expect(parsed.facts[0].meta).toEqual({
      status: 'active',
      confidence: 'high',
      tags: ['search'],
    });
    expect(parsed.facts[1].meta).toEqual({ confidence: 'medium' });
  });

  it('parses ambient block with intensity and tags', () => {
    expect(parsed.ambient).toHaveLength(1);
    expect(parsed.ambient[0].text).toBe('burnt out by micromanaging boss');
    expect(parsed.ambient[0].intensity).toBe('high');
    expect(parsed.ambient[0].tags).toEqual(['mood', 'work']);
  });
});

describe('R1 engine — ingest populates typed records', () => {
  const REPLY = `===MEMORY===
- User is learning RAG | confidence: medium | tags: rag
===ASSUMPTIONS===
- assumption: Skip basics | reason: sounded advanced | status: open
===FACTS===
- type: computed | content: Three chunking strategies exist
===AMBIENT===
- text: anxious about deadline | intensity: medium | tags: mood
===END===`;

  it('ingests all four blocks with typed fields and ambient board', async () => {
    const engine = createEngine();
    const added = await engine.ingestReplyWithFallback(REPLY);
    expect(added).toMatchObject({ memory: 1, assumptions: 1, facts: 1, ambient: 1 });

    const boards = engine.getBoards();
    expect(boards.memory[0].status).toBe('active');
    expect(boards.memory[0].confidence).toBe('medium');
    expect(boards.memory[0].tags).toEqual(['rag']);
    expect(boards.assumptions[0].status).toBe('open');
    expect(boards.facts[0].status).toBe('active');
    expect(boards.ambient).toHaveLength(1);
    expect(boards.ambient[0]).not.toHaveProperty('status');
  });

  it('updateRecordStatus accepts only known statuses and bumps updated_at', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY);
    const memId = engine.getBoards().memory[0].id;
    const beforeUpdated = engine.getBoards().memory[0].updated_at;

    // Force a measurable timestamp delta on systems with sub-ms clocks.
    await new Promise((r) => setTimeout(r, 2));

    expect(engine.updateRecordStatus(memId, 'done')).toBe(true);
    expect(engine.updateRecordStatus(memId, 'bogus')).toBe(false);

    const after = engine.getBoards().memory[0];
    expect(after.status).toBe('done');
    expect(after.updated_at >= beforeUpdated).toBe(true);
  });

  it('memory override elevates provenance to user_asserted and confidence to high', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY);
    const memId = engine.getBoards().memory[0].id;

    const committed = await engine.overrideMemory(memId, 'I am a complete beginner');
    engine.ratifyMemory(memId, committed);

    const after = engine.getBoards().memory[0];
    expect(after.provenance).toBe('user_asserted');
    expect(after.confidence).toBe('high');
    expect(after.source).toBe('user_override');
  });

  it('getRecords returns canonical shapes; stateful has status, ambient has no status', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(REPLY);
    const { stateful, ambient } = engine.getRecords();

    expect(stateful.length).toBe(3);
    for (const rec of stateful) {
      expect(rec).toHaveProperty('status');
      expect(rec).toHaveProperty('confidence');
      expect(rec).toHaveProperty('provenance');
      expect(rec).toHaveProperty('tags');
      expect(rec).toHaveProperty('links');
      expect(rec).toHaveProperty('created_at');
      expect(rec).toHaveProperty('updated_at');
    }
    expect(ambient).toHaveLength(1);
    expect(ambient[0]).not.toHaveProperty('status');
    expect(ambient[0].last_seen_at).toBeTruthy();
  });
});

describe('R1 toStatefulRecord canonical shape', () => {
  it('exposes board name and text uniformly', () => {
    const item = { id: '1', committedText: 'foo', tags: ['a'], links: [] };
    applyRecordDefaults(item, 'memory');
    const rec = toStatefulRecord(item, 'memory');
    expect(rec.board).toBe('memory');
    expect(rec.text).toBe('foo');
    expect(rec.tags).toEqual(['a']);
  });
});

describe('ingestReplyWithFallback — parse metadata', () => {
  it('reports structuredParseEmpty when structured blocks are absent', async () => {
    const engine = createEngine();
    const result = await engine.ingestReplyWithFallback('plain chat answer with no blocks');
    expect(result.structuredParseEmpty).toBe(true);
    expect(result.usedNano).toBe(false);
  });

  it('reports structuredParseEmpty false when structured blocks parse', async () => {
    const engine = createEngine();
    const result = await engine.ingestReplyWithFallback(`===MEMORY===
- item
===END===`);
    expect(result.structuredParseEmpty).toBe(false);
    expect(result.usedNano).toBe(false);
  });

  it('reports usedNano only when Nano fallback produces items', async () => {
    const nano = await import('../src/engine/nano.js');
    const spy = vi.spyOn(nano, 'parseWithNanoFallback').mockResolvedValue({
      memory: ['from nano'],
      assumptions: [],
      facts: [],
      ambient: [],
    });
    const engine = createEngine();
    const result = await engine.ingestReplyWithFallback('unstructured blob');
    expect(result.structuredParseEmpty).toBe(true);
    expect(result.usedNano).toBe(true);
    expect(result.memory).toBe(1);
    spy.mockRestore();
  });

  it('structuredParseEmpty with Nano producing nothing leaves usedNano false', async () => {
    const nano = await import('../src/engine/nano.js');
    const spy = vi.spyOn(nano, 'parseWithNanoFallback').mockResolvedValue({
      memory: [],
      assumptions: [],
      facts: [],
      ambient: [],
    });
    const engine = createEngine();
    const result = await engine.ingestReplyWithFallback('unstructured blob');
    expect(result.structuredParseEmpty).toBe(true);
    expect(result.usedNano).toBe(false);
    spy.mockRestore();
  });
});
