import { describe, expect, it } from 'vitest';
import { formatSyncProgress } from '../../src/sync/progress';
import type { SyncProgress } from '../../src/sync/coordinator';

const progress: SyncProgress = {
  operation: 'full',
  phase: 'remote_inventory',
  completed: 8,
  total: 0,
  startedAt: 1_000,
  lastActivityAt: 2_000,
  paused: false,
};

describe('sync progress display', () => {
  it('shows elapsed time and processed count without inventing a percentage while total is unknown', () => {
    const message = formatSyncProgress(progress, 61_000);
    expect(message).toContain('8 processed (total still being discovered)');
    expect(message).toContain('elapsed 1m 0s');
    expect(message).not.toContain('0%');
  });

  it('shows pause state while retaining wall-clock elapsed time', () => {
    const message = formatSyncProgress({ ...progress, paused: true }, 61_000);
    expect(message).toContain('paused at a safe checkpoint');
    expect(message).toContain('elapsed 1m 0s');
  });
});
