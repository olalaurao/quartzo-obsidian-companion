import { describe, expect, it } from 'vitest';
import { projectHomeConfidence, projectHomeSchedule } from '../../src/ui/home/home-projection';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';
import type { OrganizationIssue } from '../../src/core/object-organization/issues-projection';

function item(value: Pick<NormalizedItem, 'id' | 'sourceId' | 'date' | 'isTimed'> & Partial<NormalizedItem>): NormalizedItem {
  return {
    sourceType: 'task',
    sourceLabel: `task:${value.sourceId}:tasks/${value.sourceId}.md`,
    isCompletable: true,
    isCompleted: false,
    isSkipped: false,
    outcome: 'pending',
    isPlayable: false,
    editable: true,
    origin: 'schedule',
    ...value,
  };
}

const schedule: NormalizedSchedule = {
  kind: 'mixed',
  count: 4,
  items: [
    item({ id: 'active', sourceId: 'active', date: '2026-09-17', start: '10:00', end: '11:00', isTimed: true }),
    item({ id: 'next-a', sourceId: 'next-a', date: '2026-09-17', start: '11:30', end: '12:00', isTimed: true }),
    item({ id: 'next-b', sourceId: 'next-b', date: '2026-09-17', start: '11:30', end: '12:30', isTimed: true }),
    item({ id: 'untimed', sourceId: 'untimed', date: '2026-09-17', isTimed: false }),
  ],
};

describe('projectHomeSchedule', () => {
  it('derives Now and all simultaneous Up Next items from the canonical schedule', () => {
    const result = projectHomeSchedule(schedule, '2026-09-17', new Date(2026, 8, 17, 10, 30));
    expect(result.now.map(entry => entry.id)).toEqual(['active']);
    expect(result.upNext.map(entry => entry.id)).toEqual(['next-a', 'next-b']);
    expect(result.today).toHaveLength(4);
  });

  it('orders and caps Up Next to the next three canonical timed items', () => {
    const upcomingSchedule: NormalizedSchedule = {
      kind: 'mixed',
      count: 4,
      items: [
        item({ id: 'third', sourceId: 'third', date: '2026-09-17', start: '13:00', end: '13:30', isTimed: true }),
        item({ id: 'first', sourceId: 'first', date: '2026-09-17', start: '11:00', end: '11:30', isTimed: true }),
        item({ id: 'fourth', sourceId: 'fourth', date: '2026-09-17', start: '14:00', end: '14:30', isTimed: true }),
        item({ id: 'second', sourceId: 'second', date: '2026-09-17', start: '12:00', end: '12:30', isTimed: true }),
      ],
    };

    const result = projectHomeSchedule(upcomingSchedule, '2026-09-17', new Date(2026, 8, 17, 10, 30));
    expect(result.upNext.map(entry => entry.id)).toEqual(['first', 'second', 'third']);
  });

  it('does not invent Now or Up Next for a non-today date', () => {
    const result = projectHomeSchedule(schedule, '2026-09-16', new Date(2026, 8, 17, 10, 30));
    expect(result.now).toEqual([]);
    expect(result.upNext).toEqual([]);
    expect(result.today).toHaveLength(4);
  });

  it('derives Task and Habit progress only from the canonical daily snapshot', () => {
    const progressSchedule: NormalizedSchedule = {
      kind: 'mixed',
      count: 4,
      items: [
        item({ id: 'task-done', sourceId: 'task-done', date: '2026-09-17', isTimed: false, sourceType: 'task', isCompleted: true, outcome: 'done' }),
        item({ id: 'task-open', sourceId: 'task-open', date: '2026-09-17', isTimed: false, sourceType: 'task' }),
        item({ id: 'habit-done', sourceId: 'habit-done', date: '2026-09-17', isTimed: false, sourceType: 'habit', isCompleted: true, outcome: 'done' }),
        item({ id: 'habit-open', sourceId: 'habit-open', date: '2026-09-17', isTimed: false, sourceType: 'habit' }),
      ],
    };

    const result = projectHomeSchedule(progressSchedule, '2026-09-17', new Date(2026, 8, 17, 10, 30));
    expect(result.taskProgress).toEqual({ completed: 1, total: 2 });
    expect(result.habitProgress).toEqual({ completed: 1, total: 2 });
  });

  it('does not treat point or untimed items as active without a canonical end time', () => {
    const pointOnly: NormalizedSchedule = {
      kind: 'mixed',
      count: 2,
      items: [
        item({ id: 'point', sourceId: 'point', date: '2026-09-17', start: '10:30', isTimed: true }),
        item({ id: 'untimed', sourceId: 'untimed', date: '2026-09-17', isTimed: false }),
      ],
    };
    const result = projectHomeSchedule(pointOnly, '2026-09-17', new Date(2026, 8, 17, 10, 30));
    expect(result.now).toEqual([]);
    expect(result.upNext).toEqual([]);
  });

  it('keeps Overdue as a separate today projection outside Today', () => {
    const overdue = [{
      object: { id: 'deadline', type: 'task', path: 'tasks/deadline.md', frontmatter: { id: 'deadline', type: 'task', title: 'Deadline' }, body: '' },
      decision: {
        candidate: {
          sourceId: 'deadline',
          sourceType: 'task',
          deadline: '2026-09-16',
          deadlineMode: 'calendarDay' as const,
          completed: false,
          archived: false,
        },
        daysLate: 1,
        severity: 'light' as const,
      },
    }];
    const result = projectHomeSchedule(schedule, '2026-09-17', new Date(2026, 8, 17, 10, 30), overdue);
    expect(result.today.map(entry => entry.id)).not.toContain('deadline');
    expect(result.overdue.map(entry => entry.object.id)).toEqual(['deadline']);
  });
});

