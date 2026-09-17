export type ReminderNotificationType = 'push' | 'popup' | 'alarm';

export interface ReminderConfigData {
  id: string;
  trigger_time?: string;
  minutes_before?: number;
  days_before?: number;
  time_of_day?: string;
  type?: ReminderNotificationType | string;
  notification_body?: string;
  sound?: string;
  ring_on_silent?: boolean;
  snooze_minutes?: number;
  popup_color?: string | number;
  play_sound?: boolean;
  vibrate?: boolean;
  is_auto_generated?: boolean;
  ignored_count?: number;
  escalation_level?: number;
  last_ignored_occurrence_key?: string;
  interaction?: string;
  interaction_target?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ReminderSourceObject extends Record<string, unknown> {
  id: string;
  type: string;
  title?: string;
  __path?: string;
  archived?: boolean;
  reminders?: ReminderConfigData[];
}

export interface ReminderDeliveryOccurrence {
  key: string;
  sourceId: string;
  sourceType: string;
  sourceTitle: string;
  occurrenceId: string;
  reminderId: string;
  triggerAt: Date;
  notificationType: ReminderNotificationType;
  notificationBody?: string;
  escalationLevel: number;
}
