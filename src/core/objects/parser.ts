import YAML from 'yaml';
import { 
  QuartzoObject, 
  ParsedMarkdown, 
  ParseResult,
  ObjectType,
  Task,
  Habit,
  TrackerDefinition,
  TrackingRecord,
  Entry,
  Note,
  Reminder,
  Goal,
  Event,
  PomodoroSession,
  System,
  Routine,
  SocialPost,
  MoodDefinition,
  Idea,
  Inbox,
  ShoppingList,
  Template,
  DailyNote,
  CombinedAnalysis,
  WellbeingIndicator,
  Area,
  Project,
  Activity,
  Label,
  Person,
  DayTheme,
  TimeBlock,
  Value,
  Pillar,
  Action,
  MonthlyFocus,
  Quote
} from './types';

// Known field names for each object type
const KNOWN_FIELDS: Record<ObjectType, Set<string>> = {
  task: new Set(['id', 'type', 'title', 'archived', 'organizers', 'scheduler', 'reminders', 'body']),
  habit: new Set(['id', 'type', 'title', 'color', 'status', 'slots', 'negative', 'body']),
  tracker_definition: new Set(['id', 'type', 'title', 'sections', 'section_count', 'field_count', 'body']),
  tracker_record: new Set(['id', 'type', 'title', 'tracker_id', 'date', 'field_values', 'body']),
  entry: new Set(['id', 'type', 'title', 'date', 'time', 'body']),
  note: new Set(['id', 'type', 'title', 'note_subtype', 'links', 'body']),
  reminder: new Set(['id', 'type', 'title', 'date', 'time', 'is_completed', 'is_completable', 'reminder_count', 'reminder_id', 'reminders', 'scheduled_date', 'scheduler', 'notes', 'time_block', 'time_block_id', 'checkboxes', 'habit_reminder', 'organizers', 'categories', 'tags', 'links', 'archived', 'pinned', 'created_at', 'updated_at', 'source_url', 'body']),
  goal: new Set(['id', 'type', 'title', 'state', 'start_date', 'deadline', 'description', 'body']),
  event: new Set(['id', 'type', 'title', 'date', 'time_of_day', 'duration', 'body']),
  pomodoro_session: new Set(['id', 'type', 'title', 'date', 'work_duration', 'start', 'duration', 'state', 'body']),
  system: new Set([
    'id', 'type', 'title', 'time', 'trigger', 'scheduled_time', 'scheduler',
    'steps', 'execution_history', 'body',
  ]),
  routine: new Set([
    'id', 'type', 'title', 'organizer_type', 'statement', 'start_date',
    'estimated_minutes', 'show_in_planner', 'mood_trigger', 'scheduler',
    'steps', 'routine_executions_version', 'routine_executions', 'body',
  ]),
  social_post: new Set(['id', 'type', 'title', 'platform', 'personal_note', 'body']),
  mood_definition: new Set(['id', 'type', 'title', 'numeric_value', 'pleasantness', 'body']),
  idea: new Set(['id', 'type', 'title', 'horizon', 'body']),
  inbox: new Set(['id', 'type', 'title', 'temporal_intent', 'body']),
  shopping_list: new Set(['id', 'type', 'title', 'items', 'item_count', 'body']),
  template: new Set(['id', 'type', 'title', 'template_type', 'body']),
  daily_note: new Set(['id', 'type', 'title', 'body']),
  combined_analysis: new Set(['id', 'type', 'title', 'description', 'data_source_count', 'chart_count', 'body']),
  wellbeing_indicator: new Set(['id', 'type', 'title', 'signals', 'signal_count', 'body']),
  resource: new Set([
    'id', 'type', 'title', 'body', 'media_type', 'resource_type', 'cover', 'cover_image',
    'source_url', 'book_id', 'readwise_book_id', 'status', 'rating', 'priority', 'author',
    'year', 'pages', 'category', 'isbn', 'title_pt_br', 'title_original', 'publisher',
    'language', 'google_books_id', 'imdb_id', 'read', 'start_date', 'end_date', 'scheduler',
    'links', 'categories', 'tags', 'aliases', 'organizers', 'reminders', 'archived',
    'created_at', 'updated_at', 'order',
  ]),
  area: new Set(['id', 'type', 'title', 'organizer_type', 'body']),
  project: new Set(['id', 'type', 'title', 'organizer_type', 'rotation_groups', 'rotation_group_count', 'rotation_start_date', 'rotation_time', 'rotation_duration_minutes', 'task_links', 'body']),
  activity: new Set(['id', 'type', 'title', 'organizer_type', 'body']),
  label: new Set(['id', 'type', 'title', 'organizer_type', 'body']),
  person: new Set(['id', 'type', 'title', 'organizer_type', 'last_contact_date', 'contact_frequency_days', 'contact_priority', 'last_contact', 'frequency_days', 'body']),
  day_theme: new Set(['id', 'type', 'title', 'organizer_type', 'body']),
  time_block: new Set(['id', 'type', 'title', 'organizer_type', 'time_ranges', 'ranges', 'body']),
  value: new Set(['id', 'type', 'title', 'organizer_type', 'body']),
  pillar: new Set(['id', 'type', 'title', 'why', 'touch_count', 'body']),
  action: new Set(['id', 'type', 'title', 'energy_level', 'energy_cost', 'priority', 'body']),
  monthly_focus: new Set(['id', 'type', 'title', 'month', 'year', 'body']),
  quote: new Set(['id', 'type', 'title', 'source_object_id', 'body']),
};

