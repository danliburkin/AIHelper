import { describe, it, expect } from 'vitest';
import { buildBriefing, deriveTopicTags } from '../src/engine/briefing.js';
import { createEngine } from '../src/engine/engine.js';

function mkStateful(opts) {
  return {
    id: opts.id,
    committedText: opts.text,
    originalText: opts.text,
    active: true,
    source: 'imported',
    kind: opts.kind || 'fact',
    status: opts.status || 'active',
    provenance: opts.provenance || 'model_proposed_user_confirmed',
    confidence: opts.confidence || 'medium',
    tags: opts.tags || [],
    links: opts.links || [],
    created_at: opts.created_at || '2024-01-01T00:00:00.000Z',
    updated_at: opts.updated_at || opts.created_at || '2024-01-01T00:00:00.000Z',
  };
}

function emptyState() {
  return {
    memory: [],
    facts: [],
    assumptions: [],
    ambient: [],
    originalTask: '',
    topic: '',
    hasCorrectiveEdits: false,
    lastActivityAt: null,
  };
}

describe('R3 deriveTopicTags', () => {
  it('takes explicit #tags first', () => {
    expect(deriveTopicTags('What about #career and #health?', ['career', 'unrelated'])).toEqual([
      'career',
      'health',
    ]);
  });

  it('falls back to set intersection with known tags', () => {
    expect(deriveTopicTags('Should I switch career paths?', ['career', 'food'])).toEqual([
      'career',
    ]);
  });

  it('returns empty when nothing matches', () => {
    expect(deriveTopicTags('Hello world', ['career', 'food'])).toEqual([]);
  });

  it('strips stopwords and short tokens', () => {
    expect(deriveTopicTags('a the i with',  ['food'])).toEqual([]);
  });
});

describe('R3 buildBriefing — status gate', () => {
  it('drops done / dropped statuses entirely', () => {
    const state = emptyState();
    state.memory.push(
      mkStateful({ id: 'a', text: 'still active', status: 'active', tags: ['x'] }),
      mkStateful({ id: 'b', text: 'finished', status: 'done', tags: ['x'] }),
      mkStateful({ id: 'c', text: 'abandoned', status: 'dropped', tags: ['x'] }),
    );

    const { text } = buildBriefing(state, { topicTags: ['x'] });
    expect(text).toContain('still active');
    expect(text).not.toContain('finished');
    expect(text).not.toContain('abandoned');
  });

  it('drops stale_superseded provenance entirely from the active pool', () => {
    const state = emptyState();
    state.memory.push(
      mkStateful({ id: 'a', text: 'current value', status: 'active', tags: ['x'] }),
      mkStateful({
        id: 'b',
        text: 'old value',
        status: 'active',
        provenance: 'stale_superseded',
        tags: ['x'],
      }),
    );

    const { text } = buildBriefing(state, { topicTags: ['x'] });
    expect(text).toContain('current value');
    expect(text).toMatch(/NO LONGER TRUE:.*old value/);
  });
});

describe('R3 buildBriefing — tag match', () => {
  it('excludes off-topic records when tags are provided', () => {
    const state = emptyState();
    state.memory.push(
      mkStateful({ id: 'a', text: 'career stuff', tags: ['career'] }),
      mkStateful({ id: 'b', text: 'food stuff', tags: ['food'] }),
    );
    const { text } = buildBriefing(state, { topicTags: ['career'] });
    expect(text).toContain('career stuff');
    expect(text).not.toContain('food stuff');
  });

  it('falls back to the whole active pool when no tag matches', () => {
    const state = emptyState();
    state.memory.push(mkStateful({ id: 'a', text: 'career stuff', tags: ['career'] }));
    const { text, meta } = buildBriefing(state, { topicTags: ['nonexistent'] });
    expect(text).toContain('career stuff');
    expect(meta.tagFallback).toBe(true);
  });
});

