/**
 * Multi-conversation localStorage persistence.
 *
 * Each conversation is a full engine snapshot (same shape as persistence.js's
 * buildSnapshot) stored under its own key, plus a lightweight index so the UI
 * can list conversations without loading every snapshot.
 *
 * Keys:
 *   context-lens:index          → [{ id, title, updatedAt }]  (sorted newest first by caller)
 *   context-lens:conv:<id>      → full snapshot object (JSON)
 *   context-lens:active         → last active conversation id (string)
 *
 * This module never touches the DOM and never imports engine.js — it only
 * reads/writes plain JSON. All functions are safe to call even when
 * localStorage is unavailable (private browsing, disabled storage, SSR):
 * they degrade to no-ops / empty results rather than throwing.
 */

import { newId } from './ids.js';

const INDEX_KEY = 'context-lens:index';
const ACTIVE_KEY = 'context-lens:active';
const CONV_PREFIX = 'context-lens:conv:';

function getStore() {
  try {
    if (typeof localStorage === 'undefined') return null;
    // Probe for availability — some browsers expose the object but throw on use.
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

export function createConversationId() {
  return newId('conv_');
}

export function isStorageAvailable() {
  return getStore() !== null;
}

/**
 * @returns {Array<{ id: string, title: string, updatedAt: string }>} newest first
 */
export function listConversations() {
  const store = getStore();
  if (!store) return [];
  const index = readJson(store, INDEX_KEY, []);
  if (!Array.isArray(index)) return [];
  return [...index].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
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
  writeJson(store, INDEX_KEY, index);
}

/**
 * Persist a conversation's full snapshot and refresh its index entry.
 *
 * The title auto-derives from `snapshot.originalTask` on every save UNLESS
 * the conversation has been explicitly renamed via renameConversation()
 * (tracked by the `customTitle` flag) — an explicit rename always wins over
 * the auto-derived title.
 *
 * @param {string} id
 * @param {object} snapshot - full engine snapshot (see persistence.buildSnapshot)
 * @param {string} [titleOverride] - initial/default title used only when no
 *   custom title has been set yet (e.g. "New conversation" placeholder)
 * @returns {boolean} true on success
 */
export function saveConversation(id, snapshot, titleOverride) {
  const store = getStore();
  if (!store) return false;

  const ok = writeJson(store, CONV_PREFIX + id, snapshot);
  if (!ok) return false;

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

  writeIndexEntry(store, entry);
  return true;
}

/**
 * @param {string} id
 * @returns {object|null} the stored snapshot, or null if not found / storage unavailable
 */
export function loadConversation(id) {
  const store = getStore();
  if (!store) return null;
  return readJson(store, CONV_PREFIX + id, null);
}

/**
 * Rename a conversation's index entry without touching its snapshot. This
 * marks the title as custom, so future saveConversation() calls will not
 * overwrite it with the auto-derived title from originalTask.
 * @param {string} id
 * @param {string} title
 * @returns {boolean}
 */
export function renameConversation(id, title) {
  const store = getStore();
  if (!store) return false;
  const index = readIndex(store);
  const entry = index.find((e) => e.id === id);
  if (!entry) return false;
  entry.title = title;
  entry.customTitle = true;
  entry.updatedAt = new Date().toISOString();
  writeJson(store, INDEX_KEY, index);
  return true;
}

/**
 * Remove a conversation's snapshot and its index entry.
 * @param {string} id
 * @returns {boolean}
 */
export function deleteConversation(id) {
  const store = getStore();
  if (!store) return false;
  try {
    store.removeItem(CONV_PREFIX + id);
  } catch {
    // ignore
  }
  const index = readIndex(store).filter((e) => e.id !== id);
  writeJson(store, INDEX_KEY, index);
  const active = readJson(store, ACTIVE_KEY, null);
  if (active === id) {
    try {
      store.removeItem(ACTIVE_KEY);
    } catch {
      // ignore
    }
  }
  return true;
}

/**
 * @returns {string|null} the last active conversation id
 */
export function getActiveConversationId() {
  const store = getStore();
  if (!store) return null;
  return readJson(store, ACTIVE_KEY, null);
}

/**
 * @param {string} id
 */
export function setActiveConversationId(id) {
  const store = getStore();
  if (!store) return false;
  return writeJson(store, ACTIVE_KEY, id);
}
