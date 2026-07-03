import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../src/engine/engine.js';

vi.mock('../src/engine/storage.js', () => ({
  listConversations: vi.fn(() => [{ id: 'conv_1', title: 'Existing', updatedAt: '2024-01-01T00:00:00.000Z' }]),
  getActiveConversationId: vi.fn(() => 'conv_1'),
  loadConversation: vi.fn(() => ({
    format: 'context-lens-record',
    version: 1,
    originalTask: 'Existing',
    topic: '',
    memory: [],
    facts: [],
    assumptions: [],
    ambient: [],
    turns: [],
  })),
  setActiveConversationId: vi.fn(() => true),
  saveConversation: vi.fn(() => false),
  createConversationId: vi.fn(() => 'conv_new'),
  renameConversation: vi.fn(() => true),
  deleteConversation: vi.fn(() => true),
}));

function fakeElement() {
  return {
    children: [],
    hidden: false,
    textContent: '',
    value: '',
    classList: {
      values: new Set(),
      add(name) {
        this.values.add(name);
      },
      remove(name) {
        this.values.delete(name);
      },
      contains(name) {
        return this.values.has(name);
      },
    },
    addEventListener: vi.fn(),
    replaceChildren() {
      this.children = [];
    },
    append(child) {
      this.children.push(child);
    },
  };
}

beforeEach(() => {
  globalThis.document = {
    createElement: vi.fn(() => fakeElement()),
  };
  globalThis.window = {
    addEventListener: vi.fn(),
  };
});

describe('conversations autosave warning', () => {
  it('surfaces a persistent status warning when flushSave cannot save', async () => {
    const { initConversations, AUTOSAVE_FAILURE_MESSAGE } = await import('../src/ui/conversations.js');
    const refs = {
      conversationSelect: fakeElement(),
      newConversationBtn: fakeElement(),
      renameConversationBtn: fakeElement(),
      deleteConversationBtn: fakeElement(),
      status: fakeElement(),
    };
    const controller = initConversations(refs, createEngine(), vi.fn());

    controller.flushSave();

    expect(refs.status.textContent).toBe(AUTOSAVE_FAILURE_MESSAGE);
    expect(refs.status.classList.contains('status-warning')).toBe(true);
  });
});
