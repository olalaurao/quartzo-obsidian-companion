import { describe, expect, it } from 'vitest';
import type { NormalizedItem } from '../../src/core/daily_schedule/types';
import { parseSharedSettings } from '../../src/core/shared-settings';
import {
  DAY_DIAL_SHORT_OCCURRENCE_MINUTES,
  colorForDayDialItem,
  projectDayDial,
  titleForDayDialItem,
} from '../../src/ui/day-dial/projection';
import type { VaultIndex } from '../../src/vault/index/types';

function item(overrides: Partial<NormalizedItem> & Pick<NormalizedItem, 'id' | 'sourceId'>): NormalizedItem {
  return {
    id: overrides.id,
    sourceId: overrides.sourceId,
    sourceType: 'task',
    sourceLabel: `task:${overrides.sourceId}`,
    date: '2026-09-19',
    start: '09:00',
    end: '10:00',
    isTimed: true,
    isAllDay: false,
    isCompletable: true,
    isCompleted: false,
    isSkipped: false,
    outcome: 'pending',
    isPlayable: false,
    origin: 'schedule',
    ...overrides,
  };
}

function index(): VaultIndex {
  return {
    files: new Map(),
    objects: new Map([
      ['explicit', {
        id: 'explicit',
        type: 'task',
        path: 'tasks/explicit.md',
        frontmatter: { id: 'explicit', type: 'task', title: 'Explicit color', color: '#112233' },
        body: '',
      }],
      ['typed', {
        id: 'typed',
        type: 'task',
        path: 'tasks/typed.md',
        frontmatter: { id: 'typed', type: 'task', title: 'Type color' },
        body: '',
      }],
    ]),
    lastModified: 0,
  };
}

const sharedSettings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  task:
    objectType: task
    markerType: property
    markerValue: "type: task"
    colorHex: "#445566"
---
`)!;

describe('Day Dial canonical projection', () => {
  it('uses markers through 24 minutes and arcs from 25 minutes', () => {
    const projection = projectDayDial([
      item({ id: 'short', sourceId: 'short', start: '09:00', end: '09:24' }),
      item({ id: 'arc', sourceId: 'arc', start: '10:00', end: '10:25' }),
    ], { index: null });

    expect(DAY_DIAL_SHORT_OCCURRENCE_MINUTES).toBe(24);
    expect(projection.timed.find(entry => entry.item.id === 'short')?.visual).toBe('marker');
    expect(projection.timed.find(entry => entry.item.id === 'arc')?.visual).toBe('arc');
  });

  it('assigns deterministic concentric lanes when canonical intervals overlap', () => {
    const projection = projectDayDial([
      item({ id: 'a', sourceId: 'a', start: '09:00', end: '10:00' }),
      item({ id: 'b', sourceId: 'b', start: '09:30', end: '10:30' }),
      item({ id: 'c', sourceId: 'c', start: '10:30', end: '11:00' }),
    ], { index: null });

    const byId = new Map(projection.timed.map(entry => [entry.item.id, entry]));
    expect(byId.get('a')?.lane).toBe(0);
    expect(byId.get('b')?.lane).toBe(1);
    expect(byId.get('c')?.lane).toBe(0);
    expect(projection.maxOverlapLanes).toBe(2);
  });

  it('keeps all-day facts outside the ring without inventing another occurrence', () => {
    const allDay = item({
      id: 'all-day',
      sourceId: 'all-day',
      start: undefined,
      end: undefined,
      isTimed: false,
      isAllDay: true,
    });
    const projection = projectDayDial([allDay], { index: null });
    expect(projection.timed).toEqual([]);
    expect(projection.allDay).toEqual([allDay]);
  });

  it('resolves colors in explicit object -> TypeSignature -> theme fallback order', () => {
    const vaultIndex = index();
    expect(colorForDayDialItem(item({ id: 'explicit-item', sourceId: 'explicit' }), {
      index: vaultIndex,
      sharedSettings,
    })).toBe('#112233');

    expect(colorForDayDialItem(item({ id: 'typed-item', sourceId: 'typed' }), {
      index: vaultIndex,
      sharedSettings,
    })).toBe('#445566');

    expect(colorForDayDialItem(item({ id: 'fallback', sourceId: 'missing', sourceType: 'unknown' }), {
      index: vaultIndex,
      sharedSettings,
    })).toBeNull();
  });

  it('uses Google Calendar projection title/color without converting it into a local object', () => {
    const external = item({
      id: 'google_calendar:event-1',
      sourceId: 'event-1',
      sourceType: 'google_calendar',
      sourceLabel: 'google_calendar:event-1',
      origin: 'externalEvent',
      isCompletable: false,
    });
    const googleEvents = [{
      id: 'event-1',
      eventId: 'event-1',
      calendarId: 'primary',
      summary: 'External meeting',
      start: '2026-09-19T09:00:00-03:00',
      end: '2026-09-19T10:00:00-03:00',
      allDay: false,
      colorHex: '#ABCDEF',
    }];

    expect(titleForDayDialItem(external, { index: null, googleEvents })).toBe('External meeting');
    expect(colorForDayDialItem(external, { index: null, googleEvents })).toBe('#ABCDEF');
  });
});
