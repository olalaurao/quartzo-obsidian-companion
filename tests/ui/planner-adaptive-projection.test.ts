import { describe, expect, it } from 'vitest';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';
import { projectAdaptivePlanner } from '../../src/ui/planner/adaptive-projection';

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

function schedule(items: NormalizedItem[]): NormalizedSchedule {
  return { kind: 'mixed', count: items.length, items };
}

describe('projectAdaptivePlanner', () => {
  const now = new Date(2026, 8, 19, 10, 0);

  it('resolves active item as Now and caps Next at three', () => {
    const result = projectAdaptivePlanner(schedule([
      item({ id: 'active', sourceId: 'active', date: '2026-09-19', start: '09:30', end: '10:30', isTimed: true }),
      item({ id: 'a', sourceId: 'a', date: '2026-09-19', start: '11:00', end: '11:30', isTimed: true }),
      item({ id: 'b', sourceId: 'b', date: '2026-09-19', start: '12:00', end: '12:30', isTimed: true }),
      item({ id: 'c', sourceId: 'c', date: '2026-09-19', start: '13:00', end: '13:30', isTimed: true }),
      item({ id: 'd', sourceId: 'd', date: '2026-09-19', start: '14:00', end: '14:30', isTimed: true }),
    ]), '2026-09-19', now);
    expect(result.now.map(entry => entry.item.id)).toEqual(['active']);
    expect(result.next.map(entry => entry.item.id)).toEqual(['a', 'b', 'c']);
    expect(result.later.map(entry => entry.item.id)).toEqual(['d']);
  });

  it('prefers a fixed anchor for Now and a deadline in Next', () => {
    const result = projectAdaptivePlanner(schedule([
      item({ id: 'flex', sourceId: 'flex', date: '2026-09-19', start: '11:00', end: '11:30', isTimed: true }),
      item({ id: 'deadline', sourceId: 'deadline', date: '2026-09-19', start: '12:00', end: '12:30', isTimed: true, restrictionMetadata: { has_real_deadline: true } }),
      item({ id: 'fixed', sourceId: 'fixed', date: '2026-09-19', start: '15:00', end: '16:00', isTimed: true, restrictionMetadata: { rigidity: 'fixed' } }),
    ]), '2026-09-19', now);
    expect(result.now.map(entry => entry.item.id)).toEqual(['fixed']);
    expect(result.next.map(entry => entry.item.id)).toEqual(['deadline', 'flex']);
  });

  it('puts missed recoverable work in Fell Behind but excludes calendar attendance', () => {
    const result = projectAdaptivePlanner(schedule([
      item({ id: 'task', sourceId: 'task', date: '2026-09-19', start: '08:00', end: '09:00', isTimed: true }),
      item({ id: 'calendar', sourceId: 'calendar', date: '2026-09-19', start: '08:00', end: '09:00', isTimed: true, sourceType: 'google_calendar', origin: 'externalEvent', isCompletable: false }),
    ]), '2026-09-19', now);
    expect(result.fellBehind.map(entry => entry.item.id)).toEqual(['task']);
  });

  it('excludes canonical Journal/Tracker evidence aliases from adaptive work', () => {
    const result = projectAdaptivePlanner(schedule([
      item({ id: 'entry', sourceId: 'entry', date: '2026-09-19', start: '09:00', end: '09:15', isTimed: true, sourceType: 'entry', isCompletable: false }),
      item({ id: 'record', sourceId: 'record', date: '2026-09-19', isTimed: false, sourceType: 'tracker_record', isCompletable: false }),
    ]), '2026-09-19', now);
    expect(result.now).toEqual([]);
    expect(result.next).toEqual([]);
    expect(result.later).toEqual([]);
    expect(result.fellBehind).toEqual([]);
  });

  it('excludes completed/skipped items and does not invent Essentials or Capacity', () => {
    const result = projectAdaptivePlanner(schedule([
      item({ id: 'done', sourceId: 'done', date: '2026-09-19', isTimed: false, isCompleted: true, outcome: 'done' }),
      item({ id: 'skip', sourceId: 'skip', date: '2026-09-19', isTimed: false, isSkipped: true, outcome: 'skipped' }),
    ]), '2026-09-19', now);
    expect(result.now).toEqual([]);
    expect(result.next).toEqual([]);
    expect(result.later).toEqual([]);
    expect(result.fellBehind).toEqual([]);
    expect(result.essentials).toEqual([]);
    expect(result.capacity).toBeNull();
  });
});
