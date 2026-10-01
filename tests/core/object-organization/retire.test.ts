import { describe, expect, it } from 'vitest';
import { ObjectParser } from '../../../src/core/objects';
import {
  buildCanonicalRetirementTombstone,
  canonicalRetirementPath,
} from '../../../src/core/object-organization/retire';

describe('canonical object retirement', () => {
  it('creates the canonical tombstone path and minimal deleted marker', () => {
    const markdown = buildCanonicalRetirementTombstone({
      id: 'object-123',
      deletedAt: '2026-10-01T12:00:00.000Z',
    });
    const parsed = ObjectParser.parseMarkdown(markdown);

    expect(canonicalRetirementPath('object-123')).toBe('_deleted/object-123.md');
    expect(parsed.frontmatter).toEqual({
      id: 'object-123',
      type: '_deleted',
      deleted_at: '2026-10-01T12:00:00.000Z',
    });
    expect(parsed.body.trim()).toBe('');
  });

  it('preserves merge traceability without copying loser content', () => {
    const markdown = buildCanonicalRetirementTombstone({
      id: 'loser-id',
      deletedAt: '2026-10-01T12:00:00.000Z',
      mergedInto: 'survivor-id',
    });
    const parsed = ObjectParser.parseMarkdown(markdown);

    expect(parsed.frontmatter.merged_into).toBe('survivor-id');
    expect(markdown).not.toContain('secret loser body');
  });

  it('rejects IDs that could escape the canonical _deleted folder', () => {
    expect(() => canonicalRetirementPath('../escape')).toThrow();
    expect(() => canonicalRetirementPath('folder/id')).toThrow();
    expect(() => canonicalRetirementPath('')).toThrow();
  });
});
