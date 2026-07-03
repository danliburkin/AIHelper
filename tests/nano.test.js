import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine/engine.js';

afterEach(() => {
  delete globalThis.LanguageModel;
});

describe('Nano fallback reporting', () => {
  it('reports structuredParseEmpty without claiming Nano use when Nano adds nothing', async () => {
    globalThis.LanguageModel = {
      availability: vi.fn().mockResolvedValue('unavailable'),
    };
    const engine = createEngine();

    const result = await engine.ingestReplyWithFallback('plain answer with no blocks');

    expect(result.structuredParseEmpty).toBe(true);
    expect(result.usedNano).toBe(false);
    expect(result.memory + result.assumptions + result.facts + result.ambient).toBe(0);
  });

  it('reports Nano use only when fallback parsing produces items', async () => {
    const prompt = vi.fn().mockResolvedValue('===MEMORY===\n- normalized memory\n===END===');
    globalThis.LanguageModel = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({
        prompt,
        destroy: vi.fn(),
      }),
    };
    const engine = createEngine();

    const result = await engine.ingestReplyWithFallback('plain answer with no blocks');

    expect(result.structuredParseEmpty).toBe(true);
    expect(result.usedNano).toBe(true);
    expect(result.memory).toBe(1);
    expect(engine.getBoards().memory[0].committedText).toBe('normalized memory');
  });
});
