import { DailyScheduleInput, NormalizedSchedule, NormalizedItem } from './types';
import { localIsoDate } from '../local-date';

export class DailyScheduleEngine {
  static normalize(input: DailyScheduleInput): NormalizedSchedule {
    const { date, today, objects = [], googleEvents = [] } = input;
    const items: NormalizedItem[] = [];

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

    // Determine kind based on what was processed
    const kind = this.determineKind(items, objects, googleEvents);

    return {
      kind,
      count: items.length,
      items
    };
  }

  private static processReminder(obj: Record<string, unknown>, date: string, today: string | undefined, items: NormalizedItem[]): void {
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

  private static processHabit(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processTask(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
    const id = obj.id as string;
    const startDate = obj.start_date as string;
    const endDate = obj.end_date as string;
    const time = obj.time as string;
    const duration = obj.duration as number;

    if (startDate !== date) {
      return;
    }

    if (time) {
      items.push({
        id: `task:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        start: time,
        end: duration ? this.calculateEndTime(time, duration) : this.calculateEndTime(time, 60),
        isTimed: true
      });
    } else {
      items.push({
        id: `task:${id}`,
        sourceId: id,
        occurrenceId: id,
        date,
        isTimed: false
      });
    }
  }

  private static processEvent(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processPomodoro(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processTrackerRecord(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processJournalEntry(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processTimeBlock(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processSystem(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processRoutine(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
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

  private static processRotationZone(obj: Record<string, unknown>, date: string, allObjects: Record<string, unknown>[], items: NormalizedItem[]): void {
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

  private static processPersonContact(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
    const id = obj.id as string;
    const lastContact = obj.last_contact as string;
    const frequencyDays = obj.frequency_days as number;

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

  private static processGoal(obj: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
    const id = obj.id as string;
    const startDate = obj.start_date as string;

    if (startDate === date) {
      items.push({
        id: `goalStart:${id}`,
        sourceId: id,
        date,
        isTimed: false,
        isAllDay: false
      });
    }
  }

  private static processGoogleEvent(event: Record<string, unknown>, date: string, items: NormalizedItem[]): void {
    const id = event.id as string;
    const summary = event.summary as string;
    const start = event.start as string;
    const end = event.end as string;

    const eventDate = start.split('T')[0];
    if (eventDate !== date) {
      return;
    }

    const startTime = start.includes('T') ? start.split('T')[1].substring(0, 5) : '';
    const endTime = end.includes('T') ? end.split('T')[1].substring(0, 5) : '';

    items.push({
      id: `google_calendar:${id}`,
      sourceId: id,
      date,
      start: startTime,
      end: endTime,
      isTimed: true
    });
  }

  private static calculateEndTime(startTime: string, durationMinutes: number): string {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + durationMinutes;
    const endHours = Math.floor(totalMinutes / 60) % 24;
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  }

  private static determineKind(items: NormalizedItem[], objects: Record<string, unknown>[], googleEvents: Record<string, unknown>[]): string {
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
