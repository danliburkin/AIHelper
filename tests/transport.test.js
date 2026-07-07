import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';
import { isSuccessfulIngest } from '../src/ui/transport.js';

describe('isSuccessfulIngest', () => {
  it('proposals-only', () => {
    expect(
      isSuccessfulIngest({
        hadStructuredBlocks: false,
        proposals: 2,
        ambient: 0,
        memory: 0,
        assumptions: 0,
        facts: 0,
      }),
    ).toBe(true);
  });

  it('ambient-only', () => {
    expect(
      isSuccessfulIngest({
        hadStructuredBlocks: true,
        proposals: 0,
        ambient: 1,
        memory: 0,
        assumptions: 0,
        facts: 0,
      }),
    ).toBe(true);
  });

  it('boards-only', () => {
    expect(
      isSuccessfulIngest({
        hadStructuredBlocks: true,
        proposals: 0,
        ambient: 0,
        memory: 1,
        assumptions: 0,
        facts: 0,
      }),
    ).toBe(true);
  });

  it('empty', () => {
    expect(
      isSuccessfulIngest({
        hadStructuredBlocks: false,
        proposals: 0,
        ambient: 0,
        memory: 0,
        assumptions: 0,
        facts: 0,
      }),
    ).toBe(false);
  });
});

describe('ingest dedupe with PROPOSE-only replies', () => {
  const PROPOSE_ONLY = `===PROPOSE===
- new memory: Likes oat milk | tags: preferences | rationale: stated
===END===`;

  it('produces proposals once when the caller honors the dedupe condition', async () => {
    const engine = createEngine();
    engine.setOriginalTask('Preferences check');

    let lastIngestedText = '';
    async function ingestWithDedupe(text) {
      if (text === lastIngestedText) return null;
      const result = await engine.ingestReplyWithFallback(text);
      if (isSuccessfulIngest(result)) lastIngestedText = text;
      return result;
    }

    const first = await ingestWithDedupe(PROPOSE_ONLY);
    expect(first.proposals).toBe(1);
    expect(engine.getPendingProposals()).toHaveLength(1);

    const second = await ingestWithDedupe(PROPOSE_ONLY);
    expect(second).toBeNull();
    expect(engine.getPendingProposals()).toHaveLength(1);
  });
});
