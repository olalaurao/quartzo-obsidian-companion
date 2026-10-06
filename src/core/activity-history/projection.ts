import {
  addLocalDays,
  localCivilDayDifference,
  localIsoDate,
  parseLocalIsoDate,
  shiftLocalMonth,
} from '../local-date';
import type {
  ActivityCapabilities,
  ActivityCategory,
  ActivityCategoryFilter,
  ActivityCountBucket,
  ActivityEvent,
  ActivityEventType,
  ActivityPeriod,
  ActivityProjection,
  ActivityProjectionOptions,
  ProjectedActivityEvent,
} from './types';

const EVENT_CATEGORY: Record<ActivityEventType, ActivityCategory> = {
  object_created: 'notes',
  object_edited: 'notes',
  object_moved: 'notes',
  object_retired: 'notes',
  capture_created: 'captures',
  occurrence_completed: 'tasks',
  occurrence_already_did: 'tasks',
  occurrence_skipped: 'tasks',
  occurrence_rescheduled: 'tasks',
  tracking_record_created: 'tracking',
  system_manually_run: 'systems',
  routine_manually_run: 'systems',
  focus_session_completed: 'focus',
};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  notes: 'Notes',
  tasks: 'Tasks',
  captures: 'Captures',
  tracking: 'Tracking',
  systems: 'Systems',
  focus: 'Focus',
};

const EVENT_LABELS: Record<ActivityEventType, string> = {
  object_created: 'Note created',
  object_edited: 'Note edited',
  object_moved: 'Moved',
  object_retired: 'Retired',
  capture_created: 'Captured',
  occurrence_completed: 'Task completed',
  occurrence_already_did: 'Already did',
  occurrence_skipped: 'Skipped',
  occurrence_rescheduled: 'Rescheduled',
  tracking_record_created: 'Tracking recorded',
  system_manually_run: 'System run',
  routine_manually_run: 'Routine run',
  focus_session_completed: 'Focus completed',
};

export function activityCategoryForEvent(type: ActivityEventType): ActivityCategory {
  return EVENT_CATEGORY[type];
}

export function availableActivityFilters(capabilities: ActivityCapabilities): string[] {
  const filters = ['all', ...Object.keys(CATEGORY_LABELS)];
  return capabilities.canvasActivity ? [...filters, 'canvas'] : filters;
}

export function shiftActivityPeriodAnchor(anchor: string, period: ActivityPeriod, delta: number): string {
  const date = parseLocalIsoDate(anchor);
  if (period === 'day') return localIsoDate(addLocalDays(date, delta));
  if (period === 'week') return localIsoDate(addLocalDays(date, delta * 7));
  if (period === 'month') return shiftLocalMonth(anchor, delta);
  const shifted = new Date(date.getFullYear() + delta, date.getMonth(), date.getDate());
  return localIsoDate(shifted);
}

export function projectActivityHistory(
  events: ActivityEvent[],
  options: ActivityProjectionOptions,
): ActivityProjection {
  const rangeStart = options.rangeStart;
  const rangeEnd = options.rangeEnd;
  const allInRange = events
    .map(projectEvent)
    .filter(event => event.localDate >= rangeStart && event.localDate <= rangeEnd)
    .sort(compareProjectedEvents);

  const visibleEvents = allInRange.filter(event =>
    categoryMatches(event, options.categoryFilter) &&
    folderMatches(event, options.folderFilter) &&
    privacyMatches(event, options.privacyMode)
  ).map(event => applyPrivacy(event, options.privacyMode));

  return {
    visibleEvents,
    groups: groupEvents(visibleEvents, options.period),
    total: visibleEvents.length,
    byType: countByType(visibleEvents),
    hourlyBuckets: buildHourlyBuckets(visibleEvents),
    heatmapBuckets: buildHeatmapBuckets(visibleEvents, options),
    folderBuckets: countFolders(visibleEvents),
    emptyKind: visibleEvents.length > 0 ? 'none' : allInRange.length > 0 ? 'filtered-empty' : 'no-history',
  };
}

function projectEvent(event: ActivityEvent): ProjectedActivityEvent {
  const providerLabel = event.provenance?.providerLabel?.trim() || null;
  return {
    ...event,
    category: EVENT_CATEGORY[event.eventType],
    localDate: localDateFromTimestamp(event.occurredAt),
    folder: event.folder ?? folderFromPath(event.sourcePath),
    renderExcerpt: event.excerpt ?? null,
    providerLabel,
    renderedEyebrow: providerLabel && event.eventType === 'capture_created'
      ? `${EVENT_LABELS[event.eventType]} · ${providerLabel}`
      : EVENT_LABELS[event.eventType],
  };
}

