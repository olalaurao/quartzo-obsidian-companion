import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';
import { addLocalDays, localIsoDate, parseLocalIsoDate } from '../local-date';
import { SchedulerEngine, type SchedulerDefinition } from '../scheduler';
import { occurrenceResponseIdForDailyItem } from '../occurrence_actions';
import { isScheduledSystemOccurrenceCompleted } from '../manual-execution';

type PresentationField = 'sourceType' | 'sourceLabel' | 'isCompletable' | 'isCompleted' | 'isSkipped' | 'outcome' | 'isPlayable' | 'editable' | 'restrictionMetadata' | 'responseState' | 'origin';
type RawNormalizedItem = Omit<NormalizedItem, PresentationField>;

export class DailyScheduleEngine {
  static normalize(input: DailyScheduleInput): NormalizedSchedule {
    const { date, objects = [], googleEvents = [] } = input;
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
          this.processReminder(obj, date, items);
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

  private static processReminder(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const scheduledDate = obj.scheduled_date as string;
    const time = obj.time as string;
    const reminderId = obj.reminder_id as string;
    const id = obj.id as string;

    if (scheduledDate !== date) {
      return;
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
    if (!id) return;

    const scheduler = this.schedulerDefinition(obj.scheduler);
    const rawStartDate = String(obj.start_date ?? scheduler?.start_date ?? obj.end_date ?? '');
    const fallbackDate = this.dateOnly(rawStartDate);
    const time = String(
      obj.scheduled_time ??
      obj.time ??
      this.clockFromIso(scheduler?.exact_time) ??
      ''
    );
    const duration = Math.max(1, Number(obj.duration ?? 0) || 60);
    const seriesId = scheduler?.rules?.length ? id : undefined;

    if (!time) {
      if (!this.sourceOccursOnDate(scheduler, date, fallbackDate)) return;
      items.push({
        id: `task:${id}`,
        sourceId: id,
        occurrenceId: id,
        seriesId,
        date,
        isTimed: false
      });
      return;
    }

    for (const anchorDate of this.relevantAnchorDates(date, duration)) {
      if (!this.sourceOccursOnDate(scheduler, anchorDate, fallbackDate)) continue;
      const segment = this.projectIntervalSegment(anchorDate, date, time, duration);
      if (!segment) continue;
      items.push({
        id: `task:${id}`,
        sourceId: id,
        occurrenceId: id,
        seriesId,
        date,
        start: segment.start,
        end: segment.end,
        isTimed: true,
        isAllDay: false
      });
    }
  }

  private static processEvent(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = String(obj.id ?? '');
    if (!id) return;

    const scheduler = this.schedulerDefinition(obj.scheduler);
    const fallbackDate = this.dateOnly(String(obj.date ?? scheduler?.start_date ?? ''));
    const timeOfDay = String(
      obj.time_of_day ??
      obj.time ??
      this.clockFromIso(scheduler?.exact_time) ??
      ''
    );
    const duration = this.eventDurationMinutes(obj, timeOfDay);

    if (!timeOfDay) {
      if (!this.sourceOccursOnDate(scheduler, date, fallbackDate)) return;
      items.push({
        id: `event:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        isTimed: false,
        isAllDay: true
      });
      return;
    }

    for (const anchorDate of this.relevantAnchorDates(date, duration)) {
      if (!this.sourceOccursOnDate(scheduler, anchorDate, fallbackDate)) continue;
      const segment = this.projectIntervalSegment(anchorDate, date, timeOfDay, duration);
      if (!segment) continue;
      items.push({
        id: `event:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        start: segment.start,
        end: segment.end,
        isTimed: true,
        isAllDay: false
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
    const id = String(obj.id ?? '');
    if (!id) return;
    const scheduler = this.schedulerDefinition(obj.scheduler);
    const ranges = this.timeBlockRanges(obj);
    for (const range of ranges) {
      const duration = this.rangeDurationMinutes(range.start, range.end);
      for (const anchorDate of this.relevantAnchorDates(date, duration)) {
        if (!this.sourceOccursOnDate(scheduler, anchorDate, null, true)) continue;
        const segment = this.projectIntervalSegment(anchorDate, date, range.start, duration);
        if (!segment) continue;
        const occurrenceId = `time_block:${id}:${range.id}@${anchorDate}`;
        items.push({
          id: occurrenceId,
          sourceId: id,
          occurrenceId,
          date,
          start: segment.start,
          end: segment.end,
          isTimed: true,
          isAllDay: false,
        });
      }
    }
  }

  private static processSystem(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = String(obj.id ?? '');
    if (!id) return;
    const scheduler = this.schedulerDefinition(obj.scheduler);
    const fallbackDate = scheduler ? this.dateOnly(scheduler.start_date) : null;
    if (!this.sourceOccursOnDate(scheduler, date, fallbackDate, scheduler == null)) return;

    const time = String(
      obj.scheduled_time ??
      obj.time ??
      this.clockFromIso(scheduler?.exact_time) ??
      ''
    );
    if (!time) return;

    items.push({
      id: `system:${id}`,
      sourceId: id,
      occurrenceId: `system:${id}@${date}`,
      date,
      start: time,
      isTimed: true
    });
  }

  private static processRoutine(obj: Record<string, unknown>, date: string, items: RawNormalizedItem[]): void {
    const id = String(obj.id ?? '');
    if (!id || obj.show_in_planner === false) return;

    const scheduler = this.schedulerDefinition(obj.scheduler);
    const fallbackDate = this.dateOnly(String(obj.start_date ?? scheduler?.start_date ?? ''));
    if (!this.sourceOccursOnDate(scheduler, date, fallbackDate)) return;

    const time = String(
      obj.scheduled_time ??
      obj.time ??
      this.clockFromIso(scheduler?.exact_time) ??
      ''
    );
    const duration = Math.max(0, Number(obj.estimated_minutes ?? 0));
    const occurrenceId = `routine:${id}@${date}`;

    if (time) {
      items.push({
        id: `routine:${id}`,
        sourceId: id,
        occurrenceId,
        date,
        start: time,
        ...(duration > 0 ? { end: this.calculateEndTimeWithinDay(time, duration) } : {}),
        isTimed: true,
        isAllDay: false
      });
      return;
    }

    items.push({
      id: `routine:${id}`,
      sourceId: id,
      occurrenceId,
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
    const lastContactDate = parseLocalIsoDate(lastContact.slice(0, 10));
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
      const systemExecutionCompleted =
        sourceType === 'system' && source != null
          ? isScheduledSystemOccurrenceCompleted(source, occurrenceId)
          : false;
      const domainCompleted =
        source == null || sourceType === 'system'
          ? false
          : this.isSourceCompleted(sourceType, source);
      const responseCompleted =
        sourceType === 'system' ? false : responseState?.completedAt != null;
      const isCompleted =
        sourceType === 'system'
          ? systemExecutionCompleted
          : responseCompleted || domainCompleted;
      const isSkipped = responseState?.skippedAt != null;
      const outcome = isCompleted ? 'done' as const : isSkipped ? 'skipped' as const : 'pending' as const;
      const restrictionRaw = source?.restriction_metadata ?? source?.restrictionMetadata;
      const restrictionMetadata = restrictionRaw && typeof restrictionRaw === 'object' && !Array.isArray(restrictionRaw)
        ? { ...(restrictionRaw as Record<string, unknown>) }
        : undefined;
      const isPlayable = source?.playable === true || sourceType === 'system' || sourceType === 'routine';
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

  private static schedulerDefinition(value: unknown): SchedulerDefinition | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;
    const start = String(raw.start_date ?? '');
    const rules = Array.isArray(raw.rules) ? raw.rules : [];
    if (!start || !rules.every(rule =>
      rule != null &&
      typeof rule === 'object' &&
      !Array.isArray(rule) &&
      typeof (rule as Record<string, unknown>).repeat_type === 'string'
    )) {
      return null;
    }
    return {
      start_date: start,
      ...(typeof raw.end_date === 'string' ? { end_date: raw.end_date } : {}),
      rules: rules.map(rule => ({ ...(rule as Record<string, unknown>) })) as SchedulerDefinition['rules'],
      exclusions: Array.isArray(raw.exclusions)
        ? raw.exclusions
            .filter(rule => rule != null && typeof rule === 'object' && !Array.isArray(rule))
            .map(rule => ({ ...(rule as Record<string, unknown>) })) as SchedulerDefinition['exclusions']
        : [],
      ...(Number.isInteger(raw.max_occurrences) ? { max_occurrences: Number(raw.max_occurrences) } : {}),
      ...(typeof raw.anchor_mode === 'string' ? { anchor_mode: raw.anchor_mode } : {}),
      ...(raw.active_window && typeof raw.active_window === 'object' && !Array.isArray(raw.active_window)
        ? { active_window: { ...(raw.active_window as Record<string, unknown>) } as SchedulerDefinition['active_window'] }
        : {}),
      ...(typeof raw.exact_time === 'string' ? { exact_time: raw.exact_time } : {}),
      ...(typeof raw.time_block === 'string' ? { time_block: raw.time_block } : {}),
      ...(typeof raw.time_block_range_id === 'string' ? { time_block_range_id: raw.time_block_range_id } : {}),
    };
  }

  private static sourceOccursOnDate(
    scheduler: SchedulerDefinition | null,
    date: string,
    fallbackDate: string | null,
    defaultWhenUnscheduled = false,
  ): boolean {
    if (scheduler) return SchedulerEngine.occursOnDate(scheduler, date);
    if (fallbackDate) return fallbackDate === date;
    return defaultWhenUnscheduled;
  }

  private static timeBlockRanges(obj: Record<string, unknown>): Array<{ id: string; start: string; end: string }> {
    const canonical = Array.isArray(obj.time_ranges) ? obj.time_ranges : [];
    const parsedCanonical = canonical.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const range = raw as Record<string, unknown>;
      const sh = Number(range.start_hour);
      const sm = Number(range.start_minute);
      const eh = Number(range.end_hour);
      const em = Number(range.end_minute);
      if (![sh, sm, eh, em].every(Number.isInteger)) return [];
      if (sh < 0 || sh > 23 || eh < 0 || eh > 23 || sm < 0 || sm > 59 || em < 0 || em > 59) return [];
      return [{
        id: String(range.id ?? `range-${index}`),
        start: this.formatClock(sh * 60 + sm),
        end: this.formatClock(eh * 60 + em),
      }];
    });
    if (parsedCanonical.length > 0) return parsedCanonical;

    const legacy = Array.isArray(obj.ranges) ? obj.ranges : [];
    return legacy.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const range = raw as Record<string, unknown>;
      const start = typeof range.start === 'string' ? range.start : '';
      const end = typeof range.end === 'string' ? range.end : '';
      if (this.clockMinutes(start) == null || this.clockMinutes(end) == null) return [];
      return [{ id: String(range.id ?? `range-${index}`), start, end }];
    });
  }

  private static eventDurationMinutes(obj: Record<string, unknown>, start: string): number {
    const explicit = Number(obj.duration ?? 0);
    if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
    const end = typeof obj.end_time === 'string' ? obj.end_time : '';
    const startMinute = this.clockMinutes(start);
    const endMinute = this.clockMinutes(end);
    if (startMinute == null || endMinute == null) return 60;
    const duration = endMinute > startMinute
      ? endMinute - startMinute
      : (24 * 60 - startMinute) + endMinute;
    return Math.max(1, duration);
  }

  private static rangeDurationMinutes(start: string, end: string): number {
    const startMinute = this.clockMinutes(start);
    const endMinute = this.clockMinutes(end);
    if (startMinute == null || endMinute == null) return 0;
    return endMinute > startMinute
      ? endMinute - startMinute
      : (24 * 60 - startMinute) + endMinute;
  }

  private static relevantAnchorDates(selectedDate: string, durationMinutes: number): string[] {
    const daysBack = Math.max(0, Math.ceil(Math.max(1, durationMinutes) / (24 * 60)) - 1);
    const selected = parseLocalIsoDate(selectedDate);
    const dates: string[] = [];
    for (let offset = daysBack; offset >= 0; offset--) {
      dates.push(localIsoDate(addLocalDays(selected, -offset)));
    }
    return dates;
  }

  private static projectIntervalSegment(
    anchorDate: string,
    selectedDate: string,
    startClock: string,
    durationMinutes: number,
  ): { start: string; end: string } | null {
    const startMinute = this.clockMinutes(startClock);
    if (startMinute == null || durationMinutes <= 0) return null;
    const dayOffset = this.civilDayNumber(selectedDate) - this.civilDayNumber(anchorDate);
    if (!Number.isFinite(dayOffset) || dayOffset < 0) return null;
    const selectedStart = dayOffset * 24 * 60;
    const selectedEnd = selectedStart + 24 * 60;
    const occurrenceStart = startMinute;
    const occurrenceEnd = occurrenceStart + durationMinutes;
    const visibleStart = Math.max(selectedStart, occurrenceStart);
    const visibleEnd = Math.min(selectedEnd, occurrenceEnd);
    if (visibleEnd <= visibleStart) return null;
    return {
      start: this.formatClock(visibleStart - selectedStart),
      end: this.formatClock(visibleEnd - selectedStart, true),
    };
  }

  private static clockMinutes(value: string): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return hour * 60 + minute;
  }

  private static formatClock(minutes: number, allowDayEnd = false): string {
    if (allowDayEnd && minutes === 24 * 60) return '24:00';
    const bounded = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutes)));
    return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
  }

  private static calculateEndTimeWithinDay(startTime: string, durationMinutes: number): string {
    const start = this.clockMinutes(startTime);
    if (start == null) return startTime;
    return this.formatClock(Math.min(24 * 60, start + durationMinutes), true);
  }

  private static clockFromIso(value: string | undefined): string | null {
    if (!value) return null;
    const match = /T(\d{2}:\d{2})/.exec(value);
    return match?.[1] ?? null;
  }

  private static dateOnly(value: string): string | null {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    return match?.[1] ?? null;
  }

  private static civilDayNumber(value: string): number {
    const [year, month, day] = value.split('-').map(Number);
    if (![year, month, day].every(Number.isFinite)) return Number.NaN;
    return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
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
