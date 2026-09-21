import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';
import { localIsoDate } from '../local-date';
import { occurrenceResponseIdForDailyItem } from '../occurrence_actions';

type PresentationField = 'sourceType' | 'sourceLabel' | 'isCompletable' | 'isCompleted' | 'isSkipped' | 'outcome' | 'isPlayable' | 'editable' | 'restrictionMetadata' | 'responseState' | 'origin';
type RawNormalizedItem = Omit<NormalizedItem, PresentationField>;

export class DailyScheduleEngine {
  static normalize(input: DailyScheduleInput): NormalizedSchedule {
    const { date, today, objects = [], googleEvents = [] } = input;
    const items: RawNormalizedItem[] = [];

    // Process regular objects
    for (const obj of objects) {
      const type = obj.type as string;
      const id = obj.id as string;

      // Skip archived and deleted objects globally
      if (obj.archived === true || obj.deleted === true || obj._deleted === true) {
        continue;
      }

      switch (type) {
        case 'reminder':
          this.processReminder(obj, date, today, items);
          break;
        case 'habit':
          this.processHabit(obj, date, items);
          break;
        case 'task':
          this.processTask(obj, date, items);
          break;
        case 'event':
          this.processEvent(obj, date, items);
          break;
        case 'pomodoro':
        case 'pomodoro_session':
          this.processPomodoro(obj, date, items);
          break;
        case 'tracker_record':
          this.processTrackerRecord(obj, date, items);
          break;
        case 'entry':
        case 'journal_entry':
          this.processJournalEntry(obj, date, items);
          break;
        case 'time_block':
          this.processTimeBlock(obj, date, items);
          break;
        case 'system':
          this.processSystem(obj, date, items);
          break;
        case 'routine':
          this.processRoutine(obj, date, items);
          break;
        case 'project':
          this.processRotationZone(obj, date, objects, items);
          break;
        case 'person':
          this.processPersonContact(obj, date, items);
          break;
        case 'goal':
          this.processGoal(obj, date, items);
          break;
      }
    }

    // Process Google Calendar events
    for (const event of googleEvents) {
      this.processGoogleEvent(event, date, items);
    }

    // Enrich the canonical occurrence projection with presentation capabilities.
    // UI surfaces consume these values and must never infer them independently.
    const normalizedItems = this.applyPlanningOverrides(
      this.enrichPresentationContract(items, objects, input.occurrenceResponses ?? {}),
      input.occurrenceOverrides ?? {},
      objects,
      input.occurrenceResponses ?? {},
      date,
    );

    // Determine kind based on what was processed
    const kind = this.determineKind(items, objects, googleEvents);

    return {
      kind,
      count: normalizedItems.length,
      items: normalizedItems
    };
  }

  private static processReminder(obj: Record<string, unknown>, date: string, today: string | undefined, items: RawNormalizedItem[]): void {
    const scheduledDate = obj.scheduled_date as string;
    const time = obj.time as string;
    const reminderId = obj.reminder_id as string;
    const id = obj.id as string;

    // Check if reminder is on the date
    if (scheduledDate !== date) {
      // Check overdue projection for today
      if (today && scheduledDate < today && date === today) {
        // Overdue reminders should show on today
        // Continue processing
      } else {
        return;
      }
    }

    if (time) {
      items.push({
        id: `reminder:${id}`,
        sourceId: id,
        reminderId: reminderId || id,
        date,
        start: time,
        end: this.calculateEndTime(time, 15), // Default 15 min duration
        isTimed: true
      });
    }
  }

