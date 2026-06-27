import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';

const SAMPLE_REPLY = `===MEMORY===
- User is learning RAG
===ASSUMPTIONS===
- assumption: Skip basics | reason: topic sounded advanced
===FACTS===
- type: computed | content: Three chunking strategies exist
===END===`;

describe('end-to-end engine loop', () => {
  it('editing context changes restart prompt output', async () => {
    const engine = createEngine();
    engine.setOriginalTask('Explain RAG simply');

    await engine.ingestReplyWithFallback(SAMPLE_REPLY);

    const before = await engine.getComposedPrompt('restart');

    engine.toggleAssumption(
      engine.getBoards().assumptions[0].id,
      false,
    );

    const after = await engine.getComposedPrompt('restart');

    expect(before).toContain('Skip basics');
    expect(after).toContain('ASSUMPTION_DELETE');
    expect(after).toContain('===REVOKED_BY_USER_DO_NOT_USE===');
    expect(after).toContain('Skip basics');
    expect(after).toContain('DELETE from your answer');
    expect(after).toContain('DISCARD your previous answer');
    expect(after).toContain('_No active assumptions._');
  });

  it('memory override pins committed text in context spec', async () => {
    const engine = createEngine();
    await engine.ingestReplyWithFallback(SAMPLE_REPLY);

    const memoryId = engine.getBoards().memory[0].id;
    const committed = await engine.overrideMemory(memoryId, 'I am a complete beginner');
    engine.ratifyMemory(memoryId, committed);

    const spec = engine.buildContextSpec();
    expect(spec).toContain('User states: I am a complete beginner');
    expect(spec).not.toContain('User is learning RAG');
  });

  it('assumption override tells the chatbot to replace the old assumption', async () => {
    const engine = createEngine();
    engine.setOriginalTask('Explain RAG simply');
    await engine.ingestReplyWithFallback(SAMPLE_REPLY);

    const assumptionId = engine.getBoards().assumptions[0].id;
    engine.editAssumption(assumptionId, 'Explain basics first', 'user asked for simple wording');

    const spec = engine.buildContextSpec();
    expect(spec).toContain('[user override] Explain basics first');
    expect(spec).not.toContain('Skip basics');

    const prompt = engine.previewSmartPrompt();
    expect(prompt).toContain('ASSUMPTION_REPLACE_DELETE: "Skip basics"');
    expect(prompt).toContain('ASSUMPTION_REPLACE_USE: "Explain basics first"');
    expect(prompt).toContain('USE INSTEAD (authoritative): "Explain basics first"');
  });
});