export class ObjectParser {
  static parseMarkdown(markdown: string): ParsedMarkdown {
    const normalized = markdown.replace(/\r\n/g, '\n');
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = normalized.match(frontmatterRegex);
    
    if (!match) {
      return { frontmatter: {}, body: markdown };
    }
    
    const frontmatterText = match[1];
    const body = match[2].trimEnd(); // Remove trailing newline
    const frontmatter = YAML.parse(frontmatterText) as Record<string, unknown>;
    
    return { frontmatter, body };
  }

  static serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
    const frontmatterText = YAML.stringify(frontmatter).trim();
    return `---\n${frontmatterText}\n---\n${body}`;
  }

  private static identifyType(frontmatter: Record<string, unknown>): ObjectType | null {
    const type = frontmatter.type as string;
    if (!type) return null;
    
    // Map various type names to canonical types
    const typeMap: Record<string, ObjectType> = {
      'task': 'task',
      'habit': 'habit',
      'tracker': 'tracker_definition',
      'tracker_definition': 'tracker_definition',
      'tracker_record': 'tracker_record',
      'entry': 'entry',
      'journal_entry': 'entry',
      'note': 'note',
      'reminder': 'reminder',
      'goal': 'goal',
      'event': 'event',
      'pomodoro': 'pomodoro_session',
      'pomodoro_session': 'pomodoro_session',
      'system': 'system',
      'routine': 'routine',
      'social_post': 'social_post',
      'mood_definition': 'mood_definition',
      'idea': 'idea',
      'inbox': 'inbox',
      'shopping_list': 'shopping_list',
      'template': 'template',
      'daily': 'daily_note',
      'daily_note': 'daily_note',
      'analysis': 'combined_analysis',
      'combined_analysis': 'combined_analysis',
      'wellbeing_indicator': 'wellbeing_indicator',
      'resource': 'resource',
      'area': 'area',
      'project': 'project',
      'activity': 'activity',
      'label': 'label',
      'person': 'person',
      'day_theme': 'day_theme',
      'time_block': 'time_block',
      'value': 'value',
      'pillar': 'pillar',
      'action': 'action',
      'monthly_focus': 'monthly_focus',
      'quote': 'quote',
    };
    
    return typeMap[type] || null;
  }

  private static extractUnknownFields(
    frontmatter: Record<string, unknown>, 
    objectType: ObjectType
  ): string[] {
    const known = KNOWN_FIELDS[objectType];
    const unknown: string[] = [];
    
    for (const key of Object.keys(frontmatter)) {
      if (!known.has(key)) {
        unknown.push(key);
      }
    }
    
    return unknown;
  }

  private static transformOrganizers(organizers: unknown): Array<{type: string; slug: string; title: string}> {
    if (!Array.isArray(organizers)) return [];
    return organizers.map(org => {
      if (typeof org === 'string') {
        const match = org.match(/\[\[([^\]]+)\]\]/);
        if (match) {
          const parts = match[1].split('/');
          const slug = parts[parts.length - 1] || match[1];
          // Capitalize first letter for title
          const title = slug.charAt(0).toUpperCase() + slug.slice(1);
          return {
            type: 'project',
            slug,
            title
          };
        }
      }
      return org as {type: string; slug: string; title: string};
    });
  }

  private static transformReminderDate(date: unknown): string {
    if (typeof date === 'string') {
      if (date.includes('T')) {
        return date.split('T')[0];
      }
      return date;
    }
    return '';
  }

  private static transformReminderTime(time: unknown): string {
    if (typeof time === 'string') {
      if (time.includes('T')) {
        return time.split('T')[1].substring(0, 5);
      }
      return time;
    }
    return '';
  }

  static parse(markdown: string): ParseResult {
    const { frontmatter, body } = this.parseMarkdown(markdown);
    const objectType = this.identifyType(frontmatter);
    
    if (objectType === 'daily_note') {
      // Quartzo writes daily notes as type: daily while older Companion fixtures
      // may use type: daily_note. Keep one canonical read-only projection and
      // derive identity from date when the source file has no explicit id.
      return {
        object: {
          ...frontmatter,
          id: String(frontmatter.id ?? frontmatter.date ?? ''),
          type: 'daily_note',
          title: String(frontmatter.title ?? ''),
          body,
        } as DailyNote,
        unknownFields: [],
      };
    }
    
    if (!objectType) {
      throw new Error(`Unknown object type: ${frontmatter.type}`);
    }

    const unknownFields = this.extractUnknownFields(frontmatter, objectType);
    
    // Base object construction
    const baseObject = {
      id: String(frontmatter.id || ''),
      type: objectType,
      title: String(frontmatter.title || ''),
      body,
      ...frontmatter
    };

    // Type-specific transformations
    let object: QuartzoObject;
    
    switch (objectType) {
      case 'task':
        object = {
          ...baseObject,
          type: 'task',
          archived: frontmatter.archived as boolean,
          organizers: this.transformOrganizers(frontmatter.organizers),
          scheduler: frontmatter.scheduler as Task['scheduler'],
          reminders: frontmatter.reminders as Task['reminders'],
        } as Task;
        break;
      
      case 'habit':
        object = {
          ...baseObject,
          type: 'habit',
          color: frontmatter.color as string,
          status: frontmatter.status as string,
          slots: frontmatter.slots as Habit['slots'],
          negative: frontmatter.negative as boolean,
        } as Habit;
        break;
      
      case 'tracker_definition':
        // Transform sections from {id, name, fields} to {title, input_fields}
        const rawSections = frontmatter.sections as unknown;
        let transformedSections: Array<{title: string; input_fields: unknown[]}> = [];
        if (Array.isArray(rawSections)) {
          transformedSections = rawSections.map((section: Record<string, unknown>) => {
            // Handle both object and plain key-value access
            // YAML might parse differently, so try multiple access patterns
            let name = '';
            let fields: unknown[] = [];
            
            if (section && typeof section === 'object') {
              // Try direct property access
              name = (section.name as string) || (section.id as string) || (section.title as string) || '';
              fields = (section.input_fields as unknown[]) || (section.fields as unknown[]) || [];
              
              // If still empty, try iterating over keys
              if (!name && !fields.length) {
                for (const key of Object.keys(section)) {
                  if (key === 'name' || key === 'id' || key === 'title') {
                    name = String(section[key]);
                  }
                  if (key === 'input_fields' || key === 'fields') {
                    fields = Array.isArray(section[key]) ? section[key] as unknown[] : [];
                  }
                }
              }
            }
            
            return {
              title: String(name),
              input_fields: Array.isArray(fields) ? fields : []
            };
          });
        }
        object = {
          ...baseObject,
          type: 'tracker_definition',
          sections: transformedSections,
          section_count: transformedSections.length,
          field_count: transformedSections.reduce((sum, s) => sum + (s.input_fields?.length || 0), 0),
        } as TrackerDefinition;
        break;

      case 'tracker_record':
        object = {
          ...baseObject,
          type: 'tracker_record',
          tracker_id: String(frontmatter.tracker_id || ''),
          date: String(frontmatter.date || ''),
          field_values: frontmatter.field_values && typeof frontmatter.field_values === 'object' && !Array.isArray(frontmatter.field_values)
            ? { ...(frontmatter.field_values as Record<string, unknown>) }
            : {},
        } as TrackingRecord;
        break;
      
      case 'entry':
        object = {
          ...baseObject,
          type: 'entry',
          date: String(frontmatter.date || ''),
          time: frontmatter.time as string,
        } as Entry;
        break;
      
      case 'note':
        object = {
          ...baseObject,
          type: 'note',
          note_subtype: frontmatter.note_subtype as string,
          links: frontmatter.links as string[],
        } as Note;
        break;
      
      case 'reminder':
        object = {
          ...baseObject,
          type: 'reminder',
          date: this.transformReminderDate(frontmatter.date || frontmatter.scheduled_date),
          time: this.transformReminderTime(frontmatter.time),
          is_completed: frontmatter.is_completed as boolean,
          is_completable: frontmatter.is_completable as boolean,
          reminder_count: frontmatter.reminder_count as number || (Array.isArray(frontmatter.reminders) ? frontmatter.reminders.length : 1),
          reminder_id: frontmatter.reminder_id as string,
          reminders: Array.isArray(frontmatter.reminders) ? frontmatter.reminders as Reminder['reminders'] : undefined,
          scheduler: frontmatter.scheduler && typeof frontmatter.scheduler === 'object' && !Array.isArray(frontmatter.scheduler)
            ? { ...(frontmatter.scheduler as Record<string, unknown>) }
            : undefined,
          notes: frontmatter.notes as string,
          time_block: (frontmatter.time_block ?? frontmatter.time_block_id) as string,
          checkboxes: Array.isArray(frontmatter.checkboxes) ? frontmatter.checkboxes.map(value => String(value)) : undefined,
          habit_reminder: frontmatter.habit_reminder as boolean,
        } as Reminder;
        break;
      
      case 'goal':
        object = {
          ...baseObject,
          type: 'goal',
          state: frontmatter.state as string,
          start_date: frontmatter.start_date as string,
          deadline: frontmatter.deadline as string,
          description: frontmatter.description as string,
        } as Goal;
        break;
      
      case 'event':
        object = {
          ...baseObject,
          type: 'event',
          date: String(frontmatter.date || ''),
          time_of_day: frontmatter.time_of_day as string,
          duration: frontmatter.duration as number,
        } as Event;
        break;
      
      case 'pomodoro_session':
        object = {
          ...baseObject,
          type: 'pomodoro_session',
          date: String(frontmatter.date || ''),
          work_duration: frontmatter.work_duration as number,
          start: frontmatter.start as string,
          duration: frontmatter.duration as number,
          state: frontmatter.state as string,
        } as PomodoroSession;
        break;
      
      case 'system':
        object = {
          ...baseObject,
          type: 'system',
          time: frontmatter.time as string,
          trigger: frontmatter.trigger as string,
          scheduled_time: frontmatter.scheduled_time as string,
          scheduler: frontmatter.scheduler as System['scheduler'],
          steps: Array.isArray(frontmatter.steps)
            ? frontmatter.steps as System['steps']
            : undefined,
          execution_history: Array.isArray(frontmatter.execution_history)
            ? frontmatter.execution_history as System['execution_history']
            : undefined,
        } as System;
        break;
      
      case 'routine':
        object = {
          ...baseObject,
          type: 'routine',
          organizer_type: 'routine',
          statement: frontmatter.statement as string,
          start_date: frontmatter.start_date as string,
          estimated_minutes: frontmatter.estimated_minutes as number,
          show_in_planner: frontmatter.show_in_planner as boolean,
          mood_trigger: frontmatter.mood_trigger as string,
          scheduler: frontmatter.scheduler as Record<string, unknown>,
          steps: Array.isArray(frontmatter.steps)
            ? frontmatter.steps as Routine['steps']
            : undefined,
          routine_executions_version: frontmatter.routine_executions_version as number,
          routine_executions: Array.isArray(frontmatter.routine_executions)
            ? frontmatter.routine_executions as Routine['routine_executions']
            : undefined,
        } as Routine;
        break;
      
      case 'social_post':
        object = {
          ...baseObject,
          type: 'social_post',
          platform: frontmatter.platform as string,
          personal_note: body,
        } as SocialPost;
        break;
      
      case 'mood_definition':
        object = {
          ...baseObject,
          type: 'mood_definition',
          numeric_value: frontmatter.numeric_value as number,
          pleasantness: frontmatter.numeric_value as number,
          body,
        } as MoodDefinition;
        break;
      
      case 'idea':
        object = {
          ...baseObject,
          type: 'idea',
          horizon: frontmatter.horizon as string,
        } as Idea;
        break;
      
      case 'inbox':
        object = {
          ...baseObject,
          type: 'inbox',
          temporal_intent: frontmatter.temporal_intent as string,
        } as Inbox;
        break;
      
      case 'shopping_list':
        object = {
          ...baseObject,
          type: 'shopping_list',
          items: frontmatter.items as unknown[],
          item_count: Array.isArray(frontmatter.items) ? frontmatter.items.length : 0,
        } as ShoppingList;
        break;
      
      case 'template':
        object = {
          ...baseObject,
          type: 'template',
          template_type: frontmatter.template_type as string,
        } as Template;
        break;
      
      case 'combined_analysis':
        object = {
          ...baseObject,
          type: 'combined_analysis',
          description: frontmatter.description as string,
          data_source_count: frontmatter.data_source_count as number || 0,
          chart_count: frontmatter.chart_count as number || 0,
        } as CombinedAnalysis;
        break;
      
      case 'wellbeing_indicator':
        object = {
          ...baseObject,
          type: 'wellbeing_indicator',
          signals: frontmatter.signals as unknown[],
          signal_count: Array.isArray(frontmatter.signals) ? frontmatter.signals.length : 0,
        } as WellbeingIndicator;
        break;
      
      case 'area':
        object = {
          ...baseObject,
          type: 'area',
          organizer_type: 'area',
        } as Area;
        break;
      
      case 'project':
        object = {
          ...baseObject,
          type: 'project',
          organizer_type: 'project',
          rotation_groups: frontmatter.rotation_groups as unknown[],
          rotation_group_count: Array.isArray(frontmatter.rotation_groups) ? frontmatter.rotation_groups.length : 0,
          rotation_start_date: frontmatter.rotation_start_date as string,
          rotation_time: frontmatter.rotation_time as string,
          rotation_duration_minutes: frontmatter.rotation_duration_minutes as number,
          task_links: frontmatter.task_links as string[],
        } as Project;
        break;
      
      case 'activity':
        object = {
          ...baseObject,
          type: 'activity',
          organizer_type: 'activity',
        } as Activity;
        break;
      
      case 'label':
        object = {
          ...baseObject,
          type: 'label',
          organizer_type: 'label',
        } as Label;
        break;
      
      case 'person':
        object = {
          ...baseObject,
          type: 'person',
          organizer_type: 'person',
          last_contact_date: String(frontmatter.last_contact_date ?? frontmatter.last_contact ?? '') || undefined,
          contact_frequency_days: Number(frontmatter.contact_frequency_days ?? frontmatter.frequency_days) || undefined,
          contact_priority: frontmatter.contact_priority as string,
          last_contact: frontmatter.last_contact as string,
          frequency_days: frontmatter.frequency_days as number,
        } as Person;
        break;
      
      case 'day_theme':
        object = {
          ...baseObject,
          type: 'day_theme',
          organizer_type: 'day_theme',
        } as DayTheme;
        break;
      
      case 'time_block':
        object = {
          ...baseObject,
          type: 'time_block',
          organizer_type: 'time_block',
          time_ranges: frontmatter.time_ranges as TimeBlock['time_ranges'] || [],
          ranges: frontmatter.ranges as TimeBlock['ranges'] || [],
        } as TimeBlock;
        break;
      
      case 'value':
        object = {
          ...baseObject,
          type: 'value',
          organizer_type: 'value',
        } as Value;
        break;
      
      case 'pillar':
        object = {
          ...baseObject,
          type: 'pillar',
          why: frontmatter.why as string,
          touch_count: frontmatter.touch_count as number || 0,
        } as Pillar;
        break;
      
      case 'action':
        object = {
          ...baseObject,
          type: 'action',
          energy_level: frontmatter.energy_level as string,
          energy_cost: frontmatter.energy_cost as string,
          priority: frontmatter.priority as string,
        } as Action;
        break;
      
      case 'monthly_focus':
        object = {
          ...baseObject,
          type: 'monthly_focus',
          month: frontmatter.month as number,
          year: frontmatter.year as number,
        } as MonthlyFocus;
        break;
      
      case 'quote':
        object = {
          ...baseObject,
          type: 'quote',
          source_object_id: frontmatter.source_object_id as string,
        } as Quote;
        break;
      
      default:
        object = baseObject as QuartzoObject;
    }

    // Preserve unknown fields
    for (const field of unknownFields) {
      (object as Record<string, unknown>)[field] = frontmatter[field];
    }

    return { object, unknownFields };
  }

  static serialize(object: QuartzoObject, unknownFields: Record<string, unknown> = {}): string {
    const frontmatter: Record<string, unknown> = {
      id: object.id,
      type: object.type,
      title: object.title,
    };

    // Add type-specific fields
    if (object.type === 'task') {
      const task = object as Task;
      if (task.archived !== undefined) frontmatter.archived = task.archived;
      if (task.organizers) frontmatter.organizers = task.organizers;
      if (task.scheduler) frontmatter.scheduler = task.scheduler;
      if (task.reminders) frontmatter.reminders = task.reminders;
    }
    
    // Add other type-specific fields as needed
    // For now, we'll preserve all properties from the object
    
    // Add all other properties from the object
    for (const [key, value] of Object.entries(object)) {
      if (key !== 'id' && key !== 'type' && key !== 'title' && key !== 'body') {
        frontmatter[key] = value;
      }
    }

    // Add unknown fields
    for (const [key, value] of Object.entries(unknownFields)) {
      frontmatter[key] = value;
    }

    const body = object.body || '';
    return this.serializeMarkdown(frontmatter, body);
  }

  static roundtrip(markdown: string): string {
    const { object, unknownFields } = this.parse(markdown);
    const unknownFieldsMap: Record<string, unknown> = {};
    for (const field of unknownFields) {
      unknownFieldsMap[field] = (object as Record<string, unknown>)[field];
    }
    return this.serialize(object, unknownFieldsMap);
  }
}