  private static processHabit(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const slots = obj.slots as Array<{time: string; label: string}>;

    // Skip negative habits
    if (obj.negative === true) {
      return;
    }

    if (slots && slots.length > 0) {
      // Multiple timed slots
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        items.push({
          id: `legacyTime:habit:${id}:slot:${i}:reminder:slot_time:${date}T${slot.time}:00.000`,
          sourceId: id,
          slotIndex: i,
          date,
          start: slot.time,
          isTimed: true
        });
      }
    } else {
      // All-day fallback
      items.push({
        id: `habit:${id}`,
        sourceId: id,
        date,
        isTimed: false
      });
    }
  }

  private static processTask(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = String(obj.id ?? '');
    const scheduler = obj.scheduler && typeof obj.scheduler === 'object' && !Array.isArray(obj.scheduler)
      ? obj.scheduler as Record<string, unknown>
      : undefined;
    const rawStartDate = String(obj.start_date ?? scheduler?.start_date ?? '');
    const startDate = rawStartDate.includes('T') ? rawStartDate.split('T')[0] ?? '' : rawStartDate;
    const time = String(obj.scheduled_time ?? obj.time ?? '');
    const duration = Number(obj.duration ?? 0);
    const rules = Array.isArray(scheduler?.rules) ? scheduler?.rules : [];
    const seriesId = rules.length > 0 ? id : undefined;

    if (!id || startDate !== date) return;

    if (time) {
      items.push({
        id: `task:${id}`,
        sourceId: id,
        occurrenceId: id,
        seriesId,
        date,
        start: time,
        end: this.calculateEndTime(time, duration > 0 ? duration : 60),
        isTimed: true
      });
    } else {
      items.push({
        id: `task:${id}`,
        sourceId: id,
        occurrenceId: id,
        seriesId,
        date,
        isTimed: false
      });
    }
  }

  private static processEvent(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const eventDate = obj.date as string;
    const timeOfDay = (obj.time_of_day as string) || (obj.time as string);
    const duration = obj.duration as number;

    if (eventDate !== date) {
      return;
    }

    if (timeOfDay) {
      items.push({
        id: `event:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        start: timeOfDay,
        end: duration ? this.calculateEndTime(timeOfDay, duration) : this.calculateEndTime(timeOfDay, 60),
        isTimed: true
      });
    } else {
      // All-day event
      items.push({
        id: `event:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        isTimed: false,
        isAllDay: true
      });
    }
  }

  private static processPomodoro(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const pomodoroDate = obj.date as string;
    const start = obj.start as string;
    const duration = obj.duration as number || obj.work_duration as number || 25;

    if (pomodoroDate !== date) {
      return;
    }

    if (start) {
      items.push({
        id: `pomodoro:${id}`,
        sourceId: id,
        date,
        start,
        end: this.calculateEndTime(start, duration),
        isTimed: true
      });
    }
  }

  private static processTrackerRecord(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const recordDate = obj.date as string;

    if (recordDate !== date) {
      return;
    }

    items.push({
      id: `tracker:${id}`,
      sourceId: id,
      date,
      isTimed: false,
      isAllDay: false
    });
  }

  private static processJournalEntry(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const entryDate = obj.date as string;
    const time = obj.time as string;

    if (entryDate !== date) {
      return;
    }

    if (time) {
      items.push({
        id: `entry:${id}`,
        sourceId: id,
        date,
        start: time,
        end: this.calculateEndTime(time, 15), // Default 15 min duration
        isTimed: true
      });
    } else {
      items.push({
        id: `entry:${id}`,
        sourceId: id,
        date,
        isTimed: false,
        isAllDay: false
      });
    }
  }

  private static processTimeBlock(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const ranges = obj.ranges as Array<{id: string; start: string; end: string}>;

    if (ranges && ranges.length > 0) {
      for (const range of ranges) {
        items.push({
          id: `time_block:${id}:${range.id}@${date}`,
          sourceId: id,
          occurrenceId: `time_block:${id}:${range.id}@${date}`,
          date,
          start: range.start,
          end: range.end,
          isTimed: true
        });
      }
    }
  }

  private static processSystem(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const time = obj.time as string;

    if (time) {
      items.push({
        id: `system:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        start: time,
        isTimed: true
      });
    }
  }

  private static processRoutine(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const startDate = obj.start_date as string;

    if (startDate !== date) {
      return;
    }

    items.push({
      id: `routine:${id}`,
      sourceId: id,
      occurrenceId: `routine:${id}@${date}`,
      date,
      isTimed: false,
      isAllDay: false
    });
  }

  private static processRotationZone(obj: Record<string, unknown>, date: string, allObjects: Record<string, unknown>[], items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const rotationStartDate = obj.rotation_start_date as string;
    const rotationTime = obj.rotation_time as string;
    const rotationDuration = obj.rotation_duration_minutes as number || 60;
    const rotationGroups = obj.rotation_groups as Array<{id: string; name: string; period_days: number; order: number}>;

    if (rotationStartDate !== date) {
      return;
    }

    if (rotationGroups && rotationGroups.length > 0) {
      const group = rotationGroups[0]; // Simplified - take first group
      items.push({
        id: `rotation:${id}:${group.id}`,
        sourceId: id,
        date,
        start: rotationTime,
        end: this.calculateEndTime(rotationTime, rotationDuration),
        isTimed: true
      });
    }
  }

  private static processPersonContact(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = obj.id as string;
    const lastContact = String(obj.last_contact_date ?? obj.last_contact ?? '');
    const frequencyDays = Number(obj.contact_frequency_days ?? obj.frequency_days);

    if (!lastContact || !frequencyDays) {
      return;
    }

    // Calculate next contact date
    const lastContactDate = new Date(lastContact);
    const nextContactDate = new Date(lastContactDate);
    nextContactDate.setDate(nextContactDate.getDate() + frequencyDays);

    const targetDate = localIsoDate(nextContactDate);

    if (targetDate === date) {
      items.push({
        id: `person_contact:${id}`,
        sourceId: id,
        date,
        isTimed: false,
        isAllDay: false
      });
    }
  }

  private static processGoal(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = String(obj.id ?? '');
    const startDate = String(obj.start_date ?? '').split('T')[0] ?? '';
    const deadline = String(obj.deadline ?? '').split('T')[0] ?? '';

    if (startDate === date) {
      items.push({
        id: `goalStart:${id}`,
        sourceId: id,
        date,
        isTimed: false,
        isAllDay: false
      });
    }
    if (deadline === date) {
      items.push({
        id: `goalDeadline:${id}`,
        sourceId: id,
        date,
        isTimed: false,
        isAllDay: false
      });
    }
  }

  private static processGoogleEvent(event: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = String(event.id ?? '');
    const start = typeof event.start === 'string' ? event.start : '';
    const end = typeof event.end === 'string' ? event.end : '';
    if (!id || !start || !end) return;

    const allDay = event.allDay === true || !start.includes('T');
    if (allDay) {
      if (date < start || date >= end) return;
      items.push({
        id: `google_calendar:${id}`,
        sourceId: id,
        date,
        isTimed: false,
        isAllDay: true,
      });
      return;
    }

    const startDate = start.split('T')[0] ?? '';
    const endDate = end.split('T')[0] ?? '';
    const startClock = start.split('T')[1]?.substring(0, 5) ?? '';
    const endClock = end.split('T')[1]?.substring(0, 5) ?? '';
    if (!startDate || !endDate || !startClock || !endClock) return;
    if (date < startDate || date > endDate || (date === endDate && endClock === '00:00' && endDate !== startDate)) return;
    const visibleStartClock = date === startDate ? startClock : '00:00';
    const visibleEndClock = date === endDate ? endClock : '23:59';

    items.push({
      id: `google_calendar:${id}`,
      sourceId: id,
      date,
      start: visibleStartClock,
      end: visibleEndClock,
      isTimed: true,
      isAllDay: false,
    });
  }

  private static enrichPresentationContract(
    items: RawNormalizedItem[],
    objects: Array<Record<string, unknown>>,
    occurrenceResponses: DailyScheduleInput['occurrenceResponses'],
  ): NormalizedItem[] {
    const byId = new Map<string, Record<string, unknown>>();
    for (const object of objects) {
      const id = String(object.id ?? '');
      if (id) byId.set(id, object);
    }

    return items.map(item => {
      const source = byId.get(item.sourceId);
      let sourceType = source == null ? 'google_calendar' : String(source.type ?? '');
      if (item.id.startsWith('goalStart:')) sourceType = 'goalStart';
      if (item.id.startsWith('goalDeadline:')) sourceType = 'goalDeadline';
      const sourcePath = source == null ? '' : String(source.__path ?? '');
      const rotationGroup = item.id.startsWith('rotation:') ? item.id.split(':')[2] ?? '' : '';
      const sourceLabel = source == null
        ? `google_calendar:${item.sourceId}`
        : rotationGroup
          ? `project:${item.sourceId}:rotation:${rotationGroup}`
          : `${sourceType}:${item.sourceId}:${sourcePath}`;

      const completableTypes = new Set([
        'task', 'habit', 'event', 'reminder', 'time_block', 'system',
        'routine', 'project', 'goal', 'person',
      ]);
      const isCompletable = source != null && completableTypes.has(sourceType);
      const occurrenceId = item.occurrenceId ?? item.id;
      const actionOccurrenceId = item.occurrenceId?.includes('@')
        ? item.occurrenceId
        : occurrenceResponseIdForDailyItem(item.id, item.date);
      const responseState = occurrenceResponses?.[actionOccurrenceId]
        ?? occurrenceResponses?.[occurrenceId]
        ?? occurrenceResponses?.[item.id];
      const domainCompleted = source == null ? false : this.isSourceCompleted(sourceType, source);
      const isCompleted = responseState?.completedAt != null || domainCompleted;
      const isSkipped = responseState?.skippedAt != null;
      const outcome = isCompleted ? 'done' as const : isSkipped ? 'skipped' as const : 'pending' as const;
      const restrictionRaw = source?.restriction_metadata ?? source?.restrictionMetadata;
      const restrictionMetadata = restrictionRaw && typeof restrictionRaw === 'object' && !Array.isArray(restrictionRaw)
        ? { ...(restrictionRaw as Record<string, unknown>) }
        : undefined;
      const isPlayable = source?.playable === true;
      const editable = source != null && source.editable !== false;
      const origin = item.id.startsWith('google_calendar:')
        ? 'externalEvent' as const
        : item.id.startsWith('legacyTime:')
          ? 'legacyTime' as const
          : 'schedule' as const;

      return {
        ...item,
        occurrenceId,
        actionOccurrenceId,
        sourceType,
        sourceLabel,
        isCompletable,
        isCompleted,
        isSkipped,
        outcome,
        isPlayable,
        editable,
        restrictionMetadata,
        ...(responseState ? { responseState } : {}),
        origin,
      };
    });
  }

  private static applyPlanningOverrides(
    items: NormalizedItem[],
    overrides: DailyScheduleInput['occurrenceOverrides'],
    objects: Array<Record<string, unknown>>,
    occurrenceResponses: DailyScheduleInput['occurrenceResponses'],
    date: string,
  ): NormalizedItem[] {
    if (!overrides || Object.keys(overrides).length === 0) return items;
    const matched = new Set<string>();
    const projected: NormalizedItem[] = [];

    for (const item of items) {
      const candidates = [item.actionOccurrenceId, item.occurrenceId, item.id].filter(
        (value): value is string => Boolean(value),
      );
      const override = candidates
        .map(key => overrides[key])
        .find(value => value?.scope === 'single' && value.startAtOverride && value.endAtOverride);
      if (!override) {
        projected.push(item);
        continue;
      }
      matched.add(override.occurrenceId);
      const placement = this.overridePlacement(override.startAtOverride!, override.endAtOverride!);
      if (placement.date !== date) continue;
      projected.push({
        ...item,
        date,
        start: placement.start,
        end: placement.end,
        isTimed: true,
        isAllDay: false,
        occurrenceId: override.occurrenceId,
        actionOccurrenceId: override.occurrenceId,
      });
    }

    const objectIds = new Set(objects.map(object => String(object.id ?? '')).filter(Boolean));
    for (const override of Object.values(overrides)) {
      if (
        matched.has(override.occurrenceId) ||
        override.scope !== 'single' ||
        !override.startAtOverride ||
        !override.endAtOverride ||
        !objectIds.has(override.sourceId)
      ) {
        continue;
      }
      const placement = this.overridePlacement(override.startAtOverride, override.endAtOverride);
      if (placement.date !== date) continue;

      const id = override.occurrenceId.replace(/@\d{4}-\d{2}-\d{2}$/, '');
      const enriched = this.enrichPresentationContract([{
        id,
        sourceId: override.sourceId,
        occurrenceId: override.occurrenceId,
        date,
        start: placement.start,
        end: placement.end,
        isTimed: true,
        isAllDay: false,
      }], objects, occurrenceResponses ?? {});
      if (enriched[0]) projected.push(enriched[0]);
    }

    return projected.sort((left, right) => {
      if (left.start == null && right.start == null) return left.id.localeCompare(right.id);
      if (left.start == null) return 1;
      if (right.start == null) return -1;
      return left.start.localeCompare(right.start) || left.id.localeCompare(right.id);
    });
  }

  private static overridePlacement(startIso: string, endIso: string): { date: string; start: string; end: string } {
    const startMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(startIso);
    const endMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(endIso);
    if (!startMatch || !endMatch) {
      throw new Error('Shared planning override has an invalid time range.');
    }
    return {
      date: startMatch[1],
      start: startMatch[2],
      end: endMatch[2],
    };
  }

  private static isSourceCompleted(sourceType: string, source: Record<string, unknown>): boolean {
    if (source.is_completed === true || source.completed === true) return true;
    switch (sourceType) {
      case 'task':
        return source.stage === 'done' || source.stage === 'completed' || source.stage === 'finalized';
      case 'event':
      case 'pomodoro':
      case 'pomodoro_session':
        return source.state === 'completed';
      default:
        // Completion for Habits, Routines, Time Blocks and other occurrence-keyed
        // sources is owned by shared occurrence state. Until that state is part
        // of this input, never guess completion from presentation code.
        return false;
    }
  }

  private static calculateEndTime(startTime: string, durationMinutes: number): string {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + durationMinutes;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  }

  private static determineKind(items: RawNormalizedItem[], objects: Record<string, unknown>[], googleEvents: Record<string, unknown>[]): string {
    if (items.length === 0) {
      // Determine kind from input objects even if no items matched
      if (objects.length > 0) {
        const types = new Set(objects.map(obj => obj.type as string));
        if (types.size === 1) {
          const type = Array.from(types)[0];
          const kindMap: Record<string, string> = {
            'reminder': 'reminder',
            'habit': 'habit',
            'task': 'task',
            'event': 'event',
            'pomodoro': 'pomodoro',
            'pomodoro_session': 'pomodoro',
            'tracker_record': 'trackerRecord',
            'entry': 'journalEntry',
            'journal_entry': 'journalEntry',
            'time_block': 'timeBlock',
            'system': 'system',
            'routine': 'routine',
            'project': 'rotationZone',
            'person': 'personContact',
            'goal': 'goal'
          };
          return kindMap[type] || 'empty';
        }
      }
      if (googleEvents.length > 0) {
        return 'googleCalendar';
      }
      return 'empty';
    }
    
    // Check if all items are of the same kind
    const kinds = new Set(items.map(item => {
      const parts = item.id.split(':');
      // Handle legacyTime prefix for habit slots
      if (parts[0] === 'legacyTime' && parts[1] === 'habit') {
        return 'habit';
      }
      return parts[0];
    }));
    
    if (kinds.size === 1) {
      const kind = Array.from(kinds)[0];
      // Map to expected kind names
      const kindMap: Record<string, string> = {
        'reminder': 'reminder',
        'habit': 'habit',
        'task': 'task',
        'event': 'event',
        'pomodoro': 'pomodoro',
        'tracker': 'trackerRecord',
        'entry': 'journalEntry',
        'time_block': 'timeBlock',
        'system': 'system',
        'routine': 'routine',
        'rotation': 'rotationZone',
        'person_contact': 'personContact',
        'goalStart': 'goal',
        'google_calendar': 'googleCalendar'
      };
      return kindMap[kind] || kind;
    }
    
    return 'mixed';
  }
}
