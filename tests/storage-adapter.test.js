import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeStorage, pickStorageKind } from '../src/storage/adapter.js';

beforeEach(() => {
  vi.resetModules();
});

describe('pickStorageKind', () => {
  it('returns remote when signed in with backend configured', () => {
    expect(pickStorageKind({ signedIn: true, hasBackend: true })).toBe('remote');
  });

  it('returns local for anonymous tier-2 when localStorage works', () => {
    const backing = new Map();
    globalThis.localStorage = {
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => backing.set(key, String(value)),
      removeItem: (key) => backing.delete(key),
    };
    expect(pickStorageKind({ signedIn: false, hasBackend: false })).toBe('local');
  });

  it('returns memory when localStorage is unavailable', () => {
    delete globalThis.localStorage;
    expect(pickStorageKind({ signedIn: false, hasBackend: false })).toBe('memory');
  });

  it('returns local when signed out even if backend is configured', () => {
    const backing = new Map();
    globalThis.localStorage = {
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => backing.set(key, String(value)),
      removeItem: (key) => backing.delete(key),
    };
    expect(pickStorageKind({ signedIn: false, hasBackend: true })).toBe('local');
  });
});

describe('makeStorage', () => {
  it('creates local and memory adapters', () => {
    const backing = new Map();
    globalThis.localStorage = {
      getItem: (key) => (backing.has(key) ? backing.get(key) : null),
      setItem: (key, value) => backing.set(key, String(value)),
      removeItem: (key) => backing.delete(key),
    };
    expect(makeStorage('local').kind).toBe('local');
    expect(makeStorage('memory').kind).toBe('memory');
  });

  it('throws for remote until implemented', () => {
    expect(() => makeStorage('remote')).toThrow(/not implemented/i);
  });
});