function applyPrivacy(event: ProjectedActivityEvent, privacyMode: boolean): ProjectedActivityEvent {
  return privacyMode ? { ...event, renderExcerpt: null } : event;
}

function privacyMatches(_event: ProjectedActivityEvent, _privacyMode: boolean): boolean {
  return true;
}

function categoryMatches(event: ProjectedActivityEvent, filter: ActivityCategoryFilter): boolean {
  return filter === 'all' || event.category === filter;
}

function folderMatches(event: ProjectedActivityEvent, filter: string | null): boolean {
  if (!filter || filter === 'all') return true;
  return event.folder === filter || event.folder.startsWith(`${filter}/`);
}

function localDateFromTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Activity occurredAt timestamp: ${value}`);
  }
  return localIsoDate(parsed);
}

function folderFromPath(path: string | undefined): string {
  if (!path) return '';
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '' : normalized.slice(0, index);
}

function compareProjectedEvents(a: ProjectedActivityEvent, b: ProjectedActivityEvent): number {
  const time = Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
  if (time !== 0) return time;
  return a.eventId.localeCompare(b.eventId);
}

function groupEvents(events: ProjectedActivityEvent[], period: ActivityPeriod) {
  const groups = new Map<string, ProjectedActivityEvent[]>();
  for (const event of events) {
    const id = groupId(event.localDate, period);
    const existing = groups.get(id) ?? [];
    existing.push(event);
    groups.set(id, existing);
  }
  return [...groups.entries()].map(([id, values]) => ({
    id,
    label: groupLabel(id, period),
    count: values.length,
    eventIds: values.map(value => value.eventId),
  }));
}

function groupId(localDate: string, period: ActivityPeriod): string {
  if (period === 'month') return weekGroupId(localDate);
  if (period === 'year') return localDate.slice(0, 7);
  return localDate;
}

function groupLabel(id: string, period: ActivityPeriod): string {
  if (period === 'year') return id;
  if (period === 'month') return id.replace(':', ' ');
  return id;
}

function weekGroupId(localDate: string): string {
  const date = parseLocalIsoDate(localDate);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = localIsoDate(addLocalDays(date, mondayOffset));
  const sunday = localIsoDate(addLocalDays(parseLocalIsoDate(monday), 6));
  return `${monday}:${sunday}`;
}

function countByType(events: ProjectedActivityEvent[]): ActivityCountBucket[] {
  const counts = new Map<ActivityEventType, number>();
  for (const event of events) {
    counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
  }
  return [...counts.entries()].map(([type, count]) => ({
    id: type,
    label: EVENT_LABELS[type],
    count,
  }));
}

function buildHourlyBuckets(events: ProjectedActivityEvent[]): ActivityCountBucket[] {
  const counts = Array.from({ length: 24 }, () => 0);
  for (const event of events) {
    counts[new Date(event.occurredAt).getHours()] += 1;
  }
  return counts.map((count, hour) => ({
    id: hour.toString().padStart(2, '0'),
    label: `${hour.toString().padStart(2, '0')}:00`,
    count,
  }));
}

function buildHeatmapBuckets(
  events: ProjectedActivityEvent[],
  options: ActivityProjectionOptions,
): ActivityCountBucket[] {
  if (options.period === 'year') return buildYearBuckets(events, options.rangeStart);
  const start = parseLocalIsoDate(options.rangeStart);
  const days = localCivilDayDifference(options.rangeEnd, options.rangeStart) + 1;
  const counts = countByLocalDate(events);
  return Array.from({ length: Math.max(0, days) }, (_, index) => {
    const date = localIsoDate(addLocalDays(start, index));
    return {
      id: date,
      label: date,
      count: counts.get(date) ?? 0,
    };
  });
}

function buildYearBuckets(events: ProjectedActivityEvent[], rangeStart: string): ActivityCountBucket[] {
  const year = parseLocalIsoDate(rangeStart).getFullYear();
  const counts = new Map<string, number>();
  for (const event of events) {
    const month = event.localDate.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + 1);
  }
  return Array.from({ length: 12 }, (_, index) => {
    const id = `${year}-${(index + 1).toString().padStart(2, '0')}`;
    return {
      id,
      label: id,
      count: counts.get(id) ?? 0,
    };
  });
}

function countByLocalDate(events: ProjectedActivityEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) counts.set(event.localDate, (counts.get(event.localDate) ?? 0) + 1);
  return counts;
}

function countFolders(events: ProjectedActivityEvent[]): ActivityCountBucket[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const folder = event.folder || '(root)';
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, count]) => ({ id, label: id, count }));
}

