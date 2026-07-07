import { showPromptModal, showConfirmModal } from './modal.js';

const SAVE_DEBOUNCE_MS = 500;

function listFingerprint(conversations) {
  return conversations.map((c) => `${c.id}|${c.title}|${c.updatedAt}`).join('\n');
}

/**
 * Multi-conversation controller. Wires the conversation-switcher dropdown,
 * sync-state indicator, and New/Rename/Delete buttons against a storage adapter.
 *
 * @param {Record<string, HTMLElement>} refs
 * @param {ReturnType<import('../engine/engine.js').createEngine>} engine
 * @param {() => void} onSwitch
 * @param {ReturnType<import('../storage/adapter.js').makeStorage>} storage
 */
export function initConversations(refs, engine, onSwitch, storage) {
  const {
    conversationSelect,
    syncStatus,
    newConversationBtn,
    renameConversationBtn,
    deleteConversationBtn,
  } = refs;

  let activeId = null;
  let saveTimer = null;
  let saveInFlight = null;
  let lastListFingerprint = '';

  function setSyncStatus(kind) {
    if (!syncStatus) return;
    syncStatus.classList.remove('sync-saving', 'sync-saved', 'sync-failed');
    if (kind === 'saving') {
      syncStatus.textContent = 'saving…';
      syncStatus.classList.add('sync-saving');
    } else if (kind === 'saved') {
      syncStatus.textContent = 'saved';
      syncStatus.classList.add('sync-saved');
    } else if (kind === 'failed') {
      syncStatus.textContent = 'sync failed — export your record';
      syncStatus.classList.add('sync-failed');
    } else {
      syncStatus.textContent = '';
    }
  }

  async function renderSelectIfChanged(force = false) {
    const listResult = await storage.listConversations();
    const list = listResult.ok ? listResult.conversations : [];
    const fingerprint = listFingerprint(list);

    if (!force && fingerprint === lastListFingerprint && conversationSelect.options.length > 0) {
      for (const option of conversationSelect.options) {
        option.selected = option.value === activeId;
      }
      return;
    }

    lastListFingerprint = fingerprint;
    conversationSelect.replaceChildren();
    for (const conv of list) {
      const option = document.createElement('option');
      option.value = conv.id;
      option.textContent = conv.title || 'Untitled conversation';
      if (conv.id === activeId) option.selected = true;
      conversationSelect.append(option);
    }
  }

  async function flushSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!activeId) return;

    setSyncStatus('saving');
    const savePromise = storage.saveConversation(activeId, engine.exportSnapshot());
    saveInFlight = savePromise;

    const result = await savePromise;
    if (saveInFlight !== savePromise) return;

    if (result.ok) {
      setSyncStatus('saved');
      await renderSelectIfChanged();
    } else {
      setSyncStatus('failed');
    }
  }

  function scheduleSave() {
    if (!activeId) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flushSave();
    }, SAVE_DEBOUNCE_MS);
  }

  async function loadInto(id) {
    const loaded = await storage.loadConversation(id);
    if (loaded.ok && loaded.snapshot) {
      engine.restoreSnapshot(loaded.snapshot);
    } else {
      engine.reset();
    }
    activeId = id;
    await storage.setActiveConversationId(id);
  }

  async function switchTo(id) {
    if (id === activeId) return;
    await flushSave();
    await loadInto(id);
    await renderSelectIfChanged(true);
    onSwitch();
  }

  async function createBlankConversation(notify) {
    await flushSave();
    const id = storage.createConversationId();
    engine.reset();
    const saved = await storage.saveConversation(id, engine.exportSnapshot(), 'New conversation');
    if (!saved.ok) setSyncStatus('failed');
    else setSyncStatus('saved');
    activeId = id;
    await storage.setActiveConversationId(id);
    await renderSelectIfChanged(true);
    if (notify) onSwitch();
  }

  async function createNew() {
    await createBlankConversation(true);
  }

  async function rename() {
    if (!activeId) return;
    const listResult = await storage.listConversations();
    const current = listResult.ok
      ? listResult.conversations.find((c) => c.id === activeId)
      : null;
    const title = await showPromptModal('Rename conversation:', current?.title || '');
    if (title === null || !title.trim()) return;
    const result = await storage.renameConversation(activeId, title.trim());
    if (!result.ok) {
      setSyncStatus('failed');
      return;
    }
    await renderSelectIfChanged(true);
  }

  async function remove() {
    if (!activeId) return;
    const ok = await showConfirmModal('Delete this conversation? This cannot be undone.');
    if (!ok) return;

    const deleted = await storage.deleteConversation(activeId);
    if (!deleted.ok) {
      setSyncStatus('failed');
      return;
    }

    const listResult = await storage.listConversations();
    const remaining = listResult.ok ? listResult.conversations : [];
    if (remaining.length > 0) {
      await loadInto(remaining[0].id);
      await renderSelectIfChanged(true);
      onSwitch();
    } else {
      await createNew();
    }
  }

  conversationSelect.addEventListener('change', () => {
    if (conversationSelect.value) void switchTo(conversationSelect.value);
  });
  newConversationBtn.addEventListener('click', () => {
    void createNew();
  });
  renameConversationBtn.addEventListener('click', () => {
    void rename();
  });
  deleteConversationBtn.addEventListener('click', () => {
    void remove();
  });

  window.addEventListener('beforeunload', () => {
    void flushSave();
  });

  async function init() {
    const listResult = await storage.listConversations();
    const existing = listResult.ok ? listResult.conversations : [];

    if (existing.length === 0) {
      await createBlankConversation(false);
      return;
    }

    const activeResult = await storage.getActiveConversationId();
    const lastActive = activeResult.ok ? activeResult.id : null;
    const targetId = existing.some((c) => c.id === lastActive) ? lastActive : existing[0].id;
    await loadInto(targetId);
    await renderSelectIfChanged(true);
    setSyncStatus('saved');
  }

  void init();

  return {
    scheduleSave,
    flushSave,
    getActiveId: () => activeId,
  };
}
