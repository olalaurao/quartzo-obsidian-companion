export type OccurrenceOverrideScope = 'single' | 'series' | 'thisAndFuture';

export interface OccurrenceTimeOverride {
  occurrenceId: string;
  sourceId: string;
  scope: OccurrenceOverrideScope;
  startAtOverride?: string;
  endAtOverride?: string;
  updatedAt: string;
  unknownFields?: Record<string, unknown>;
}

export interface OccurrenceRescheduleTarget {
  occurrenceId: string;
  sourceId: string;
  sourceType: string;
  editable: boolean;
  seriesId?: string;
  outcome: 'pending' | 'done' | 'skipped';
  isCompletable: boolean;
  isPlayable: boolean;
  reminderId?: string;
  restrictionMetadata?: Record<string, unknown>;
}

export type OccurrenceReschedulePlan =
  | {
      storage: 'source_task';
      patch: {
        set: {
          start_date: string;
          scheduled_time: string;
          duration: number;
        };
      };
    }
  | {
      storage: 'shared_planning_override';
      override: OccurrenceTimeOverride;
    };
