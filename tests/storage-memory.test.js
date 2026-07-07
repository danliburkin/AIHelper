import { describe, it, expect } from 'vitest';
import { createMemoryStorageAdapter } from '../src/storage/memory.js';

describe('memory storage adapter', () => {
  it('persists conversations in memory', async () => {
    const storage = createMemoryStorageAdapter();
    const snapshot = { format: 'context-lens-record', version: 1, originalTask: 'Test', memory: [] };
    const id = storage.createConversationId();
    expect(await storage.saveConversation(id, snapshot)).toEqual({ ok: true });

    expect(await storage.loadConversation(id)).toEqual({ ok: true, snapshot });
    const list = await storage.listConversations();
    expect(list.conversations).toHaveLength(1);
    expect(list.conversations[0].title).toBe('Test');
  });

  it('is always available', async () => {
    const storage = createMemoryStorageAdapter();
    expect(await storage.isAvailable()).toEqual({ ok: true, available: true });
  });

  it('round-trips active conversation id', async () => {
    const storage = createMemoryStorageAdapter();
    expect(await storage.getActiveConversationId()).toEqual({ ok: true, id: null });
    await storage.setActiveConversationId('abc');
    expect(await storage.getActiveConversationId()).toEqual({ ok: true, id: 'abc' });
  });
});
