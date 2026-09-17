import { describe, expect, it } from 'vitest';
import { DailyScheduleEngine } from '../../src/core/daily_schedule';

describe('Daily Schedule presentation capability projection', () => {
  it('preserves local task identity, capability, completion and source label', () => {
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-17',
      objects: [{
        id: 'task-1',
        type: 'task',
        title: 'Ship beta',
        stage: 'done',
        start_date: '2026-09-17',
        time: '09:00',
        duration: 30,
        __path: 'tasks/task-1.md',
      }],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'task:task-1',
      sourceId: 'task-1',
      sourceType: 'task',
      sourceLabel: 'task:task-1:tasks/task-1.md',
      occurrenceId: 'task-1',
      isCompletable: true,
      isCompleted: true,
      origin: 'schedule',
    });
  });

  it('marks legacy Habit slot timing without guessing occurrence completion', () => {
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-17',
      objects: [{
        id: 'habit-1',
        type: 'habit',
        title: 'Water',
        slots: [{ time: '10:00', label: 'Morning' }],
        __path: 'habits/habit-1.md',
      }],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceId: 'habit-1',
      sourceType: 'habit',
      sourceLabel: 'habit:habit-1:habits/habit-1.md',
      slotIndex: 0,
      isCompletable: true,
      isCompleted: false,
      origin: 'legacyTime',
    });
  });

  it('projects Google Calendar as an external non-completable source', () => {
    const result = DailyScheduleEngine.normalize({
      date: '2026-09-17',
      googleEvents: [{
        id: 'gcal-1',
        summary: 'External meeting',
        start: '2026-09-17T14:00:00-03:00',
        end: '2026-09-17T15:00:00-03:00',
      }],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'google_calendar:gcal-1',
      sourceId: 'gcal-1',
      sourceType: 'google_calendar',
      sourceLabel: 'google_calendar:gcal-1',
      isCompletable: false,
      isCompleted: false,
      origin: 'externalEvent',
    });
  });
});
