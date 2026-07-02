import * as storage from '../engine/storage.js';
import { showPromptModal, showConfirmModal } from './modal.js';

const SAVE_DEBOUNCE_MS = 500;

/**
 * Multi-conversation controller. Wires the conversation-switcher dropdown
 * and New/Rename/Delete buttons, and drives auto-save to localStorage.
 *
 * On init, restores the last-active conversation (or the newest one, or
 * creates a blank conversation if none exist yet) into the shared engine
 * instance. The engine object identity never changes — only its internal
 * state is swapped via engine.restoreSnapshot() / engine.reset(), so every
 * other UI module (boards, transport, proposals, spiral) keeps working
 * without re-wiring.
 *
 * @param {Record<string, HTMLElement>} refs - layout refs (conversationSelect, new/rename/delete buttons)
 * @param {ReturnType<import('../engine/engine.js').createEngine>} engine
 * @param {() => void} onSwitch - called after loading a different conversation's state
 * @returns {{ scheduleSave: () => void, flushSave: () => void, getActiveId: () => string|null }}
 */
export function initConversations(refs, engine, onSwitch) {
  const { conversationSelect, newConversationBtn, renameConversationBtn, deleteConversationBtn } = refs;

  let activeId = null;
  let saveTimer = null;

  function renderSelect() {
    const list = storage.listConversations();
    conversationSelect.replaceChildren();
    for (const conv of list) {
      const option = document.createElement('option');
      option.value = conv.id;
      option.textContent = conv.title || 'Untitled conversation';
      if (conv.id === activeId) option.selected = true;
      conversationSelect.append(option);
    }
  }

  function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!activeId) return;
    storage.saveConversation(activeId, engine.exportSnapshot());
    renderSelect();
  }

  function scheduleSave() {
    if (!activeId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function loadInto(id) {
    const snapshot = storage.loadConversation(id);
    if (snapshot) {
      engine.restoreSnapshot(snapshot);
    } else {
      engine.reset();
    }
    activeId = id;
    storage.setActiveConversationId(id);
  }

  function switchTo(id) {
    if (id === activeId) return;
    flushSave();
    loadInto(id);
    renderSelect();
    onSwitch();
  }

  /**
   * Shared logic for "start a blank conversation". `notify: false` is used
   * only during bootstrap (init()), before the rest of the UI (boards,
   * transport, proposals, spiral) exists — calling onSwitch() at that point
   * would reference not-yet-initialized consts in main.js.
   */
  function createBlankConversation(notify) {
    flushSave();
    const id = storage.createConversationId();
    engine.reset();
    storage.saveConversation(id, engine.exportSnapshot(), 'New conversation');
    activeId = id;
    storage.setActiveConversationId(id);
    renderSelect();
    if (notify) onSwitch();
  }

  function createNew() {
    createBlankConversation(true);
  }

  async function rename() {
    if (!activeId) return;
    const current = storage.listConversations().find((c) => c.id === activeId);
    const title = await showPromptModal('Rename conversation:', current?.title || '');
    if (title === null || !title.trim()) return;
    storage.renameConversation(activeId, title.trim());
    renderSelect();
  }

  async function remove() {
    if (!activeId) return;
    const ok = await showConfirmModal('Delete this conversation? This cannot be undone.');
    if (!ok) return;

    storage.deleteConversation(activeId);
    const remaining = storage.listConversations();
    if (remaining.length > 0) {
      loadInto(remaining[0].id);
      renderSelect();
      onSwitch();
    } else {
      createNew();
    }
  }

  conversationSelect.addEventListener('change', () => {
    if (conversationSelect.value) switchTo(conversationSelect.value);
  });
  newConversationBtn.addEventListener('click', createNew);
  renameConversationBtn.addEventListener('click', rename);
  deleteConversationBtn.addEventListener('click', remove);

  window.addEventListener('beforeunload', flushSave);

  function init() {
    const existing = storage.listConversations();

    if (existing.length === 0) {
      createBlankConversation(false);
      return;
    }

    const lastActive = storage.getActiveConversationId();
    const targetId = existing.some((c) => c.id === lastActive) ? lastActive : existing[0].id;
    loadInto(targetId);
    renderSelect();
  }

  init();

  return {
    scheduleSave,
    flushSave,
    getActiveId: () => activeId,
  };
}
