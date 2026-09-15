export type RepeatType = 
  | 'number_of_days'
  | 'days_of_week'
  | 'number_of_weeks'
  | 'number_of_months'
  | 'number_of_minutes'
  | 'number_of_hours'
  | 'days_after_last_start'
  | 'days_after_last_end'
  | 'days_per_period'
  | 'linked_item_appears'
  | 'n_days_after_linked_item'
  | 'first_business_day_of_month'
  | 'days_after_reference_field'
  | 'days_of_theme'
  | 'days_with_block';

export interface SchedulerRule {
  repeat_type: RepeatType;
  interval?: number;
  days_of_week?: string[];
  days_of_month?: number[];
  period?: string;
  count_per_period?: number;
  starting_day_offset?: number;
  interval_between_days?: number;
  linked_item_id?: string;
  monthly_rule?: string;
  monthly_ordinal?: number;
  monthly_weekday?: string;
  target_type?: string;
  field_name?: string;
  theme_id?: string;
  block_id?: string;
}

export interface SchedulerActiveWindow {
  start_minute: number;
  end_minute: number;
}

export interface SchedulerDefinition {
  start_date: string;
  end_date?: string;
  rules: SchedulerRule[];
  exclusions?: SchedulerRule[];
  max_occurrences?: number;
  anchor_mode?: string;
  active_window?: SchedulerActiveWindow;
}

export interface SchedulerContext {
  lastCompletionDate?: string;
  lastStartDate?: string;
  lastEndDate?: string;
  scheduledItems?: Record<string, string[]>;
  referenceFields?: Record<string, string>;
  themes?: Record<string, string[]>;
  blocks?: Record<string, string[]>;
}

export interface SchedulerResult {
  next: string | null;
  shouldFire: boolean;
}

export class SchedulerEngine {
  static evaluate(
    scheduler: SchedulerDefinition,
    after: string,
    date: string,
    context?: SchedulerContext
  ): SchedulerResult {
    // This is a stub implementation to pass the compilation.
    // Real implementation requires complex date math following the upstream dart contracts.
    
    // For now, we return a simple mock based on start_date matching date to unblock.
    if (scheduler.start_date.startsWith(date)) {
      return { next: scheduler.start_date, shouldFire: true };
    }
    
    return { next: null, shouldFire: false };
  }
}
