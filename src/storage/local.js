/**
 * Tier-2 localStorage storage adapter. Async surface with { ok } result shapes.
 */

import { newId } from '../engine/ids.js';

const INDEX_KEY = 'context-lens:index';
const ACTIVE_KEY = 'context-lens:active';
const CONV_PREFIX = 'context-lens:conv:';

function getStore() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probeKey = '__context_lens_probe__';
    localStorage.setItem(probeKey, '1');
    localStorage.removeItem(probeKey);
    return localStorage;
  } catch {
    return null;
  }
}

function readJson(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readIndex(store) {
  const index = readJson(store, INDEX_KEY, []);
  return Array.isArray(index) ? index : [];
}

function writeIndexEntry(store, entry) {
  const index = readIndex(store);
  const idx = index.findIndex((e) => e.id === entry.id);
  if (idx === -1) index.push(entry);
  else index[idx] = { ...index[idx], ...entry };
  return writeJson(store, INDEX_KEY, index);
}

export function createLocalStorageAdapter(store = getStore()) {
  return {
    kind: 'local',

    createConversationId() {
      return newId('conv_');
    },

    async isAvailable() {
      return { ok: true, available: store !== null };
    },

    async listConversations() {
      if (!store) return { ok: false, conversations: [] };
      const index = readIndex(store);
      const conversations = [...index].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return { ok: true, conversations };
    },

    async saveConversation(id, snapshot, titleOverride) {
      if (!store) return { ok: false };

      const ok = writeJson(store, CONV_PREFIX + id, snapshot);
      if (!ok) return { ok: false };

      const index = readIndex(store);
      const existing = index.find((e) => e.id === id);
      const entry = { id, updatedAt: new Date().toISOString() };

      if (!existing || !existing.customTitle) {
        entry.title =
          titleOverride ||
          (snapshot.originalTask ? snapshot.originalTask.slice(0, 60) : null) ||
          'Untitled conversation';
        entry.customTitle = false;
      }

      if (!writeIndexEntry(store, entry)) return { ok: false };
      return { ok: true };
    },

    async loadConversation(id) {
      if (!store) return { ok: false, snapshot: null };
      const snapshot = readJson(store, CONV_PREFIX + id, null);
      if (snapshot === null) return { ok: false, snapshot: null };
      return { ok: true, snapshot };
    },

    async renameConversation(id, title) {
      if (!store) return { ok: false };
      const index = readIndex(store);
      const entry = index.find((e) => e.id === id);
      if (!entry) return { ok: false };
      entry.title = title;
      entry.customTitle = true;
      entry.updatedAt = new Date().toISOString();
      return { ok: writeJson(store, INDEX_KEY, index) };
    },

    async deleteConversation(id) {
      if (!store) return { ok: false };
      try {
        store.removeItem(CONV_PREFIX + id);
      } catch {
        // ignore remove failures
      }
      const index = readIndex(store).filter((e) => e.id !== id);
      if (!writeJson(store, INDEX_KEY, index)) return { ok: false };
      const active = readJson(store, ACTIVE_KEY, null);
      if (active === id) {
        try {
          store.removeItem(ACTIVE_KEY);
        } catch {
          // ignore
        }
      }
      return { ok: true };
    },

    async getActiveConversationId() {
      if (!store) return { ok: false, id: null };
      return { ok: true, id: readJson(store, ACTIVE_KEY, null) };
    },

    async setActiveConversationId(id) {
      if (!store) return { ok: false };
      return { ok: writeJson(store, ACTIVE_KEY, id) };
    },
  };
}
