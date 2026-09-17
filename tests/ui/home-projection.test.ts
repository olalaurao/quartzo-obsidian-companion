import { describe, expect, it } from 'vitest';
import { projectHomeSchedule } from '../../src/ui/home/home-projection';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';

function item(value: Pick<NormalizedItem, 'id' | 'sourceId' | 'date' | 'isTimed'> & Partial<NormalizedItem>): NormalizedItem {
  return {
    sourceType: 'task',
    sourceLabel: `task:${value.sourceId}:tasks/${value.sourceId}.md`,
    isCompletable: true,
    isCompleted: false,
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

  it('does not invent Now or Up Next for a non-today date', () => {
    const result = projectHomeSchedule(schedule, '2026-09-16', new Date(2026, 8, 17, 10, 30));
    expect(result.now).toEqual([]);
    expect(result.upNext).toEqual([]);
    expect(result.today).toHaveLength(4);
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
});
