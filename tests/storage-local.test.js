import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('local storage adapter — availability', () => {
  it('isAvailable reports true when localStorage works', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    const result = await storage.isAvailable();
    expect(result).toEqual({ ok: true, available: true });
  });

  it('isAvailable reports unavailable when store is null', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter(null);
    const result = await storage.isAvailable();
    expect(result).toEqual({ ok: true, available: false });
  });

  it('mutations return ok:false when store is null', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter(null);
    expect(await storage.listConversations()).toEqual({ ok: false, conversations: [] });
    expect(await storage.saveConversation('x', {})).toEqual({ ok: false });
    expect(await storage.loadConversation('x')).toEqual({ ok: false, snapshot: null });
    expect(await storage.renameConversation('x', 'y')).toEqual({ ok: false });
    expect(await storage.deleteConversation('x')).toEqual({ ok: false });
    expect(await storage.getActiveConversationId()).toEqual({ ok: false, id: null });
    expect(await storage.setActiveConversationId('x')).toEqual({ ok: false });
  });
});

describe('local storage adapter — createConversationId', () => {
  it('produces unique ids', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    const a = storage.createConversationId();
    const b = storage.createConversationId();
    expect(a).not.toBe(b);
    expect(typeof a).toBe('string');
  });
});

describe('local storage adapter — save / load / list', () => {
  it('saveConversation writes the snapshot and creates an index entry', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    const snapshot = { format: 'context-lens-record', version: 1, originalTask: 'Explain RAG', memory: [] };
    expect(await storage.saveConversation('conv-1', snapshot)).toEqual({ ok: true });

    const loaded = await storage.loadConversation('conv-1');
    expect(loaded).toEqual({ ok: true, snapshot });

    const list = await storage.listConversations();
    expect(list.ok).toBe(true);
    expect(list.conversations).toHaveLength(1);
    expect(list.conversations[0].id).toBe('conv-1');
    expect(list.conversations[0].title).toBe('Explain RAG');
  });

  it('derives a fallback title when originalTask is empty', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-2', { format: 'context-lens-record', version: 1, originalTask: '', memory: [] });
    const list = await storage.listConversations();
    const entry = list.conversations.find((e) => e.id === 'conv-2');
    expect(entry.title).toBe('Untitled conversation');
  });

  it('truncates a long originalTask to 60 chars for the title', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    const longTask = 'A'.repeat(120);
    await storage.saveConversation('conv-3', { format: 'context-lens-record', version: 1, originalTask: longTask, memory: [] });
    const list = await storage.listConversations();
    expect(list.conversations.find((e) => e.id === 'conv-3').title).toBe('A'.repeat(60));
  });

  it('an explicit title override wins over the derived one', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation(
      'conv-4',
      { format: 'context-lens-record', version: 1, originalTask: 'ignored', memory: [] },
      'My custom title',
    );
    const list = await storage.listConversations();
    expect(list.conversations.find((e) => e.id === 'conv-4').title).toBe('My custom title');
  });

  it('re-saving updates snapshot without duplicating index entry', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-5', { format: 'context-lens-record', version: 1, originalTask: 'v1', memory: [] });
    const firstUpdatedAt = (await storage.listConversations()).conversations.find((e) => e.id === 'conv-5').updatedAt;

    await new Promise((r) => setTimeout(r, 2));
    await storage.saveConversation('conv-5', { format: 'context-lens-record', version: 1, originalTask: 'v2', memory: [] });

    const list = (await storage.listConversations()).conversations.filter((e) => e.id === 'conv-5');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('v2');
    expect(list[0].updatedAt >= firstUpdatedAt).toBe(true);
    expect((await storage.loadConversation('conv-5')).snapshot.originalTask).toBe('v2');
  });

  it('loadConversation returns ok:false for unknown id', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    expect(await storage.loadConversation('does-not-exist')).toEqual({ ok: false, snapshot: null });
  });

  it('listConversations sorts newest updatedAt first', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('older', { format: 'context-lens-record', version: 1, originalTask: 'older', memory: [] });
    await new Promise((r) => setTimeout(r, 2));
    await storage.saveConversation('newer', { format: 'context-lens-record', version: 1, originalTask: 'newer', memory: [] });

    const list = (await storage.listConversations()).conversations;
    expect(list[0].id).toBe('newer');
  });
});

