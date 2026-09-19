import { describe, expect, it } from 'vitest';
import type { NormalizedItem } from '../../src/core/daily_schedule/types';
import {
  monthGridDates,
  positionWeekItems,
  weekDates,
} from '../../src/ui/planner/calendar-projection';

function item(value: Pick<NormalizedItem, 'id' | 'sourceId' | 'date' | 'isTimed'> & Partial<NormalizedItem>): NormalizedItem {
  return {
    sourceType: 'task',
    sourceLabel: `task:${value.sourceId}`,
    isCompletable: true,
    isCompleted: false,
    isSkipped: false,
    outcome: 'pending',
    isPlayable: false,
    origin: 'schedule',
    ...value,
  };
}

describe('planner calendar projections', () => {
  it('uses shared start-of-week semantics for the seven-day range', () => {
    expect(weekDates('2026-09-19', 1)).toEqual([
      '2026-09-14','2026-09-15','2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20',
    ]);
    expect(weekDates('2026-09-19', 0)[0]).toBe('2026-09-13');
  });

  it('builds a complete six-week month grid aligned to start-of-week', () => {
    const dates = monthGridDates('2026-09-19', 1);
    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe('2026-08-31');
    expect(dates[41]).toBe('2026-10-11');
    expect(dates).toContain('2026-09-01');
    expect(dates).toContain('2026-09-30');
  });

  it('places overlapping timed items into visual lanes without changing IDs', () => {
    const positioned = positionWeekItems([
      item({ id: 'a', sourceId: 'a', date: '2026-09-19', start: '09:00', end: '10:00', isTimed: true }),
      item({ id: 'b', sourceId: 'b', date: '2026-09-19', start: '09:30', end: '10:30', isTimed: true }),
      item({ id: 'c', sourceId: 'c', date: '2026-09-19', start: '10:30', end: '11:00', isTimed: true }),
      item({ id: 'all-day', sourceId: 'all-day', date: '2026-09-19', isTimed: false, isAllDay: true }),
    ]);
    expect(positioned.map(entry => entry.item.id)).toEqual(['a', 'b', 'c']);
    expect(positioned[0].lane).toBe(0);
    expect(positioned[1].lane).toBe(1);
    expect(positioned[2].lane).toBe(0);
    expect(positioned.every(entry => entry.laneCount === 2)).toBe(true);
  });
});
