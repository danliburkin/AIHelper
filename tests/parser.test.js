import { describe, it, expect } from 'vitest';
import { parseReplyBlocks, hasStructuredBlocks } from '../src/engine/parser.js';

const WELL_FORMED = `Here is my answer about RAG.

===MEMORY===
- User prefers concise explanations
- Prior discussion mentioned vector databases
===ASSUMPTIONS===
- assumption: RAG not explained | reason: treated you as an experienced developer
- assumption: Python stack | reason: earlier code samples were in Python
===FACTS===
- type: retrieved | content: Elasticsearch 8 supports dense vectors | source: https://example.com/es | date: 2024-01-15
- type: computed | content: Three retrieval strategies were compared
===END===
`;

describe('parseReplyBlocks', () => {
  it('parses a well-formed reply', () => {
    const result = parseReplyBlocks(WELL_FORMED);

    expect(result.memory.map((m) => m.text)).toEqual([
      'User prefers concise explanations',
      'Prior discussion mentioned vector databases',
    ]);
    expect(result.memory.every((m) => m.meta && typeof m.meta === 'object')).toBe(true);

    expect(result.assumptions).toHaveLength(2);
    expect(result.assumptions[0].statement).toBe('RAG not explained');
    expect(result.assumptions[0].reason).toBe('treated you as an experienced developer');
    expect(result.assumptions[1].statement).toBe('Python stack');
    expect(result.assumptions[1].reason).toBe('earlier code samples were in Python');

    expect(result.facts).toHaveLength(2);
    expect(result.facts[0]).toMatchObject({
      type: 'retrieved',
      content: 'Elasticsearch 8 supports dense vectors',
      sourceUrl: 'https://example.com/es',
      sourceDate: '2024-01-15',
    });
    expect(result.facts[1]).toMatchObject({
      type: 'computed',
      content: 'Three retrieval strategies were compared',
      sourceUrl: undefined,
      sourceDate: undefined,
    });

    expect(Array.isArray(result.ambient)).toBe(true);
    expect(result.ambient).toEqual([]);
  });

  it('handles missing sections gracefully', () => {
    const partial = `===MEMORY===
- Only memory here
===END===`;

    const result = parseReplyBlocks(partial);
    expect(result.memory.map((m) => m.text)).toEqual(['Only memory here']);
    expect(result.assumptions).toEqual([]);
    expect(result.facts).toEqual([]);
    expect(result.ambient).toEqual([]);
  });

  it('ignores malformed lines', () => {
    const malformed = `===ASSUMPTIONS===
- not a valid assumption line
- assumption: Valid one | reason: valid reason
- assumption: missing reason pipe
===END===`;

    const result = parseReplyBlocks(malformed);
    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions[0].statement).toBe('Valid one');
    expect(result.assumptions[0].reason).toBe('valid reason');
  });

  it('handles extra whitespace and blank lines', () => {
    const spaced = `===FACTS===

- type: computed | content:   spaced content   

===END===`;

    const result = parseReplyBlocks(spaced);
    expect(result.facts[0].content).toBe('spaced content');
  });

  it('parses content with pipes and URLs in fields', () => {
    const tricky = `===FACTS===
- type: retrieved | content: A | B partnership announced | source: https://a.com/x?y=1 | date: 2025-06-01
===END===`;

    const result = parseReplyBlocks(tricky);
    expect(result.facts[0].content).toBe('A | B partnership announced');
    expect(result.facts[0].sourceUrl).toBe('https://a.com/x?y=1');
  });

  it('returns empty arrays for empty or invalid input', () => {
    const empty = { memory: [], assumptions: [], facts: [], ambient: [] };
    expect(parseReplyBlocks('')).toEqual(empty);
    expect(parseReplyBlocks(null)).toEqual(empty);
    expect(parseReplyBlocks('no blocks here')).toEqual(empty);
  });

  it('detects structured blocks', () => {
    expect(hasStructuredBlocks(WELL_FORMED)).toBe(true);
    expect(hasStructuredBlocks('plain text')).toBe(false);
  });
});

describe('buildContextSpec', () => {
  it('serializes active committed state only', async () => {
    const { buildContextSpec } = await import('../src/engine/contextSpec.js');

    const spec = buildContextSpec({
      memory: [
        {
          committedText: 'Pinned memory',
          active: true,
        },
        {
          committedText: 'Hidden memory',
          active: false,
        },
      ],
      facts: [
        {
          type: 'computed',
          content: 'Inferred total',
          active: true,
        },
      ],
      assumptions: [
        {
          statement: 'Uses REST',
          reason: 'API examples were RESTful',
          active: true,
        },
      ],
    });

    expect(spec).toContain('Pinned memory');
    expect(spec).not.toContain('Hidden memory');
    expect(spec).toContain('[computed] Inferred total');
    expect(spec).toContain('Uses REST');
    expect(spec).toContain('likely because: API examples were RESTful');
  });
});

describe('composeSmartPrompt', () => {
  it('uses task before edits and restart after', async () => {
    const { composeSmartPrompt } = await import('../src/engine/prompts.js');
    const state = {
      originalTask: 'Explain RAG simply',
      topic: 'Explain RAG simply',
      memory: [],
      facts: [],
      assumptions: [],
      hasCorrectiveEdits: false,
    };

    expect(composeSmartPrompt(state)).toContain('Perform the following task');

    state.hasCorrectiveEdits = true;
    state.assumptions = [
      { id: '1', statement: 'Skip basics', reason: 'sounded advanced', active: false },
    ];
    expect(composeSmartPrompt(state)).toContain('REGENERATE from scratch');
    expect(composeSmartPrompt(state)).toContain('ASSUMPTION_DELETE');
  });

  it('detects unchecked assumptions even without edit flag', async () => {
    const { composeSmartPrompt } = await import('../src/engine/prompts.js');
    const state = {
      originalTask: 'Explain RAG simply',
      topic: 'Explain RAG simply',
      memory: [],
      facts: [],
      assumptions: [
        { id: '1', statement: 'Skip basics', reason: 'sounded advanced', active: false },
      ],
      hasCorrectiveEdits: false,
    };

    const prompt = composeSmartPrompt(state);
    expect(prompt).toContain('===REVOKED_BY_USER_DO_NOT_USE===');
    expect(prompt).toContain('ASSUMPTION_DELETE: "Skip basics"');
  });
});
