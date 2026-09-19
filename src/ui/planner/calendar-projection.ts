import type { NormalizedItem } from '../../core/daily_schedule/types';
import { addLocalDays, localIsoDate, parseLocalIsoDate } from '../../core/local-date';

export interface WeekPosition {
  item: NormalizedItem;
  start: number;
  end: number;
  lane: number;
  laneCount: number;
}

export function clockMinutes(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

export function positionWeekItems(items: NormalizedItem[]): WeekPosition[] {
  const candidates = items
    .filter(item => item.isTimed && !item.isAllDay)
    .map(item => {
      const start = clockMinutes(item.start);
      const endRaw = clockMinutes(item.end);
      if (start == null) return null;
      const end = endRaw != null && endRaw > start ? endRaw : Math.min(1440, start + 15);
      return { item, start, end };
    })
    .filter((value): value is { item: NormalizedItem; start: number; end: number } => value != null)
    .sort((a, b) => a.start - b.start || a.end - b.end || a.item.id.localeCompare(b.item.id));

  const laneEnds: number[] = [];
  const assigned = candidates.map(candidate => {
    let lane = laneEnds.findIndex(end => end <= candidate.start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(candidate.end);
    } else {
      laneEnds[lane] = candidate.end;
    }
    return { ...candidate, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return assigned.map(entry => ({ ...entry, laneCount }));
}

export function weekDates(selectedDate: string, startOfWeek: number): string[] {
  const selected = parseLocalIsoDate(selectedDate);
  const normalizedStart = ((Math.trunc(startOfWeek) % 7) + 7) % 7;
  const delta = (selected.getDay() - normalizedStart + 7) % 7;
  const start = addLocalDays(selected, -delta);
  return Array.from({ length: 7 }, (_, index) => localIsoDate(addLocalDays(start, index)));
}

export function monthGridDates(selectedDate: string, startOfWeek: number): string[] {
  const selected = parseLocalIsoDate(selectedDate);
  const first = new Date(selected.getFullYear(), selected.getMonth(), 1);
  const normalizedStart = ((Math.trunc(startOfWeek) % 7) + 7) % 7;
  const leading = (first.getDay() - normalizedStart + 7) % 7;
  const gridStart = addLocalDays(first, -leading);
  return Array.from({ length: 42 }, (_, index) => localIsoDate(addLocalDays(gridStart, index)));
}
