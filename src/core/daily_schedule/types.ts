export type DailyScheduleOrigin = 'schedule' | 'reminder' | 'legacyTime' | 'externalEvent';

export interface NormalizedItem {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  date: string;
  start?: string;
  end?: string;
  isTimed: boolean;
  isAllDay?: boolean;
  isCompletable: boolean;
  isCompleted: boolean;
  origin: DailyScheduleOrigin;
  slotIndex?: number;
  reminderId?: string;
  occurrenceId?: string;
}

export interface NormalizedSchedule {
  kind: string;
  count: number;
  items: NormalizedItem[];
}

export interface DailyScheduleInput {
  date: string;
  today?: string;
  objects?: Array<Record<string, unknown>>;
  googleEvents?: Array<Record<string, unknown>>;
}
