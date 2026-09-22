import { describe, expect, it } from 'vitest';
import { projectHomeSchedule } from '../../src/ui/home/home-projection';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';

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
