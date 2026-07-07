import { describe, it, expect } from 'vitest';
import { createEngine } from '../src/engine/engine.js';
import { buildRevocations, hasRevocations, buildRevocationAlert } from '../src/engine/contextSpec.js';

const REPLY = `===MEMORY===
- User prefers brief answers
===ASSUMPTIONS===
- assumption: Python stack | reason: earlier code samples were Python
- assumption: Skip basics | reason: sounded advanced
===FACTS===
- type: computed | content: Three strategies compared
===END===`;

async function seedEngine() {
  const engine = createEngine();
  engine.setOriginalTask('Explain RAG');
  await engine.ingestReplyWithFallback(REPLY);
  return engine;
}

describe('assumption edit revocations — originalStatement/Reason tracking', () => {
  it('editAssumption preserves original statement and reason before first edit', async () => {
    const engine = await seedEngine();
    const { assumptions } = engine.getBoards();
    const [a] = assumptions;

    expect(a.originalStatement).toBe('Python stack');
    expect(a.originalReason).toBe('earlier code samples were Python');

    engine.editAssumption(a.id, 'TypeScript stack', 'all recent snippets were TypeScript');

    const updated = engine.getBoards().assumptions.find((x) => x.id === a.id);
    expect(updated.statement).toBe('TypeScript stack');
    expect(updated.reason).toBe('all recent snippets were TypeScript');
    expect(updated.originalStatement).toBe('Python stack');
    expect(updated.originalReason).toBe('earlier code samples were Python');
  });

  it('originalStatement not overwritten on subsequent edits (preserves the very first wording)', async () => {
    const engine = await seedEngine();
    const { assumptions } = engine.getBoards();
    const [a] = assumptions;

    engine.editAssumption(a.id, 'First edit', 'reason A');
    engine.editAssumption(a.id, 'Second edit', 'reason B');

    const updated = engine.getBoards().assumptions.find((x) => x.id === a.id);
    expect(updated.originalStatement).toBe('Python stack');
    expect(updated.statement).toBe('Second edit');
  });

  it('unedited assumption has identical original and current text — no revocation emitted', async () => {
    const engine = await seedEngine();
    const boards = engine.getBoards();
    const rev = buildRevocations(boards);
    expect(rev).not.toContain('Corrected assumptions');
    expect(rev).not.toContain('ASSUMPTION_REPLACE_DELETE');
  });
});

describe('assumption edit revocations — buildRevocations output', () => {
  it('emits Corrected assumptions section when statement is edited', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.editAssumption(a.id, 'TypeScript stack', a.reason);

    const rev = buildRevocations(engine.getBoards());
    expect(rev).toContain('## Corrected assumptions — REPLACE old wording with new');
    expect(rev).toContain('DELETE/IGNORE: "Python stack"');
    expect(rev).toContain('USE INSTEAD (authoritative): "TypeScript stack"');
  });

  it('emits reason correction when only reason changes', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.editAssumption(a.id, a.statement, 'all snippets were TypeScript not Python');

    const rev = buildRevocations(engine.getBoards());
    expect(rev).toContain('Reason correction:');
    expect(rev).toContain('was "likely because earlier code samples were Python"');
    expect(rev).toContain('now "likely because all snippets were TypeScript not Python"');
  });

  it('emits both statement and reason correction when both change', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.editAssumption(a.id, 'Rust stack', 'all recent examples were in Rust');

    const rev = buildRevocations(engine.getBoards());
    expect(rev).toContain('DELETE/IGNORE: "Python stack"');
    expect(rev).toContain('USE INSTEAD (authoritative): "Rust stack"');
    expect(rev).toContain('Reason correction:');
  });

  it('does NOT emit Corrected section for a simple toggle-off (unchecked) assumption', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.toggleAssumption(a.id, false);

    const rev = buildRevocations(engine.getBoards());
    expect(rev).toContain('## Revoked assumptions — DELETE from your answer');
    expect(rev).not.toContain('## Corrected assumptions');
  });

  it('hasRevocations returns true after an assumption edit', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    expect(hasRevocations(engine.getBoards())).toBe(false);

    engine.editAssumption(a.id, 'Go stack', a.reason);
    expect(hasRevocations(engine.getBoards())).toBe(true);
  });
});

describe('assumption edit revocations — buildRevocationAlert (===REVOKED=== block)', () => {
  it('includes ASSUMPTION_REPLACE_DELETE and ASSUMPTION_REPLACE_USE in the alert block', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.editAssumption(a.id, 'TypeScript stack', a.reason);

    const alert = buildRevocationAlert(engine.getBoards());
    expect(alert).toContain('===REVOKED_BY_USER_DO_NOT_USE===');
    expect(alert).toContain('ASSUMPTION_REPLACE_DELETE: "Python stack"');
    expect(alert).toContain('ASSUMPTION_REPLACE_USE: "TypeScript stack"');
  });

  it('includes reason change in the alert when reason is edited', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.editAssumption(a.id, a.statement, 'new reason here');

    const alert = buildRevocationAlert(engine.getBoards());
    expect(alert).toContain('ASSUMPTION_REASON_WAS: "earlier code samples were Python" → NOW: "new reason here"');
  });

  it('composeSmartPrompt triggers REGENERATE when assumption is edited', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;

    expect(engine.needsRegeneratePrompt()).toBe(false);
    engine.editAssumption(a.id, 'Go stack', a.reason);
    expect(engine.needsRegeneratePrompt()).toBe(true);

    const prompt = engine.previewSmartPrompt();
    expect(prompt).toContain('REGENERATE from scratch');
    expect(prompt).toContain('ASSUMPTION_REPLACE_DELETE: "Python stack"');
    expect(prompt).toContain('ASSUMPTION_REPLACE_USE: "Go stack"');
  });
});

describe('assumption edit revocations — round-trip through export/import', () => {
  it('originalStatement/originalReason survive export → import', async () => {
    const engine = await seedEngine();
    const [a] = engine.getBoards().assumptions;
    engine.editAssumption(a.id, 'Rust stack', 'all examples were Rust');

    const file = engine.exportRecordMarkdown();
    const engine2 = createEngine();
    engine2.importRecord(file);

    const after = engine2.getBoards().assumptions.find((x) => x.id === a.id);
    expect(after.originalStatement).toBe('Python stack');
    expect(after.statement).toBe('Rust stack');

    // After import, the revocation should still be surfaced in the next prompt.
    const rev = buildRevocations(engine2.getBoards());
    expect(rev).toContain('DELETE/IGNORE: "Python stack"');
    expect(rev).toContain('USE INSTEAD (authoritative): "Rust stack"');
  });
});
