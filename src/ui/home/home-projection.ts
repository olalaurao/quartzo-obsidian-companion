import type { NormalizedItem, NormalizedSchedule } from '../../core/daily_schedule/types';
import { localIsoDate } from '../../core/local-date';

export interface HomeScheduleProjection {
  now: NormalizedItem[];
  upNext: NormalizedItem[];
  today: NormalizedItem[];
}

function minutesFromClock(value: string | undefined): number | null {
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

/**
 * Pure presentation projection over the canonical Daily Schedule result.
 * It never decides recurrence, overdue membership, completion, or capabilities.
 */
export function projectHomeSchedule(
  schedule: NormalizedSchedule,
  selectedDate: string,
  now: Date,
): HomeScheduleProjection {
  const today = [...schedule.items];
  if (selectedDate !== localIsoDate(now)) {
    return { now: [], upNext: [], today };
  }

  const currentMinute = now.getHours() * 60 + now.getMinutes();
  const active: NormalizedItem[] = [];
  const future: Array<{ item: NormalizedItem; start: number }> = [];

  for (const item of today) {
    const start = minutesFromClock(item.start);
    if (start == null) continue;
    const end = minutesFromClock(item.end);
    if (start <= currentMinute && end != null && currentMinute < end) {
      active.push(item);
      continue;
    }
    if (start > currentMinute) future.push({ item, start });
  }

  future.sort((a, b) => a.start - b.start || a.item.id.localeCompare(b.item.id));
  const nextStart = future[0]?.start;
  const upNext = nextStart == null
    ? []
    : future.filter(candidate => candidate.start === nextStart).map(candidate => candidate.item);

  return { now: active, upNext, today };
}