describe('R3 buildBriefing — ambient always-in', () => {
  it('includes ambient items regardless of topic tag', () => {
    const state = emptyState();
    state.memory.push(mkStateful({ id: 'a', text: 'career stuff', tags: ['career'] }));
    state.ambient.push({
      id: 'amb',
      kind: 'ambient',
      text: 'burnt out by boss',
      intensity: 'high',
      tags: ['mood'],
      created_at: '2024-01-01T00:00:00.000Z',
      last_seen_at: '2024-01-02T00:00:00.000Z',
      active: true,
    });
    const { text } = buildBriefing(state, { topicTags: ['career'] });
    expect(text).toContain('## Ambient context');
    expect(text).toContain('burnt out by boss');
  });

  it('drops stale-intensity ambient items', () => {
    const state = emptyState();
    state.ambient.push({
      id: 'a',
      kind: 'ambient',
      text: 'old mood',
      intensity: 'stale',
      tags: [],
      created_at: '2024-01-01T00:00:00.000Z',
      last_seen_at: '2024-01-02T00:00:00.000Z',
      active: true,
    });
    const { text } = buildBriefing(state);
    expect(text).not.toContain('old mood');
  });
});

describe('R3 buildBriefing — token cap', () => {
  it('drops lowest confidence first, then oldest', () => {
    const state = emptyState();
    // 6 records of 80 chars each → ~480 chars; cap is 50 tokens ≈ 200 chars
    state.memory.push(
      mkStateful({
        id: 'high-old',
        text: 'A'.repeat(80),
        confidence: 'high',
        updated_at: '2023-01-01T00:00:00.000Z',
        tags: ['x'],
      }),
      mkStateful({
        id: 'high-new',
        text: 'B'.repeat(80),
        confidence: 'high',
        updated_at: '2025-01-01T00:00:00.000Z',
        tags: ['x'],
      }),
      mkStateful({
        id: 'low-new',
        text: 'C'.repeat(80),
        confidence: 'low',
        updated_at: '2025-06-01T00:00:00.000Z',
        tags: ['x'],
      }),
      mkStateful({
        id: 'low-old',
        text: 'D'.repeat(80),
        confidence: 'low',
        updated_at: '2022-01-01T00:00:00.000Z',
        tags: ['x'],
      }),
    );

    const { text, meta } = buildBriefing(state, { topicTags: ['x'], tokenBudget: 50 });
    expect(meta.droppedCount).toBeGreaterThan(0);
    // The high-conf newer record must survive.
    expect(text).toContain('B'.repeat(80));
    // The low-conf older record must be the first dropped.
    expect(text).not.toContain('D'.repeat(80));
  });

  it('protects ambient items from the token cap', () => {
    const state = emptyState();
    state.memory.push(
      mkStateful({ id: 'a', text: 'X'.repeat(2000), confidence: 'low', tags: ['x'] }),
    );
    state.ambient.push({
      id: 'amb',
      kind: 'ambient',
      text: 'must survive cap',
      intensity: 'medium',
      tags: [],
      created_at: '2024-01-01T00:00:00.000Z',
      last_seen_at: '2024-01-02T00:00:00.000Z',
      active: true,
    });
    const { text } = buildBriefing(state, { topicTags: ['x'], tokenBudget: 20 });
    expect(text).toContain('must survive cap');
  });

  it('when ambient alone exceeds the budget, flags overflow and keeps newest high-confidence stateful item', () => {
    const state = emptyState();
    state.memory.push(
      mkStateful({
        id: 'high-new',
        text: 'HIGH_CONF_ANCHOR',
        confidence: 'high',
        updated_at: '2025-06-01T00:00:00.000Z',
        tags: ['x'],
      }),
      mkStateful({
        id: 'low-old',
        text: 'LOW_CONF_DROP',
        confidence: 'low',
        updated_at: '2022-01-01T00:00:00.000Z',
        tags: ['x'],
      }),
    );
    state.ambient.push(
      {
        id: 'amb1',
        kind: 'ambient',
        text: 'A'.repeat(120),
        intensity: 'high',
        tags: [],
        created_at: '2024-01-01T00:00:00.000Z',
        last_seen_at: '2024-01-02T00:00:00.000Z',
        active: true,
      },
      {
        id: 'amb2',
        kind: 'ambient',
        text: 'B'.repeat(120),
        intensity: 'medium',
        tags: [],
        created_at: '2024-01-03T00:00:00.000Z',
        last_seen_at: '2024-01-04T00:00:00.000Z',
        active: true,
      },
    );

    const { text, meta } = buildBriefing(state, { topicTags: ['x'], tokenBudget: 30 });
    expect(meta.ambientOverflow).toBe(true);
    expect(text).toContain('A'.repeat(120));
    expect(text).toContain('HIGH_CONF_ANCHOR');
    expect(text).not.toContain('LOW_CONF_DROP');
  });
});

