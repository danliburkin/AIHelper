import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Minimal in-memory localStorage shim — vitest's default node environment has
 * no localStorage global. This avoids adding jsdom as a dependency just for
 * one module's tests.
 */
function installFakeLocalStorage() {
  const backing = new Map();
  const fake = {
    getItem: (key) => (backing.has(key) ? backing.get(key) : null),
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
    clear: () => backing.clear(),
  };
  globalThis.localStorage = fake;
  return fake;
}

beforeEach(() => {
  installFakeLocalStorage();
  vi.resetModules();
});

describe('storage — availability', () => {
  it('isStorageAvailable is true when localStorage works', async () => {
    const { isStorageAvailable } = await import('../src/engine/storage.js');
    expect(isStorageAvailable()).toBe(true);
  });

  it('isStorageAvailable is false when localStorage is undefined', async () => {
    delete globalThis.localStorage;
    const { isStorageAvailable } = await import('../src/engine/storage.js');
    expect(isStorageAvailable()).toBe(false);
  });

  it('all functions degrade gracefully with no localStorage (no throw)', async () => {
    delete globalThis.localStorage;
    const storage = await import('../src/engine/storage.js');
    expect(() => storage.listConversations()).not.toThrow();
    expect(storage.listConversations()).toEqual([]);
    expect(storage.loadConversation('x')).toBeNull();
    expect(storage.saveConversation('x', {})).toBe(false);
    expect(storage.renameConversation('x', 'y')).toBe(false);
    expect(storage.deleteConversation('x')).toBe(false);
    expect(storage.getActiveConversationId()).toBeNull();
    expect(storage.setActiveConversationId('x')).toBe(false);
  });
});

