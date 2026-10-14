import type { SyncProgress } from './coordinator';

function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export function formatSyncProgress(progress: SyncProgress | null, now = Date.now()): string {
  if (!progress) return 'Sync is active. Waiting for the coordinator to report its current phase…';

  const phaseLabels: Record<SyncProgress['phase'], string> = {
    local_inventory: 'Scanning local vault',
    remote_inventory: 'Listing Google Drive vault',
    resolving_paths: 'Resolving Drive paths',
    hashing_remote: 'Hashing remote files',
    processing_changes: 'Processing Drive changes',
    processing_local_changes: 'Processing local changes',
    reconciling: 'Reconciling files',
    finalizing: 'Finalizing sync',
  };
  const elapsed = formatDurationSeconds((now - progress.startedAt) / 1000);
  const lastActivity = formatDurationSeconds((now - progress.lastActivityAt) / 1000);
  const amount = progress.total > 0
    ? ` · ${progress.completed}/${progress.total} (${Math.min(100, Math.round((progress.completed / progress.total) * 100))}%)`
    : progress.completed > 0
      ? ` · ${progress.completed} processed (total still being discovered)`
      : '';
  const current = progress.currentPath ? ` · ${progress.currentPath}` : '';
  const activity = progress.cancelRequested
    ? ' · cancellation requested; finishing the current operation'
    : progress.paused
      ? ' · paused at a safe checkpoint'
      : progress.pauseRequested
        ? ' · pause requested; finishing the current operation'
        : ` · last progress update ${lastActivity} ago`;
  return `${phaseLabels[progress.phase]}${amount}${current} · elapsed ${elapsed}${activity}`;
}