describe('local storage adapter — rename', () => {
  it('renames without touching snapshot', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-r', { format: 'context-lens-record', version: 1, originalTask: 'orig', memory: [] });
    expect(await storage.renameConversation('conv-r', 'Renamed title')).toEqual({ ok: true });

    const entry = (await storage.listConversations()).conversations.find((e) => e.id === 'conv-r');
    expect(entry.title).toBe('Renamed title');
    expect((await storage.loadConversation('conv-r')).snapshot.originalTask).toBe('orig');
  });

  it('returns ok:false when renaming a nonexistent conversation', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    expect(await storage.renameConversation('nope', 'x')).toEqual({ ok: false });
  });

  it('custom title survives subsequent saves', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-lock', { format: 'context-lens-record', version: 1, originalTask: 'first question', memory: [] });
    await storage.renameConversation('conv-lock', 'My custom name');
    await storage.saveConversation('conv-lock', { format: 'context-lens-record', version: 1, originalTask: 'a totally different question', memory: [] });

    const entry = (await storage.listConversations()).conversations.find((e) => e.id === 'conv-lock');
    expect(entry.title).toBe('My custom name');
  });

  it('without rename, title tracks latest originalTask', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-track', { format: 'context-lens-record', version: 1, originalTask: 'question 1', memory: [] });
    await storage.saveConversation('conv-track', { format: 'context-lens-record', version: 1, originalTask: 'question 2', memory: [] });

    const entry = (await storage.listConversations()).conversations.find((e) => e.id === 'conv-track');
    expect(entry.title).toBe('question 2');
  });
});

describe('local storage adapter — delete', () => {
  it('removes snapshot and index entry', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-d', { format: 'context-lens-record', version: 1, originalTask: 'x', memory: [] });
    expect(await storage.deleteConversation('conv-d')).toEqual({ ok: true });
    expect((await storage.listConversations()).conversations.find((e) => e.id === 'conv-d')).toBeUndefined();
    expect(await storage.loadConversation('conv-d')).toEqual({ ok: false, snapshot: null });
  });

  it('clears active id when deleting active conversation', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('conv-active', { format: 'context-lens-record', version: 1, originalTask: 'x', memory: [] });
    await storage.setActiveConversationId('conv-active');
    await storage.deleteConversation('conv-active');
    expect(await storage.getActiveConversationId()).toEqual({ ok: true, id: null });
  });

  it('deleting one conversation does not affect others', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    await storage.saveConversation('keep-1', { format: 'context-lens-record', version: 1, originalTask: 'a', memory: [] });
    await storage.saveConversation('remove-me', { format: 'context-lens-record', version: 1, originalTask: 'b', memory: [] });
    await storage.saveConversation('keep-2', { format: 'context-lens-record', version: 1, originalTask: 'c', memory: [] });

    await storage.deleteConversation('remove-me');
    const ids = (await storage.listConversations()).conversations.map((e) => e.id).sort();
    expect(ids).toEqual(['keep-1', 'keep-2']);
  });
});

describe('local storage adapter — active conversation id', () => {
  it('round-trips get/set', async () => {
    const { createLocalStorageAdapter } = await import('../src/storage/local.js');
    const storage = createLocalStorageAdapter();
    expect(await storage.getActiveConversationId()).toEqual({ ok: true, id: null });
    expect(await storage.setActiveConversationId('abc-123')).toEqual({ ok: true });
    expect(await storage.getActiveConversationId()).toEqual({ ok: true, id: 'abc-123' });
  });
});
