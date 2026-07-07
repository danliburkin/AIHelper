/**
 * Shared id generation for engine records, proposals, and storage keys.
 * @param {string} [prefix=''] - when empty, prefer crypto.randomUUID(); otherwise prefix + entropy
 */
export function newId(prefix = '') {
  if (!prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'r_' + Math.random().toString(36).slice(2, 10);
  }
  if (prefix === 'conv_') {
    return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }
  return prefix + Math.random().toString(36).slice(2, 10);
}
