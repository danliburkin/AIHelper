/**
 * In-memory storage adapter — tier 3 fallback when localStorage is unavailable.
 */

import { newId } from '../engine/ids.js';

export function createMemoryStorageAdapter() {
  const snapshots = new Map();
  const index = new Map();
  let activeId = null;

  return {
    kind: 'memory',

    createConversationId() {
      return newId('conv_');
    },

    async isAvailable() {
      return { ok: true, available: true };
    },

    async listConversations() {
      const conversations = [...index.values()].sort((a, b) =>
        a.updatedAt < b.updatedAt ? 1 : -1,
      );
      return { ok: true, conversations };
    },

    async saveConversation(id, snapshot, titleOverride) {
      snapshots.set(id, snapshot);
      const existing = index.get(id);
      const entry = { id, updatedAt: new Date().toISOString() };

      if (!existing || !existing.customTitle) {
        entry.title =
          titleOverride ||
          (snapshot.originalTask ? snapshot.originalTask.slice(0, 60) : null) ||
          'Untitled conversation';
        entry.customTitle = false;
      } else {
        entry.title = existing.title;
        entry.customTitle = existing.customTitle;
      }

      index.set(id, { ...existing, ...entry });
      return { ok: true };
    },

    async loadConversation(id) {
      if (!snapshots.has(id)) return { ok: false, snapshot: null };
      return { ok: true, snapshot: snapshots.get(id) };
    },

    async renameConversation(id, title) {
      const entry = index.get(id);
      if (!entry) return { ok: false };
      index.set(id, {
        ...entry,
        title,
        customTitle: true,
        updatedAt: new Date().toISOString(),
      });
      return { ok: true };
    },

    async deleteConversation(id) {
      snapshots.delete(id);
      index.delete(id);
      if (activeId === id) activeId = null;
      return { ok: true };
    },

    async getActiveConversationId() {
      return { ok: true, id: activeId };
    },

    async setActiveConversationId(id) {
      activeId = id;
      return { ok: true };
    },
  };
}
