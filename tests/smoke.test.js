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
    // R3: the briefing replaced the legacy Context Spec block; the revoked
    // assumption must not appear in the active stateful record section.
    expect(after).toContain('===BRIEFING===');
    expect(after.split('===END_BRIEFING===')[0]).not.toContain('[assumptions]');
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
});
