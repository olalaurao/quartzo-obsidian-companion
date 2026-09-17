import * as https from 'node:https';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export interface GoogleCalendarProjection {
  id: string;
  eventId: string;
  calendarId: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink?: string;
  colorHex?: string;
}

interface CalendarListEntry {
  id?: string;
  selected?: boolean;
  backgroundColor?: string;
}

interface CalendarListResponse {
  items?: CalendarListEntry[];
  nextPageToken?: string;
}

interface CalendarEventDateTime {
  date?: string;
  dateTime?: string;
}

interface CalendarEvent {
  id?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: CalendarEventDateTime;
  end?: CalendarEventDateTime;
}

interface CalendarEventsResponse {
  items?: CalendarEvent[];
  nextPageToken?: string;
}

export interface CalendarHttpResponse {
  status: number;
  body: string;
}

export type CalendarHttpRequester = (url: string, accessToken: string) => Promise<CalendarHttpResponse>;

export class GoogleCalendarAuthorizationError extends Error {
  constructor(message = 'Google Calendar authorization required') {
    super(message);
    this.name = 'GoogleCalendarAuthorizationError';
  }
}

function defaultRequester(url: string, accessToken: string): Promise<CalendarHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }, response => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          request.destroy(new Error('Google Calendar response exceeded safety limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function isAuthorizationFailure(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status !== 403) return false;
  const normalized = body.toLowerCase().replace(/[\s_-]+/g, '');
  return normalized.includes('insufficientpermissions') ||
    normalized.includes('insufficientauthenticationscopes') ||
    normalized.includes('autherror') ||
    normalized.includes('loginrequired') ||
    normalized.includes('invalidcredentials');
}

function parseJson<T>(body: string, context: string): T {
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw new Error(`${context} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function eventStartSortValue(event: GoogleCalendarProjection): number {
  if (event.allDay) return new Date(`${event.start}T00:00:00`).getTime();
  const value = Date.parse(event.start);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

export class GoogleCalendarAdapter {
  private accessToken: string | null = null;
  private tokenRefreshCallback: (() => Promise<string | null>) | null = null;

  constructor(private readonly requester: CalendarHttpRequester = defaultRequester) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token && token.trim() ? token : null;
  }

  setTokenRefreshCallback(callback: () => Promise<string | null>): void {
    this.tokenRefreshCallback = callback;
  }

  private async request<T>(url: string): Promise<T> {
    if (!this.accessToken) throw new GoogleCalendarAuthorizationError();

    let response = await this.requester(url, this.accessToken);
    if (isAuthorizationFailure(response.status, response.body) && this.tokenRefreshCallback) {
      const refreshed = await this.tokenRefreshCallback();
      if (refreshed) {
        this.setAccessToken(refreshed);
        response = await this.requester(url, refreshed);
      }
    }

    if (isAuthorizationFailure(response.status, response.body)) {
      throw new GoogleCalendarAuthorizationError();
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Google Calendar request failed (${response.status})`);
    }
    return parseJson<T>(response.body, 'Google Calendar');
  }

  private async listCalendars(): Promise<CalendarListEntry[]> {
    const entries: CalendarListEntry[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${GOOGLE_CALENDAR_API}/users/me/calendarList`);
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('fields', 'nextPageToken,items(id,selected,backgroundColor)');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.request<CalendarListResponse>(url.toString());
      entries.push(...(page.items ?? []));
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    return entries;
  }

  private visibleCalendars(entries: CalendarListEntry[]): Array<{ id: string; colorHex?: string }> {
    const visible = entries
      .filter(entry => entry.id && entry.selected !== false)
      .map(entry => ({ id: entry.id!, colorHex: entry.backgroundColor }))
      .sort((left, right) => left.id.localeCompare(right.id));
    return visible.length > 0 ? visible : [{ id: 'primary' }];
  }

  private async listCalendarEvents(
    calendarId: string,
    colorHex: string | undefined,
    timeMin: Date,
    timeMax: Date,
  ): Promise<GoogleCalendarProjection[]> {
    const events: GoogleCalendarProjection[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', '2500');
      url.searchParams.set('timeMin', timeMin.toISOString());
      url.searchParams.set('timeMax', timeMax.toISOString());
      url.searchParams.set('fields', 'nextPageToken,items(id,summary,status,htmlLink,start(date,dateTime),end(date,dateTime))');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.request<CalendarEventsResponse>(url.toString());
      for (const event of page.items ?? []) {
        if (!event.id || event.status === 'cancelled') continue;
        const start = event.start?.dateTime ?? event.start?.date;
        const end = event.end?.dateTime ?? event.end?.date;
        if (!start || !end) continue;
        const allDay = event.start?.date != null && event.start.dateTime == null;
        events.push({
          id: `${calendarId}::${event.id}`,
          eventId: event.id,
          calendarId,
          summary: event.summary?.trim() || 'Untitled Google Calendar event',
          start,
          end,
          allDay,
          htmlLink: event.htmlLink || undefined,
          colorHex,
        });
      }
      pageToken = page.nextPageToken || undefined;
    } while (pageToken);
    return events;
  }

  async listVisibleEvents(timeMin: Date, timeMax: Date): Promise<GoogleCalendarProjection[]> {
    if (!(timeMin instanceof Date) || Number.isNaN(timeMin.getTime())) {
      throw new Error('Google Calendar timeMin must be a valid Date');
    }
    if (!(timeMax instanceof Date) || Number.isNaN(timeMax.getTime()) || timeMax <= timeMin) {
      throw new Error('Google Calendar timeMax must be after timeMin');
    }

    const calendars = this.visibleCalendars(await this.listCalendars());
    const eventLists = await Promise.all(
      calendars.map(calendar => this.listCalendarEvents(calendar.id, calendar.colorHex, timeMin, timeMax)),
    );
    const merged = eventLists.flat();
    merged.sort((left, right) =>
      eventStartSortValue(left) - eventStartSortValue(right) ||
      left.calendarId.localeCompare(right.calendarId) ||
      left.eventId.localeCompare(right.eventId)
    );
    return merged;
  }
}
