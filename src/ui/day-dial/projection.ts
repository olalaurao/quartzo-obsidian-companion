import type { NormalizedItem } from '../../core/daily_schedule/types';
import { resolveTypeSignature, type QuartzoSharedSettings } from '../../core/shared-settings';
import type { GoogleCalendarProjection } from '../../integrations/google/calendar';
import type { VaultIndex } from '../../vault/index/types';

export const DAY_DIAL_SHORT_OCCURRENCE_MINUTES = 24;
const DEFAULT_MARKER_MINUTES = 5;
const MINUTES_PER_DAY = 24 * 60;

export interface DayDialProjectedItem {
  item: NormalizedItem;
  title: string;
  color: string | null;
  startMinute: number;
  endMinute: number;
  durationMinutes: number;
  visual: 'marker' | 'arc';
  lane: number;
  laneCount: number;
}

export interface DayDialProjection {
  timed: DayDialProjectedItem[];
  allDay: NormalizedItem[];
  maxOverlapLanes: number;
}

export interface DayDialProjectionContext {
  index: VaultIndex | null;
  googleEvents?: GoogleCalendarProjection[];
  sharedSettings?: QuartzoSharedSettings | null;
}

function clockMinutes(value: string | undefined, allowDayEnd = false): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (allowDayEnd && hour === 24 && minute === 0) return MINUTES_PER_DAY;
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : null;
}

export function titleForDayDialItem(
  item: NormalizedItem,
  context: DayDialProjectionContext,
): string {
  if (item.origin === 'externalEvent') {
    const external = context.googleEvents?.find(event => event.id === item.sourceId);
    return external?.summary?.trim() || item.sourceLabel;
  }
  const object = context.index?.objects.get(item.sourceId);
  const title = object?.frontmatter.title;
  return typeof title === 'string' && title.trim() ? title.trim() : item.sourceLabel;
}

/**
 * Companion Day Dial color contract:
 * explicit object/event color -> shared TypeSignature color -> theme fallback.
 *
 * Returning null intentionally delegates the final fallback to CSS/theme.
 */
export function colorForDayDialItem(
  item: NormalizedItem,
  context: DayDialProjectionContext,
): string | null {
  if (item.origin === 'externalEvent') {
    const external = context.googleEvents?.find(event => event.id === item.sourceId);
    const externalColor = normalizeHex(external?.colorHex);
    if (externalColor) return externalColor;
  }

  const object = context.index?.objects.get(item.sourceId);
  const explicit = normalizeHex(
    object?.frontmatter.color ??
    object?.frontmatter.color_hex ??
    object?.frontmatter.colorHex,
  );
  if (explicit) return explicit;

  const signature = resolveTypeSignature(context.sharedSettings ?? null, item.sourceType);
  return normalizeHex(signature?.colorHex);
}

function timedCandidates(
  items: NormalizedItem[],
  context: DayDialProjectionContext,
): Array<Omit<DayDialProjectedItem, 'lane' | 'laneCount'>> {
  const projected: Array<Omit<DayDialProjectedItem, 'lane' | 'laneCount'>> = [];
  for (const item of items) {
    if (item.isAllDay || !item.isTimed) continue;
    const start = clockMinutes(item.start);
    if (start == null) continue;
    const rawEnd = clockMinutes(item.end, true);
    const end = rawEnd != null && rawEnd > start
      ? rawEnd
      : Math.min(MINUTES_PER_DAY, start + DEFAULT_MARKER_MINUTES);
    const duration = Math.max(0, end - start);
    projected.push({
      item,
      title: titleForDayDialItem(item, context),
      color: colorForDayDialItem(item, context),
      startMinute: start,
      endMinute: end,
      durationMinutes: duration,
      visual: rawEnd == null || rawEnd <= start || duration <= DAY_DIAL_SHORT_OCCURRENCE_MINUTES
        ? 'marker'
        : 'arc',
    });
  }
  projected.sort((left, right) =>
    left.startMinute - right.startMinute ||
    left.endMinute - right.endMinute ||
    left.item.id.localeCompare(right.item.id)
  );
  return projected;
}

export function projectDayDial(
  items: NormalizedItem[],
  context: DayDialProjectionContext,
): DayDialProjection {
  const candidates = timedCandidates(items, context);
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();

  // Geometry only: arcs that overlap in civil time receive concentric lanes so
  // one canonical occurrence never visually hides another.
  for (const candidate of candidates) {
    if (candidate.visual !== 'arc') continue;
    let lane = 0;
    while (lane < laneEnds.length && candidate.startMinute < laneEnds[lane]) lane++;
    if (lane === laneEnds.length) laneEnds.push(candidate.endMinute);
    else laneEnds[lane] = candidate.endMinute;
    lanes.set(candidate.item.id, lane);
  }

  const laneCount = Math.max(1, laneEnds.length);
  return {
    timed: candidates.map(candidate => ({
      ...candidate,
      lane: candidate.visual === 'arc' ? (lanes.get(candidate.item.id) ?? 0) : 0,
      laneCount: candidate.visual === 'arc' ? laneCount : 1,
    })),
    allDay: items.filter(item => item.isAllDay),
    maxOverlapLanes: laneCount,
  };
}
