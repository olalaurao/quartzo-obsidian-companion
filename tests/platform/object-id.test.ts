import { describe, expect, it } from 'vitest';
import { createCanonicalObjectId } from '../../src/platform/object-id';

describe('canonical object identity', () => {
  it('generates RFC 4122 version 4 UUIDs', () => {
    const id = createCanonicalObjectId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('does not reuse generated identities', () => {
    const ids = new Set(Array.from({ length: 32 }, () => createCanonicalObjectId()));
    expect(ids.size).toBe(32);
  });
});
