import { describe, expect, it } from 'vitest';
import { buildConflictDiff, formatConflictDiff } from '../../src/ui/sync/conflict-diff';

describe('conflict diff', () => {
  it('marks local removals and Drive additions without losing common context', () => {
    const diff = buildConflictDiff('alpha\nlocal\nomega', 'alpha\ndrive\nomega');
    expect(diff).not.toBeNull();
    expect(formatConflictDiff(diff!)).toBe('  alpha\n- local\n+ drive\n  omega');
  });

  it('returns null instead of doing quadratic work on oversized conflict previews', () => {
    const large = Array.from({ length: 401 }, (_, index) => `line-${index}`).join('\n');
    expect(buildConflictDiff(large, large)).toBeNull();
  });
});
