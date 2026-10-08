import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

describe('documentation integrity', () => {
  it('preserves all original agent rules and current authority boundaries', () => {
    const result = spawnSync(process.execPath, ['scripts/check-docs.mjs'], {
      cwd: process.cwd(), encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain('PASS: Companion documentation integrity');
  });
});