describe('storage — createConversationId', () => {
  it('produces unique ids', async () => {
    const { createConversationId } = await import('../src/engine/storage.js');
    const a = createConversationId();
    const b = createConversationId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('storage — save / load / list', () => {
  it('saveConversation writes the snapshot and creates an index entry', async () => {
    const { saveConversation, loadConversation, listConversations } = await import(
      '../src/engine/storage.js'
    );
    const snapshot = { format: 'context-lens-record', version: 1, originalTask: 'Explain RAG', memory: [] };
    const ok = saveConversation('conv-1', snapshot);
    expect(ok).toBe(true);

    const loaded = loadConversation('conv-1');
    expect(loaded).toEqual(snapshot);

    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('conv-1');
    expect(list[0].title).toBe('Explain RAG');
    expect(list[0].updatedAt).toBeTruthy();
  });

  it('derives a fallback title when originalTask is empty', async () => {
    const { saveConversation, listConversations } = await import('../src/engine/storage.js');
    saveConversation('conv-2', { format: 'context-lens-record', version: 1, originalTask: '', memory: [] });
    const entry = listConversations().find((e) => e.id === 'conv-2');
    expect(entry.title).toBe('Untitled conversation');
  });

  it('truncates a long originalTask to 60 chars for the title', async () => {
    const { saveConversation, listConversations } = await import('../src/engine/storage.js');
    const longTask = 'A'.repeat(120);
    saveConversation('conv-3', { format: 'context-lens-record', version: 1, originalTask: longTask, memory: [] });
    const entry = listConversations().find((e) => e.id === 'conv-3');
    expect(entry.title).toBe('A'.repeat(60));
  });

  it('an explicit title override wins over the derived one', async () => {
    const { saveConversation, listConversations } = await import('../src/engine/storage.js');
    saveConversation(
      'conv-4',
      { format: 'context-lens-record', version: 1, originalTask: 'ignored', memory: [] },
      'My custom title',
    );
    const entry = listConversations().find((e) => e.id === 'conv-4');
    expect(entry.title).toBe('My custom title');
  });

  it('re-saving the same id updates the snapshot and bumps updatedAt without duplicating the index entry', async () => {
    const { saveConversation, listConversations, loadConversation } = await import(
      '../src/engine/storage.js'
    );
    saveConversation('conv-5', { format: 'context-lens-record', version: 1, originalTask: 'v1', memory: [] });
    const firstUpdatedAt = listConversations().find((e) => e.id === 'conv-5').updatedAt;

    await new Promise((r) => setTimeout(r, 2));
    saveConversation('conv-5', { format: 'context-lens-record', version: 1, originalTask: 'v2', memory: [] });

    const list = listConversations().filter((e) => e.id === 'conv-5');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('v2');
    expect(list[0].updatedAt >= firstUpdatedAt).toBe(true);
    expect(loadConversation('conv-5').originalTask).toBe('v2');
  });

  it('loadConversation returns null for an unknown id', async () => {
    const { loadConversation } = await import('../src/engine/storage.js');
    expect(loadConversation('does-not-exist')).toBeNull();
  });

  it('listConversations sorts newest updatedAt first', async () => {
    const { saveConversation, listConversations } = await import('../src/engine/storage.js');
    saveConversation('older', { format: 'context-lens-record', version: 1, originalTask: 'older', memory: [] });
    await new Promise((r) => setTimeout(r, 2));
    saveConversation('newer', { format: 'context-lens-record', version: 1, originalTask: 'newer', memory: [] });

    const list = listConversations();
    expect(list[0].id).toBe('newer');
    expect(list.find((e) => e.id === 'older')).toBeTruthy();
  });
});

describe('storage — rename', () => {
  it('renames an existing conversation without touching its snapshot', async () => {
    const { saveConversation, renameConversation, listConversations, loadConversation } = await import(
      '../src/engine/storage.js'
    );
    saveConversation('conv-r', { format: 'context-lens-record', version: 1, originalTask: 'orig', memory: [] });
    const ok = renameConversation('conv-r', 'Renamed title');
    expect(ok).toBe(true);

    const entry = listConversations().find((e) => e.id === 'conv-r');
    expect(entry.title).toBe('Renamed title');
    expect(loadConversation('conv-r').originalTask).toBe('orig');
  });

  it('returns false when renaming a nonexistent conversation', async () => {
    const { renameConversation } = await import('../src/engine/storage.js');
    expect(renameConversation('nope', 'x')).toBe(false);
  });

  it('a custom title survives subsequent saveConversation calls (auto-derivation is locked out)', async () => {
    const { saveConversation, renameConversation, listConversations } = await import('../src/engine/storage.js');
    saveConversation('conv-lock', { format: 'context-lens-record', version: 1, originalTask: 'first question', memory: [] });
    renameConversation('conv-lock', 'My custom name');

    // Later saves with a different originalTask must NOT clobber the custom title.
    saveConversation('conv-lock', { format: 'context-lens-record', version: 1, originalTask: 'a totally different question', memory: [] });

    const entry = listConversations().find((e) => e.id === 'conv-lock');
    expect(entry.title).toBe('My custom name');
  });

  it('without an explicit rename, the title keeps tracking the latest originalTask', async () => {
    const { saveConversation, listConversations } = await import('../src/engine/storage.js');
    saveConversation('conv-track', { format: 'context-lens-record', version: 1, originalTask: 'question 1', memory: [] });
    saveConversation('conv-track', { format: 'context-lens-record', version: 1, originalTask: 'question 2', memory: [] });

    const entry = listConversations().find((e) => e.id === 'conv-track');
    expect(entry.title).toBe('question 2');
  });
});

describe('storage — delete', () => {
  it('removes the snapshot and index entry', async () => {
    const { saveConversation, deleteConversation, listConversations, loadConversation } = await import(
      '../src/engine/storage.js'
    );
    saveConversation('conv-d', { format: 'context-lens-record', version: 1, originalTask: 'x', memory: [] });
    expect(listConversations().find((e) => e.id === 'conv-d')).toBeTruthy();

    deleteConversation('conv-d');
    expect(listConversations().find((e) => e.id === 'conv-d')).toBeUndefined();
    expect(loadConversation('conv-d')).toBeNull();
  });

  it('clears the active id if it pointed at the deleted conversation', async () => {
    const { saveConversation, setActiveConversationId, deleteConversation, getActiveConversationId } =
      await import('../src/engine/storage.js');
    saveConversation('conv-active', { format: 'context-lens-record', version: 1, originalTask: 'x', memory: [] });
    setActiveConversationId('conv-active');
    expect(getActiveConversationId()).toBe('conv-active');

    deleteConversation('conv-active');
    expect(getActiveConversationId()).toBeNull();
  });

  it('deleting one conversation does not affect others', async () => {
    const { saveConversation, deleteConversation, listConversations } = await import('../src/engine/storage.js');
    saveConversation('keep-1', { format: 'context-lens-record', version: 1, originalTask: 'a', memory: [] });
    saveConversation('remove-me', { format: 'context-lens-record', version: 1, originalTask: 'b', memory: [] });
    saveConversation('keep-2', { format: 'context-lens-record', version: 1, originalTask: 'c', memory: [] });

    deleteConversation('remove-me');
    const ids = listConversations().map((e) => e.id).sort();
    expect(ids).toEqual(['keep-1', 'keep-2']);
  });
});

describe('storage — active conversation id', () => {
  it('round-trips get/set', async () => {
    const { setActiveConversationId, getActiveConversationId } = await import('../src/engine/storage.js');
    expect(getActiveConversationId()).toBeNull();
    setActiveConversationId('abc-123');
    expect(getActiveConversationId()).toBe('abc-123');
  });
});
