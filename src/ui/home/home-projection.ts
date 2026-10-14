import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import type { OverdueObjectProjection } from '../../core/overdue_projection';
import type { OrganizationIssue } from '../../core/object-organization/issues-projection';
import { localIsoDate } from '../../core/local-date';

export interface HomeProgress {
  completed: number;
  total: number;
}

export interface HomeScheduleProjection {
  now: NormalizedItem[];
  upNext: NormalizedItem[];
  today: NormalizedItem[];
  overdue: OverdueObjectProjection[];
  taskProgress: HomeProgress;
  habitProgress: HomeProgress;
}

export type HomeConfidenceStatus = 'clear' | 'attention' | 'blocked';
export type HomeConfidenceSignalKind = 'sync' | 'organization_issues' | 'overdue';
export type HomeConfidenceAction = 'open_sync' | 'open_conflicts' | 'open_issues' | 'open_overdue';

export interface HomeConfidenceSignal {
  kind: HomeConfidenceSignalKind;
  status: Exclude<HomeConfidenceStatus, 'clear'>;
  title: string;
  summary: string;
  count: number;
  priority: number;
  action: HomeConfidenceAction;
}

export interface HomeConfidenceSnapshot {
  status: HomeConfidenceStatus;
  title: string;
  summary: string;
  signals: HomeConfidenceSignal[];
}

export interface HomeSyncConfidenceInput {
  status: 'synced' | 'local_changes' | 'syncing' | 'conflict' | 'error';
  pendingLocalChanges: number;
  conflictCount: number;
  lastError: string | null;
}

export interface HomeConfidenceInput {
  selectedDate: string;
  todayDate: string;
  sync: HomeSyncConfidenceInput | null;
  issues: readonly OrganizationIssue[];
  overdue: readonly OverdueObjectProjection[];
}

function minutesFromClock(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function progressFor(items: NormalizedItem[], sourceType: string): HomeProgress {
  const relevant = items.filter(item => item.sourceType === sourceType && item.isCompletable);
  return {
    completed: relevant.filter(item => item.isCompleted).length,
    total: relevant.length,
  };
}

/**
 * Pure presentation projection over the canonical Daily Schedule result.
 * It never decides recurrence, overdue membership, completion, or capabilities.
 */
export function projectHomeSchedule(
  schedule: NormalizedSchedule,
  selectedDate: string,
  now: Date,
  overdue: OverdueObjectProjection[] = [],
): HomeScheduleProjection {
  const today = [...schedule.items];
  const taskProgress = progressFor(today, 'task');
  const habitProgress = progressFor(today, 'habit');

  if (selectedDate !== localIsoDate(now)) {
    return { now: [], upNext: [], today, overdue: [], taskProgress, habitProgress };
  }

  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const active: NormalizedItem[] = [];
  const future: Array<{ item: NormalizedItem; start: number }> = [];

  for (const item of today) {
    const start = minutesFromClock(item.start);
    if (start == null) continue;
    const end = minutesFromClock(item.end);
    if (start <= currentMinute && end != null && currentMinute < end) {
      active.push(item);
      continue;
    }
    if (start > currentMinute) future.push({ item, start });
  }

  future.sort((a, b) => a.start - b.start || a.item.id.localeCompare(b.item.id));
  const upNext = future.slice(0, 3).map(candidate => candidate.item);

  return { now: active, upNext, today, overdue, taskProgress, habitProgress };
}

export function projectHomeConfidence(input: HomeConfidenceInput): HomeConfidenceSnapshot {
  const signals: HomeConfidenceSignal[] = [];
  const sync = input.sync;
  if (sync) {
    if (sync.status === 'error') {
      signals.push({
        kind: 'sync',
        status: 'blocked',
        title: 'Sync needs review',
        summary: sync.lastError ?? 'Sync reported an error. Open Sync Center for diagnostics.',
        count: Math.max(1, sync.pendingLocalChanges, sync.conflictCount),
        priority: 10,
        action: 'open_sync',
      });
    } else if (sync.status === 'conflict' || sync.conflictCount > 0) {
      signals.push({
        kind: 'sync',
        status: 'blocked',
        title: 'Sync conflicts',
        summary: `${sync.conflictCount || 1} conflict${sync.conflictCount === 1 ? '' : 's'} need review before sync is clear.`,
        count: Math.max(1, sync.conflictCount),
        priority: 11,
        action: 'open_conflicts',
      });
    } else if (sync.status === 'syncing') {
      signals.push({
        kind: 'sync',
        status: 'attention',
        title: 'Sync running',
        summary: 'Sync is currently active. Open Sync Center to watch progress.',
        count: Math.max(1, sync.pendingLocalChanges),
        priority: 20,
        action: 'open_sync',
      });
    } else if (sync.status === 'local_changes' || sync.pendingLocalChanges > 0) {
      signals.push({
        kind: 'sync',
        status: 'attention',
        title: 'Local changes pending',
        summary: `${sync.pendingLocalChanges || 1} local change${sync.pendingLocalChanges === 1 ? '' : 's'} waiting for sync.`,
        count: Math.max(1, sync.pendingLocalChanges),
        priority: 21,
        action: 'open_sync',
      });
    }
  }

  const actionableIssues = input.issues.filter(issue => issue.actionable);
  if (actionableIssues.length > 0) {
    signals.push({
      kind: 'organization_issues',
      status: 'attention',
      title: 'Organization needs attention',
      summary: `${actionableIssues.length} actionable issue${actionableIssues.length === 1 ? '' : 's'} in Organization Issues.`,
      count: actionableIssues.length,
      priority: 30,
      action: 'open_issues',
    });
  }

  const overdueCount = input.selectedDate === input.todayDate ? input.overdue.length : 0;
  if (overdueCount > 0) {
    signals.push({
      kind: 'overdue',
      status: 'attention',
      title: 'Overdue items',
      summary: `${overdueCount} overdue item${overdueCount === 1 ? '' : 's'} need a decision today.`,
      count: overdueCount,
      priority: 40,
      action: 'open_overdue',
    });
  }

  signals.sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
  const status: HomeConfidenceStatus = signals.some(signal => signal.status === 'blocked')
    ? 'blocked'
    : signals.length > 0
      ? 'attention'
      : 'clear';
  if (status === 'blocked') {
    return {
      status,
      title: 'Review needed',
      summary: 'A blocking signal needs review before Companion can be fully trusted today.',
      signals,
    };
  }
  if (status === 'attention') {
    return {
      status,
      title: 'Attention queue',
      summary: `${signals.length} area${signals.length === 1 ? '' : 's'} need attention before the day feels settled.`,
      signals,
    };
  }
  return {
    status,
    title: 'All clear',
    summary: input.selectedDate === input.todayDate
      ? 'Sync, Organization Issues, and Overdue are clear for today.'
      : 'Sync and Organization Issues are clear. Overdue is only summarized on Today.',
    signals,
  };
}