function issue(value: Partial<OrganizationIssue> = {}): OrganizationIssue {
  return {
    id: 'issue-1',
    category: 'unidentified',
    subjectPath: 'inbox/file.md',
    title: 'Unidentified File',
    why: 'Missing identification.',
    actionable: true,
    ...value,
  };
}

describe('projectHomeConfidence', () => {
  it('treats sync errors and conflicts as blocking confidence signals', () => {
    const error = projectHomeConfidence({
      selectedDate: '2026-09-17',
      todayDate: '2026-09-17',
      sync: {
        status: 'error',
        pendingLocalChanges: 0,
        conflictCount: 0,
        lastError: 'Drive request timed out.',
      },
      issues: [],
      overdue: [],
    });
    expect(error.status).toBe('blocked');
    expect(error.signals[0]).toMatchObject({ kind: 'sync', action: 'open_sync' });

    const conflict = projectHomeConfidence({
      selectedDate: '2026-09-17',
      todayDate: '2026-09-17',
      sync: {
        status: 'conflict',
        pendingLocalChanges: 0,
        conflictCount: 2,
        lastError: null,
      },
      issues: [],
      overdue: [],
    });
    expect(conflict.status).toBe('blocked');
    expect(conflict.signals[0]).toMatchObject({ kind: 'sync', action: 'open_conflicts', count: 2 });
  });

  it('turns pending sync changes into an attention signal', () => {
    const result = projectHomeConfidence({
      selectedDate: '2026-09-17',
      todayDate: '2026-09-17',
      sync: {
        status: 'local_changes',
        pendingLocalChanges: 3,
        conflictCount: 0,
        lastError: null,
      },
      issues: [],
      overdue: [],
    });
    expect(result.status).toBe('attention');
    expect(result.signals).toContainEqual(expect.objectContaining({
      kind: 'sync',
      action: 'open_sync',
      count: 3,
    }));
  });

  it('counts only actionable Organization Issues and links them to Issues', () => {
    const result = projectHomeConfidence({
      selectedDate: '2026-09-17',
      todayDate: '2026-09-17',
      sync: null,
      issues: [issue(), issue({ id: 'info', actionable: false })],
      overdue: [],
    });
    expect(result.status).toBe('attention');
    expect(result.signals).toContainEqual(expect.objectContaining({
      kind: 'organization_issues',
      action: 'open_issues',
      count: 1,
    }));
  });

  it('shows overdue confidence only for Today', () => {
    const overdue = [{
      object: { id: 'deadline', type: 'task', path: 'tasks/deadline.md', frontmatter: { id: 'deadline', type: 'task', title: 'Deadline' }, body: '' },
      decision: {
        candidate: {
          sourceId: 'deadline',
          sourceType: 'task',
          deadline: '2026-09-16',
          deadlineMode: 'calendarDay' as const,
          completed: false,
          archived: false,
        },
        daysLate: 1,
        severity: 'light' as const,
      },
    }];
    const today = projectHomeConfidence({
      selectedDate: '2026-09-17',
      todayDate: '2026-09-17',
      sync: null,
      issues: [],
      overdue,
    });
    expect(today.signals).toContainEqual(expect.objectContaining({ kind: 'overdue', action: 'open_overdue' }));

    const otherDate = projectHomeConfidence({
      selectedDate: '2026-09-16',
      todayDate: '2026-09-17',
      sync: null,
      issues: [],
      overdue,
    });
    expect(otherDate.status).toBe('clear');
    expect(otherDate.signals).toEqual([]);
  });

  it('returns a positive all-clear panel when all confidence inputs are clear', () => {
    const result = projectHomeConfidence({
      selectedDate: '2026-09-17',
      todayDate: '2026-09-17',
      sync: {
        status: 'synced',
        pendingLocalChanges: 0,
        conflictCount: 0,
        lastError: null,
      },
      issues: [],
      overdue: [],
    });
    expect(result).toMatchObject({
      status: 'clear',
      title: 'All clear',
      signals: [],
    });
  });
});
