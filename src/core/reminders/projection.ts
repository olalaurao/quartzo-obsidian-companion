import { addLocalDays, localIsoDate, parseLocalIsoDate } from '../local-date';
import { DailyScheduleEngine } from '../daily_schedule';
import { SchedulerEngine, type SchedulerDefinition } from '../scheduler';
import type {
  ReminderConfigData,
  ReminderDeliveryOccurrence,
  ReminderNotificationType,
  ReminderSourceObject,
} from './types';

const VALID_NOTIFICATION_TYPES = new Set<ReminderNotificationType>(['push', 'popup', 'alarm']);
const CLOCK_RE = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function dateAtClock(date: string, clock: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !CLOCK_RE.test(clock)) return null;
  const [hour, minute, second = '0'] = clock.split(':');
  const parsed = parseLocalIsoDate(date);
  parsed.setHours(Number(hour), Number(minute), Number(second), 0);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parsePersistedInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inWindow(value: Date, fromExclusive: Date, toInclusive: Date): boolean {
  return value.getTime() > fromExclusive.getTime() && value.getTime() <= toInclusive.getTime();
}

function notificationType(value: unknown): ReminderNotificationType | null {
  const normalized = typeof value === 'string' && value.trim() ? value.trim() : 'push';
  if (normalized === 'relative') return 'push';
  return VALID_NOTIFICATION_TYPES.has(normalized as ReminderNotificationType)
    ? normalized as ReminderNotificationType
    : null;
}

function validNonNegativeInt(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
  return value;
}

function rawReminderConfigs(object: ReminderSourceObject): ReminderConfigData[] {
  if (Array.isArray(object.reminders)) {
    return object.reminders.filter((value): value is ReminderConfigData =>
      value != null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).id === 'string' &&
      String((value as Record<string, unknown>).id).trim().length > 0
    );
  }

  if (object.type !== 'reminder') return [];
  const id = String(object.reminder_id ?? `${object.id}_primary`).trim();
  const rawDate = typeof object.date === 'string' ? object.date : '';
  const rawTime = typeof object.time === 'string' ? object.time : '';
  const direct = parsePersistedInstant(rawDate) ?? parsePersistedInstant(rawTime);
  const dateOnly = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate;
  const timeOnly = rawTime.includes('T') ? rawTime.split('T')[1]?.substring(0, 8) ?? '' : rawTime;
  const combined = direct ?? (dateOnly && timeOnly ? dateAtClock(dateOnly, timeOnly) : null);
  if (!combined) return [];
  return [{
    id,
    trigger_time: localDateTimeText(combined),
    type: 'popup',
    notification_body: typeof object.title === 'string' ? object.title : undefined,
  }];
}

function localDateTimeText(value: Date): string {
  const date = localIsoDate(value);
  const hh = String(value.getHours()).padStart(2, '0');
  const mm = String(value.getMinutes()).padStart(2, '0');
  const ss = String(value.getSeconds()).padStart(2, '0');
  const ms = String(value.getMilliseconds()).padStart(3, '0');
  return `${date}T${hh}:${mm}:${ss}.${ms}`;
}

interface BaseOccurrence {
  occurrenceId: string;
  dueAt: Date;
}

function schedulerOccurrenceForDate(object: ReminderSourceObject, date: string): BaseOccurrence[] {
  const rawScheduler = object.scheduler;
  if (!rawScheduler || typeof rawScheduler !== 'object' || Array.isArray(rawScheduler)) return [];
  const scheduler = rawScheduler as SchedulerDefinition;
  if (typeof scheduler.start_date !== 'string' || !Array.isArray(scheduler.rules) || scheduler.rules.length === 0) return [];

  try {
    const after = addLocalDays(parseLocalIsoDate(date), -1);
    const result = SchedulerEngine.evaluate(
      scheduler,
      `${localIsoDate(after)}T00:00:00.000`,
      date,
    );
    if (!result.shouldFire || !result.next) return [];
    const dueAt = parsePersistedInstant(result.next);
    if (!dueAt || localIsoDate(dueAt) !== date) return [];
    return [{ occurrenceId: `schedule:${object.id}@${localDateTimeText(dueAt)}`, dueAt }];
  } catch {
    return [];
  }
}

function dailyOccurrencesForDate(object: ReminderSourceObject, date: string): BaseOccurrence[] {
  if (object.type === 'reminder') return [];
  const schedule = DailyScheduleEngine.normalize({
    date,
    objects: [object],
  });
  const occurrences: BaseOccurrence[] = [];
  for (const item of schedule.items) {
    if (item.sourceId !== object.id || !item.start) continue;
    const dueAt = dateAtClock(date, item.start);
    if (!dueAt) continue;
    occurrences.push({
      occurrenceId: item.occurrenceId ?? item.id,
      dueAt,
    });
  }
  return occurrences;
}

