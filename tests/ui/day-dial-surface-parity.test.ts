import { describe, expect, it } from 'vitest';
import type { NormalizedItem, NormalizedSchedule } from '../../src/core/daily_schedule/types';
import { projectDayDial } from '../../src/ui/day-dial/projection';
import { projectHomeSchedule } from '../../src/ui/home/home-projection';

function item(
  id: string,
  sourceType: string,
  start: string,
  end?: string,
): NormalizedItem {
  return {
    id,
    sourceId: id,
    sourceType,
    sourceLabel: `${sourceType}:${id}`,
    date: '2026-09-19',
    start,
    end,
    isTimed: true,
    isAllDay: false,
    isCompletable: true,
    isCompleted: false,
    isSkipped: false,
    outcome: 'pending',
    isPlayable: sourceType === 'system' || sourceType === 'routine',
    editable: true,
    origin: sourceType === 'google_calendar' ? 'externalEvent' : 'schedule',
  };
}

describe('Day Dial canonical surface parity', () => {
  it('preserves every valid timed item that Home receives from the same schedule', () => {
    const items = [
      item('task-1', 'task', '08:00', '08:30'),
      item('habit-1', 'habit', '09:00'),
      item('reminder-1', 'reminder', '09:30', '09:45'),
      item('event-1', 'event', '10:00', '11:00'),
      item('google-1', 'google_calendar', '11:00', '12:00'),
      item('block-1', 'time_block', '12:00', '13:00'),
      item('focus-1', 'pomodoro_session', '13:00', '13:25'),
      item('system-1', 'system', '14:00'),
      item('routine-1', 'routine', '15:00', '15:30'),
      item('rotation-1', 'project', '16:00', '17:00'),
      item('entry-1', 'entry', '17:00', '17:15'),
      item('person-1', 'person', '18:00', '18:10'),
      item('goal-1', 'goal', '19:00', '19:20'),
    ];
    const schedule: NormalizedSchedule = {
      kind: 'mixed',
      count: items.length,
      items,
    };

    const home = projectHomeSchedule(
      schedule,
      '2026-09-19',
      new Date('2026-09-18T12:00:00'),
    );
    const dial = projectDayDial(schedule.items, { index: null });

    expect(dial.invalidTimed).toEqual([]);
    expect(dial.timed.map(entry => entry.item.id).sort()).toEqual(
      home.today.filter(entry => entry.isTimed && !entry.isAllDay).map(entry => entry.id).sort(),
    );
  });

  it('uses the canonical icon fallback matrix for supported timed source types', () => {
    const items = [
      item('task-1', 'task', '08:00'),
      item('habit-1', 'habit', '09:00'),
      item('reminder-1', 'reminder', '10:00'),
      item('event-1', 'event', '11:00'),
      item('google-1', 'google_calendar', '12:00'),
      item('block-1', 'time_block', '13:00'),
      item('focus-1', 'pomodoro_session', '14:00'),
      item('system-1', 'system', '15:00'),
      item('routine-1', 'routine', '16:00'),
      item('rotation-1', 'project', '17:00'),
      item('entry-1', 'entry', '18:00'),
      item('person-1', 'person', '19:00'),
      item('goal-1', 'goal', '20:00'),
    ];

    const icons = Object.fromEntries(
      projectDayDial(items, { index: null }).timed.map(entry => [
        entry.item.sourceType,
        entry.iconName,
      ]),
    );

    expect(icons).toEqual({
      task: 'circle-check',
      habit: 'refresh-cw',
      reminder: 'bell',
      event: 'calendar-days',
      google_calendar: 'calendar-days',
      time_block: 'clock-3',
      pomodoro_session: 'timer',
      system: 'workflow',
      routine: 'list-checks',
      project: 'rotate-cw',
      entry: 'notebook-pen',
      person: 'user-round',
      goal: 'target',
    });
  });
});
