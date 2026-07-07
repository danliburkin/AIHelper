import { describe, it, expect } from 'vitest';
import { newId } from '../src/engine/ids.js';

describe('newId', () => {
  it('uses known prefixes for proposals, records, and conversations', () => {
    expect(newId('p_')).toMatch(/^p_[a-z0-9]+$/);
    expect(newId('r_')).toMatch(/^r_[a-z0-9]+$/);
    expect(newId('conv_')).toMatch(/^conv_[a-z0-9]+/);
  });

  it('default prefix prefers uuid-shaped ids when crypto is available', () => {
    const id = newId();
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    } else {
      expect(id).toMatch(/^r_[a-z0-9]+$/);
    }
  });
});