function baseOccurrencesForDate(object: ReminderSourceObject, date: string): BaseOccurrence[] {
  const combined = [...dailyOccurrencesForDate(object, date), ...schedulerOccurrenceForDate(object, date)];
  const unique = new Map<string, BaseOccurrence>();
  for (const occurrence of combined) {
    unique.set(`${occurrence.occurrenceId}:${occurrence.dueAt.getTime()}`, occurrence);
  }
  return [...unique.values()];
}

function candidateDatesForShiftedWindow(from: Date, to: Date, shiftMs: number): string[] {
  const start = new Date(from.getTime() + shiftMs);
  const end = new Date(to.getTime() + shiftMs);
  const dates = new Set<string>([localIsoDate(start), localIsoDate(end)]);
  return [...dates];
}

function makeDelivery(
  object: ReminderSourceObject,
  config: ReminderConfigData,
  occurrenceId: string,
  triggerAt: Date,
  type: ReminderNotificationType,
): ReminderDeliveryOccurrence {
  const reminderId = config.id;
  const triggerKey = localDateTimeText(triggerAt);
  return {
    key: `${object.id}:${occurrenceId}:${reminderId}:${triggerKey}`,
    sourceId: object.id,
    sourceType: object.type,
    sourceTitle: typeof object.title === 'string' && object.title.trim() ? object.title : object.type,
    occurrenceId,
    reminderId,
    triggerAt,
    notificationType: type,
    notificationBody: typeof config.notification_body === 'string' ? config.notification_body : undefined,
    escalationLevel: validNonNegativeInt(config.escalation_level) ?? 0,
  };
}

export class ReminderProjectionEngine {
  static projectWindow(
    objects: ReminderSourceObject[],
    fromExclusive: Date,
    toInclusive: Date,
  ): ReminderDeliveryOccurrence[] {
    if (Number.isNaN(fromExclusive.getTime()) || Number.isNaN(toInclusive.getTime()) || toInclusive <= fromExclusive) {
      return [];
    }

    const deliveries: ReminderDeliveryOccurrence[] = [];
    for (const object of objects) {
      if (!object.id || object.archived === true || object.deleted === true || object._deleted === true) continue;
      if (object.type === 'reminder' && object.is_completed === true) continue;

      for (const config of rawReminderConfigs(object)) {
        const type = notificationType(config.type);
        if (!type) continue;

        const explicitTrigger = parsePersistedInstant(config.trigger_time);
        if (explicitTrigger) {
          if (inWindow(explicitTrigger, fromExclusive, toInclusive)) {
            deliveries.push(makeDelivery(
              object,
              config,
              `reminder:${object.id}:${config.id}`,
              explicitTrigger,
              type,
            ));
          }
          continue;
        }

        const minutesBefore = validNonNegativeInt(config.minutes_before);
        const daysBefore = validNonNegativeInt(config.days_before);
        if (config.minutes_before != null && minutesBefore == null) continue;
        if (config.days_before != null && daysBefore == null) continue;
        if (config.time_of_day != null && (typeof config.time_of_day !== 'string' || !CLOCK_RE.test(config.time_of_day))) continue;

        if (daysBefore != null || config.time_of_day != null) {
          const days = daysBefore ?? 0;
          const shiftedDates = candidateDatesForShiftedWindow(fromExclusive, toInclusive, days * 24 * 60 * 60 * 1000);
          for (const date of shiftedDates) {
            for (const occurrence of baseOccurrencesForDate(object, date)) {
              const triggerDate = addLocalDays(parseLocalIsoDate(localIsoDate(occurrence.dueAt)), -days);
              const clock = typeof config.time_of_day === 'string' ? config.time_of_day : '09:00';
              const triggerAt = dateAtClock(localIsoDate(triggerDate), clock);
              if (triggerAt && inWindow(triggerAt, fromExclusive, toInclusive)) {
                deliveries.push(makeDelivery(object, config, occurrence.occurrenceId, triggerAt, type));
              }
            }
          }
          continue;
        }

        const offsetMs = (minutesBefore ?? 0) * 60 * 1000;
        const dates = candidateDatesForShiftedWindow(fromExclusive, toInclusive, offsetMs);
        for (const date of dates) {
          for (const occurrence of baseOccurrencesForDate(object, date)) {
            const triggerAt = new Date(occurrence.dueAt.getTime() - offsetMs);
            if (inWindow(triggerAt, fromExclusive, toInclusive)) {
              deliveries.push(makeDelivery(object, config, occurrence.occurrenceId, triggerAt, type));
            }
          }
        }
      }
    }

    const unique = new Map<string, ReminderDeliveryOccurrence>();
    for (const delivery of deliveries) unique.set(delivery.key, delivery);
    return [...unique.values()].sort((a, b) =>
      a.triggerAt.getTime() - b.triggerAt.getTime() ||
      a.key.localeCompare(b.key)
    );
  }
}
