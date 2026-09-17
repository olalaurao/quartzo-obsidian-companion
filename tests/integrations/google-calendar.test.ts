import { describe, expect, it } from 'vitest';
import {
  GoogleCalendarAdapter,
  GoogleCalendarAuthorizationError,
  type CalendarHttpRequester,
} from '../../src/integrations/google/calendar';

function response(status: number, body: unknown) {
  return { status, body: JSON.stringify(body) };
}

describe('GoogleCalendarAdapter', () => {
  it('reads Google-selected calendars, expands events, preserves source identity and skips cancelled events', async () => {
    const requested: string[] = [];
    const requester: CalendarHttpRequester = async (url) => {
      requested.push(url);
      if (url.includes('/users/me/calendarList')) {
        return response(200, {
          items: [
            { id: 'primary', selected: true, backgroundColor: '#4285f4' },
            { id: 'hidden', selected: false, backgroundColor: '#999999' },
            { id: 'team@example.com', selected: true, backgroundColor: '#0f9d58' },
          ],
        });
      }
      if (url.includes(encodeURIComponent('primary'))) {
        return response(200, {
          items: [
            {
              id: 'event-a',
              summary: 'Morning sync',
              status: 'confirmed',
              htmlLink: 'https://calendar.google.com/event?eid=a',
              start: { dateTime: '2026-09-17T09:00:00-03:00' },
              end: { dateTime: '2026-09-17T09:30:00-03:00' },
            },
            {
              id: 'cancelled',
              summary: 'Cancelled',
              status: 'cancelled',
              start: { dateTime: '2026-09-17T10:00:00-03:00' },
              end: { dateTime: '2026-09-17T10:30:00-03:00' },
            },
          ],
        });
      }
      if (url.includes(encodeURIComponent('team@example.com'))) {
        return response(200, {
          items: [
            {
              id: 'event-a',
              summary: 'Team offsite',
              status: 'confirmed',
              start: { date: '2026-09-18' },
              end: { date: '2026-09-20' },
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const adapter = new GoogleCalendarAdapter(requester);
    adapter.setAccessToken('token');
    const events = await adapter.listVisibleEvents(
      new Date('2026-09-17T00:00:00-03:00'),
      new Date('2026-09-21T00:00:00-03:00'),
    );

    expect(events).toEqual([
      {
        id: 'primary::event-a',
        eventId: 'event-a',
        calendarId: 'primary',
        summary: 'Morning sync',
        start: '2026-09-17T09:00:00-03:00',
        end: '2026-09-17T09:30:00-03:00',
        allDay: false,
        htmlLink: 'https://calendar.google.com/event?eid=a',
        colorHex: '#4285f4',
      },
      {
        id: 'team@example.com::event-a',
        eventId: 'event-a',
        calendarId: 'team@example.com',
        summary: 'Team offsite',
        start: '2026-09-18',
        end: '2026-09-20',
        allDay: true,
        htmlLink: undefined,
        colorHex: '#0f9d58',
      },
    ]);
    expect(requested.some(url => url.includes('hidden'))).toBe(false);
    expect(requested.filter(url => url.includes('/events')).length).toBe(2);
  });

  it('falls back to primary when Google has no selected calendars', async () => {
    const requested: string[] = [];
    const adapter = new GoogleCalendarAdapter(async url => {
      requested.push(url);
      if (url.includes('/users/me/calendarList')) return response(200, { items: [{ id: 'hidden', selected: false }] });
      return response(200, { items: [] });
    });
    adapter.setAccessToken('token');

    await adapter.listVisibleEvents(new Date('2026-09-17T00:00:00Z'), new Date('2026-09-18T00:00:00Z'));
    expect(requested.some(url => url.includes('/calendars/primary/events'))).toBe(true);
  });

  it('refreshes once for expired credentials and fails closed for missing Calendar scope', async () => {
    let calls = 0;
    const adapter = new GoogleCalendarAdapter(async () => {
      calls += 1;
      if (calls === 1) return response(401, { error: { message: 'Invalid Credentials' } });
      return response(403, { error: { message: 'Request had insufficient authentication scopes' } });
    });
    adapter.setAccessToken('old-token');
    adapter.setTokenRefreshCallback(async () => 'new-token');

    await expect(adapter.listVisibleEvents(
      new Date('2026-09-17T00:00:00Z'),
      new Date('2026-09-18T00:00:00Z'),
    )).rejects.toBeInstanceOf(GoogleCalendarAuthorizationError);
    expect(calls).toBe(2);
  });
});
