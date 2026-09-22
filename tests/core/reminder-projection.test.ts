import { describe, expect, it } from 'vitest';
import { ReminderProjectionEngine, type ReminderSourceObject } from '../../src/core/reminders';

function at(hour: number, minute: number, second = 0, day = 17): Date {
  return new Date(2026, 8, day, hour, minute, second, 0);
}

describe('ReminderProjectionEngine', () => {
  it('preserves exact trigger_time and independent reminder identity', () => {
    const object: ReminderSourceObject = {
      id: 'task-a', type: 'task', title: 'Ship',
      reminders: [
        { id: 'first', trigger_time: '2026-09-17T09:30:00.000', type: 'popup' },
        { id: 'second', trigger_time: '2026-09-17T09:31:00.000', type: 'push' },
      ],
    };
    const result = ReminderProjectionEngine.projectWindow([object], at(9, 29, 59), at(9, 31));
    expect(result.map(item => item.reminderId)).toEqual(['first', 'second']);
    expect(result.map(item => [item.triggerAt.getHours(), item.triggerAt.getMinutes()])).toEqual([[9, 30], [9, 31]]);
    expect(new Set(result.map(item => item.key)).size).toBe(2);
  });

  it('applies minutes_before to the canonical daily occurrence', () => {
    const object: ReminderSourceObject = {
      id: 'task-relative', type: 'task', title: 'Prepare campaign',
      start_date: '2026-09-17', time: '09:00',
      reminders: [{ id: 'fifteen-before', minutes_before: 15, type: 'popup' }],
    };
    const result = ReminderProjectionEngine.projectWindow([object], at(8, 44, 59), at(8, 45));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ sourceId: 'task-relative', reminderId: 'fifteen-before' });
    expect([result[0].triggerAt.getHours(), result[0].triggerAt.getMinutes()]).toEqual([8, 45]);
  });

  it('uses the canonical Scheduler owner for scheduler-only objects', () => {
    const object: ReminderSourceObject = {
      id: 'course-a', type: 'resource', title: 'Course', media_type: 'Course',
      scheduler: {
        start_date: '2026-09-17T09:00:00.000',
        rules: [{ repeat_type: 'number_of_days', interval: 1 }],
      },
      reminders: [{ id: 'course-before', minutes_before: 15, type: 'popup' }],
    };
    const result = ReminderProjectionEngine.projectWindow([object], at(8, 44, 59), at(8, 45));
    expect(result).toHaveLength(1);
    expect(result[0].reminderId).toBe('course-before');
  });

  it('applies days_before with local calendar-day arithmetic and time_of_day', () => {
    const object: ReminderSourceObject = {
      id: 'task-day-before', type: 'task', title: 'Travel',
      start_date: '2026-09-18', time: '15:00',
      reminders: [{ id: 'day-before', days_before: 1, time_of_day: '09:00', type: 'push' }],
    };
    const result = ReminderProjectionEngine.projectWindow([object], at(8, 59, 59), at(9, 0));
    expect(result).toHaveLength(1);
    expect(result[0].reminderId).toBe('day-before');
    expect([result[0].triggerAt.getDate(), result[0].triggerAt.getHours()]).toEqual([17, 9]);
  });

  it('projects app-created Task reminders from end_date and scheduled_time', () => {
    const object: ReminderSourceObject = {
      id: 'task-end-date', type: 'task', title: 'Prepare campaign',
      end_date: '2026-09-23T00:00:00.000',
      scheduled_time: '10:00',
      duration: 15,
      reminders: [{ id: 'same-day', days_before: 0, time_of_day: '09:45', type: 'popup' }],
    };
    const result = ReminderProjectionEngine.projectWindow(
      [object],
      new Date(2026, 8, 23, 9, 44, 59),
      new Date(2026, 8, 23, 9, 45),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceId: 'task-end-date',
      occurrenceId: 'task-end-date',
      reminderId: 'same-day',
      notificationType: 'popup',
    });
    expect([result[0].triggerAt.getDate(), result[0].triggerAt.getHours(), result[0].triggerAt.getMinutes()])
      .toEqual([23, 9, 45]);
  });

  it('projects minutes_before across the previous local calendar day', () => {
    const object: ReminderSourceObject = {
      id: 'midnight-task', type: 'task', title: 'Late handoff',
      start_date: '2026-09-18', time: '00:10',
      reminders: [{ id: 'fifteen-before-midnight', minutes_before: 15, type: 'popup' }],
    };
    const result = ReminderProjectionEngine.projectWindow(
      [object],
      new Date(2026, 8, 17, 23, 54, 59),
      new Date(2026, 8, 17, 23, 55),
    );
    expect(result).toHaveLength(1);
    expect(result[0].reminderId).toBe('fifteen-before-midnight');
    expect([result[0].triggerAt.getDate(), result[0].triggerAt.getHours(), result[0].triggerAt.getMinutes()])
      .toEqual([17, 23, 55]);
  });

  it('preserves valid escalation level and notification body on the delivery occurrence', () => {
    const object: ReminderSourceObject = {
      id: 'escalating-task', type: 'task', title: 'Follow up',
      reminders: [{
        id: 'urgent',
        trigger_time: '2026-09-17T09:30:00.000',
        type: 'alarm',
        notification_body: 'Call now',
        escalation_level: 2,
      }],
    };
    const result = ReminderProjectionEngine.projectWindow([object], at(9, 29, 59), at(9, 30));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      notificationType: 'alarm',
      notificationBody: 'Call now',
      escalationLevel: 2,
    });
  });

  it('combines legacy standalone local date plus clock instead of treating the date as UTC midnight', () => {
    const object: ReminderSourceObject = {
      id: 'legacy-reminder', type: 'reminder', title: 'Call clinic',
      date: '2026-09-17', time: '09:30', is_completed: false,
    };
    const result = ReminderProjectionEngine.projectWindow([object], at(9, 29, 59), at(9, 30));
    expect(result).toHaveLength(1);
    expect([result[0].triggerAt.getHours(), result[0].triggerAt.getMinutes()]).toEqual([9, 30]);
  });

  it('fails closed for archived/completed objects and invalid reminder configs', () => {
    const invalid: ReminderSourceObject[] = [
      { id: 'archived', type: 'task', archived: true, start_date: '2026-09-17', time: '09:30', reminders: [{ id: 'a', trigger_time: '2026-09-17T09:30:00.000' }] },
      { id: 'done', type: 'reminder', is_completed: true, date: '2026-09-17T09:30:00.000', time: '2026-09-17T09:30:00.000' },
      { id: 'negative', type: 'task', start_date: '2026-09-17', time: '09:30', reminders: [{ id: 'b', trigger_time: '2026-09-17T09:30:00.000', minutes_before: -1 }] },
      { id: 'escalation', type: 'task', start_date: '2026-09-17', time: '09:30', reminders: [{ id: 'c', trigger_time: '2026-09-17T09:30:00.000', escalation_level: 3 }] },
      { id: 'future-type', type: 'task', start_date: '2026-09-17', time: '09:30', reminders: [{ id: 'd', trigger_time: '2026-09-17T09:30:00.000', type: 'future' }] },
    ];
    expect(ReminderProjectionEngine.projectWindow(invalid, at(9, 29), at(9, 31))).toEqual([]);
  });
});
