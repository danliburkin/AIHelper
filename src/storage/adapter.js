import { createLocalStorageAdapter } from './local.js';
import { createMemoryStorageAdapter } from './memory.js';

/**
 * @param {{ signedIn?: boolean, hasBackend?: boolean }} opts
 * @returns {'local' | 'memory' | 'remote'}
 */
export function pickStorageKind({ signedIn = false, hasBackend = false } = {}) {
  if (signedIn && hasBackend) return 'remote';
  try {
    if (typeof localStorage !== 'undefined') {
      const probeKey = '__context_lens_probe__';
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
      return 'local';
    }
  } catch {
    // fall through to memory
  }
  return 'memory';
}

/**
 * @param {'local' | 'memory' | 'remote'} kind
 */
export function makeStorage(kind) {
  switch (kind) {
    case 'local':
      return createLocalStorageAdapter();
    case 'memory':
      return createMemoryStorageAdapter();
    case 'remote':
      throw new Error('Remote storage adapter is not implemented yet');
    default:
      throw new Error(`Unknown storage kind: ${kind}`);
  }
}