describe('R3 buildBriefing — supersession', () => {
  it('emits a NO LONGER TRUE note when a newer record supersedes an older one', () => {
    const state = emptyState();
    state.memory.push(
      mkStateful({
        id: 'old',
        text: 'lived in Berlin',
        status: 'active',
        provenance: 'stale_superseded',
        tags: ['x'],
      }),
      mkStateful({
        id: 'new',
        text: 'lives in Lisbon',
        status: 'active',
        tags: ['x'],
        links: [{ rel: 'supersedes', target_id: 'old' }],
      }),
    );

    const { text } = buildBriefing(state, { topicTags: ['x'] });
    expect(text).toContain('lives in Lisbon');
    expect(text).toMatch(/NO LONGER TRUE:.*lived in Berlin/);
  });
});

describe('R3 buildBriefing — time awareness', () => {
  it('adds an elapsed line when last activity was a long time ago', () => {
    const state = emptyState();
    state.memory.push(mkStateful({ id: 'a', text: 'topic', tags: ['x'] }));
    const { text, meta } = buildBriefing(state, {
      topicTags: ['x'],
      lastActivityAt: '2024-01-01T00:00:00.000Z',
      now: '2024-01-15T00:00:00.000Z',
    });
    expect(meta.elapsed).toBe('14 days');
    expect(text).toContain('Time elapsed since last activity: 14 days');
  });

  it('does not add an elapsed line for short gaps', () => {
    const state = emptyState();
    state.memory.push(mkStateful({ id: 'a', text: 'topic', tags: ['x'] }));
    const { text } = buildBriefing(state, {
      topicTags: ['x'],
      lastActivityAt: '2024-01-01T00:00:00.000Z',
      now: '2024-01-01T00:30:00.000Z',
    });
    expect(text).not.toContain('Time elapsed');
  });
});

describe('R3 engine integration', () => {
  const REPLY = `===MEMORY===
- Career pivot considered | confidence: medium | tags: career
===FACTS===
- type: computed | content: 7-year tenure is ~3x industry median | confidence: medium | tags: career
===AMBIENT===
- text: burnt out by micromanaging boss | intensity: high | tags: mood
===END===`;

  it('engine.buildBriefing() uses originalTask to derive topic tags', async () => {
    const engine = createEngine();
    engine.setOriginalTask('What about my career?');
    await engine.ingestReplyWithFallback(REPLY);
    const { text, meta } = engine.buildBriefing();
    expect(meta.topicTags).toContain('career');
    expect(text).toContain('Career pivot considered');
    expect(text).toContain('burnt out by micromanaging boss');
  });

  it('the briefing is prepended to the smart prompt and replaces the legacy Context Spec block', async () => {
    const engine = createEngine();
    engine.setOriginalTask('What about my career?');
    await engine.ingestReplyWithFallback(REPLY);
    const prompt = engine.previewSmartPrompt();
    expect(prompt).toContain('===BRIEFING===');
    expect(prompt).toContain('===END_BRIEFING===');
    // Old block heading should not appear in the prompt anymore.
    expect(prompt).not.toContain('## Context Spec');
  });

  it('elapsed-time line survives export → import round-trip', async () => {
    const engine = createEngine();
    engine.setOriginalTask('career topic');
    await engine.ingestReplyWithFallback(REPLY);
    const file = engine.exportRecordMarkdown();

    const engine2 = createEngine();
    engine2.importRecord(file);
    engine2.setOriginalTask('career follow-up');

    const past = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { meta } = engine2.buildBriefing({
      lastActivityAt: past,
      now: new Date().toISOString(),
    });
    expect(meta.elapsed).toMatch(/days/);
  });
});
