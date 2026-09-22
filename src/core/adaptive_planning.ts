import { ObjectParser } from './objects';

export type DayCapacityMode = 'low' | 'normal' | 'high' | 'auto';

export interface DailyPlanningState {
  date: string;
  capacityMode: DayCapacityMode;
  minimumPlanActive: boolean;
  essentialOccurrenceIds: string[];
  parkedOccurrenceIds: string[];
  acknowledgedFellBehindIds: string[];
  minimumPlanDeferredIds: string[];
  leaveSpaceReserveMinutes: number;
  updatedAt?: string;
}

const CAPACITY_MODES = new Set<DayCapacityMode>(['low', 'normal', 'high', 'auto']);

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))];
}

function capacityMode(value: unknown): DayCapacityMode {
  return typeof value === 'string' && CAPACITY_MODES.has(value as DayCapacityMode)
    ? value as DayCapacityMode
    : 'auto';
}

function nonNegativeInteger(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function rawState(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be a map.`);
  }
  return value as Record<string, unknown>;
}

export function defaultDailyPlanningState(date: string): DailyPlanningState {
  return {
    date,
    capacityMode: 'auto',
    minimumPlanActive: false,
    essentialOccurrenceIds: [],
    parkedOccurrenceIds: [],
    acknowledgedFellBehindIds: [],
    minimumPlanDeferredIds: [],
    leaveSpaceReserveMinutes: 0,
  };
}

export function parseDailyPlanningState(date: string, value: unknown): DailyPlanningState {
  const raw = rawState(value, `daily_planning_states.${date}`);
  return {
    date: typeof raw.date === 'string' && raw.date.trim() ? raw.date : date,
    capacityMode: capacityMode(raw.capacity_mode),
    minimumPlanActive: raw.minimum_plan_active === true,
    essentialOccurrenceIds: stringList(raw.essential_occurrence_ids),
    parkedOccurrenceIds: stringList(raw.parked_occurrence_ids),
    acknowledgedFellBehindIds: stringList(raw.acknowledged_fell_behind_ids),
    minimumPlanDeferredIds: stringList(raw.minimum_plan_deferred_ids),
    leaveSpaceReserveMinutes: nonNegativeInteger(raw.leave_space_reserve_minutes),
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  };
}

export function parseDailyPlanningStates(markdown: string): Record<string, DailyPlanningState> {
  if (!markdown.trim()) return {};
  const parsed = ObjectParser.parseMarkdown(markdown);
  if (parsed.frontmatter.type !== 'shared_planning_state') {
    throw new Error('Shared planning state has an unexpected type.');
  }
  const rawStates = parsed.frontmatter.daily_planning_states;
  if (rawStates == null) return {};
  const states = rawState(rawStates, 'daily_planning_states');
  const result: Record<string, DailyPlanningState> = {};
  for (const [date, raw] of Object.entries(states)) {
    result[date] = parseDailyPlanningState(date, raw);
  }
  return result;
}
