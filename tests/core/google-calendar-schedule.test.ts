import { describe, expect, it } from 'vitest';
import { DailyScheduleEngine } from '../../src/core/daily_schedule';

describe('Google Calendar Daily Schedule projection', () => {
  it('uses the remote summary as the external source label', () => {
    const schedule = DailyScheduleEngine.normalize({
      date: '2026-09-17',
      googleEvents: [{
        id: 'primary::event-1',
        summary: 'Design review',
        start: '2026-09-17T14:30:00-03:00',
        end: '2026-09-17T15:15:00-03:00',
      }],
    });

    expect(schedule.items).toEqual([
      expect.objectContaining({
        id: 'google_calendar:primary::event-1',
        sourceId: 'primary::event-1',
        sourceType: 'google_calendar',
        sourceLabel: 'Design review',
        start: '14:30',
        end: '15:15',
        origin: 'externalEvent',
        isCompletable: false,
      }),
    ]);
  });

  it('projects an all-day multi-day event on every covered local date using an exclusive end date', () => {
    const event = {
      id: 'team::offsite',
      summary: 'Offsite',
      start: '2026-09-18',
      end: '2026-09-20',
      allDay: true,
    };

    for (const date of ['2026-09-18', '2026-09-19']) {
      const schedule = DailyScheduleEngine.normalize({ date, googleEvents: [event] });
      expect(schedule.items).toEqual([
        expect.objectContaining({
          sourceId: 'team::offsite',
          sourceLabel: 'Offsite',
          isTimed: false,
          isAllDay: true,
        }),
      ]);
    }

    expect(DailyScheduleEngine.normalize({
      date: '2026-09-20',
      googleEvents: [event],
    }).items).toEqual([]);
  });
});
