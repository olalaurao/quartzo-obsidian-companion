export type ObjectType = 
  | 'task'
  | 'habit'
  | 'tracker_definition'
  | 'tracker_record'
  | 'entry'
  | 'note'
  | 'reminder'
  | 'goal'
  | 'event'
  | 'pomodoro_session'
  | 'system'
  | 'routine'
  | 'social_post'
  | 'mood_definition'
  | 'idea'
  | 'inbox'
  | 'shopping_list'
  | 'template'
  | 'daily_note'
  | 'combined_analysis'
  | 'wellbeing_indicator'
  | 'resource'
  | 'area'
  | 'project'
  | 'activity'
  | 'label'
  | 'person'
  | 'day_theme'
  | 'time_block'
  | 'value'
  | 'pillar'
  | 'action'
  | 'monthly_focus'
  | 'quote';

export interface BaseObject {
  id: string;
  type: ObjectType;
  title: string;
  body?: string;
  [key: string]: unknown; // Preserve unknown fields
}

export interface Task extends BaseObject {
  type: 'task';
  archived?: boolean;
  organizers?: Array<{type: string; slug: string; title: string}>;
  scheduler?: {
    start_date: string;
    rules: Array<{repeat_type: string; interval?: number}>;
  };
  reminders?: Array<{id: string; minutes_before: number; type: string}>;
}

export interface Habit extends BaseObject {
  type: 'habit';
  color?: string;
  status?: string;
  slots?: Array<{time: string; label: string}>;
  negative?: boolean;
}

export interface TrackerDefinition extends BaseObject {
  type: 'tracker_definition';
  sections?: Array<{title: string; input_fields: unknown[]}>;
  section_count?: number;
  field_count?: number;
}

export interface TrackingRecord extends BaseObject {
  type: 'tracker_record';
  tracker_id: string;
  date: string;
  field_values: Record<string, unknown>;
}

export interface Entry extends BaseObject {
  type: 'entry';
  date: string;
  time?: string;
}

export interface Note extends BaseObject {
  type: 'note';
  note_subtype?: string;
  links?: string[];
}

export interface Reminder extends BaseObject {
  type: 'reminder';
  date: string;
  time: string;
  is_completed?: boolean;
  reminder_count?: number;
  reminder_id?: string;
}

export interface Goal extends BaseObject {
  type: 'goal';
  state?: string;
  start_date?: string;
  deadline?: string;
  description?: string;
}

export interface Event extends BaseObject {
  type: 'event';
  date: string;
  time_of_day?: string;
  duration?: number;
}

export interface PomodoroSession extends BaseObject {
  type: 'pomodoro_session';
  date: string;
  work_duration?: number;
  start?: string;
  duration?: number;
  state?: string;
}

export interface System extends BaseObject {
  type: 'system';
  time?: string;
  scheduler?: {
    start_date: string;
    rules: Array<{repeat_type: string; interval?: number}>;
  };
}

export interface Routine extends BaseObject {
  type: 'routine';
  organizer_type: 'routine';
  statement?: string;
  start_date?: string;
  estimated_minutes?: number;
}

export interface SocialPost extends BaseObject {
  type: 'social_post';
  platform?: string;
  personal_note?: string;
}

export interface MoodDefinition extends BaseObject {
  type: 'mood_definition';
  numeric_value?: number;
  pleasantness?: number;
}

export interface Idea extends BaseObject {
  type: 'idea';
  horizon?: string;
}

export interface Inbox extends BaseObject {
  type: 'inbox';
  temporal_intent?: string;
}

export interface ShoppingList extends BaseObject {
  type: 'shopping_list';
  items?: unknown[];
  item_count?: number;
}

export interface Template extends BaseObject {
  type: 'template';
  template_type?: string;
}

export interface DailyNote extends BaseObject {
  type: 'daily_note';
}

export interface CombinedAnalysis extends BaseObject {
  type: 'combined_analysis';
  description?: string;
  data_source_count?: number;
  chart_count?: number;
}

export interface WellbeingIndicator extends BaseObject {
  type: 'wellbeing_indicator';
  signals?: unknown[];
  signal_count?: number;
}

export interface Resource extends BaseObject {
  type: 'resource';
  media_type: string;
  cover?: string;
  source_url?: string;
  book_id?: string;
  status?: string;
  rating?: number;
  priority?: string;
  author?: string;
  year?: number;
  pages?: number;
  category?: string;
  isbn?: string;
  title_pt_br?: string;
  title_original?: string;
  publisher?: string;
  language?: string;
  google_books_id?: string;
  imdb_id?: string;
  read?: string;
  start_date?: string;
  end_date?: string;
  scheduler?: Record<string, unknown>;
  links?: string[];
  categories?: string[];
  tags?: string[];
  aliases?: string[];
}

export interface Area extends BaseObject {
  type: 'area';
  organizer_type: 'area';
}

export interface Project extends BaseObject {
  type: 'project';
  organizer_type: 'project';
  rotation_groups?: unknown[];
  rotation_group_count?: number;
  rotation_start_date?: string;
  rotation_time?: string;
  rotation_duration_minutes?: number;
  task_links?: string[];
}

export interface Activity extends BaseObject {
  type: 'activity';
  organizer_type: 'activity';
}

export interface Label extends BaseObject {
  type: 'label';
  organizer_type: 'label';
}

export interface Person extends BaseObject {
  type: 'person';
  organizer_type: 'person';
  last_contact?: string;
  frequency_days?: number;
}

export interface DayTheme extends BaseObject {
  type: 'day_theme';
  organizer_type: 'day_theme';
}

export interface TimeBlock extends BaseObject {
  type: 'time_block';
  organizer_type: 'time_block';
  time_ranges?: Array<{id: string; start: string; end: string}>;
  ranges?: Array<{id: string; start: string; end: string}>;
}

export interface Value extends BaseObject {
  type: 'value';
  organizer_type: 'value';
}

export interface Pillar extends BaseObject {
  type: 'pillar';
  why?: string;
  touch_count?: number;
}

export interface Action extends BaseObject {
  type: 'action';
  energy_level?: string;
  energy_cost?: string;
  priority?: string;
}

export interface MonthlyFocus extends BaseObject {
  type: 'monthly_focus';
  month?: number;
  year?: number;
}

export interface Quote extends BaseObject {
  type: 'quote';
  source_object_id?: string;
}

export type QuartzoObject = 
  | Task
  | Habit
  | TrackerDefinition
  | TrackingRecord
  | Entry
  | Note
  | Reminder
  | Goal
  | Event
  | PomodoroSession
  | System
  | Routine
  | SocialPost
  | MoodDefinition
  | Idea
  | Inbox
  | ShoppingList
  | Template
  | DailyNote
  | CombinedAnalysis
  | WellbeingIndicator
  | Resource
  | Area
  | Project
  | Activity
  | Label
  | Person
  | DayTheme
  | TimeBlock
  | Value
  | Pillar
  | Action
  | MonthlyFocus
  | Quote;

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface ParseResult {
  object: QuartzoObject;
  unknownFields: string[];
}
