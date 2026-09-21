import type { OccurrenceResponseState, OccurrenceOutcome } from '../occurrence_actions';
import type { OccurrenceTimeOverride } from '../occurrence_reschedule';

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
  isSkipped: boolean;
  outcome: OccurrenceOutcome;
  isPlayable: boolean;
  editable: boolean;
  seriesId?: string;
  restrictionMetadata?: Record<string, unknown>;
  responseState?: OccurrenceResponseState;
  origin: DailyScheduleOrigin;
  slotIndex?: number;
  reminderId?: string;
  occurrenceId?: string;
  actionOccurrenceId?: string;
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
  occurrenceResponses?: Record<string, OccurrenceResponseState>;
  occurrenceOverrides?: Record<string, OccurrenceTimeOverride>;
}
