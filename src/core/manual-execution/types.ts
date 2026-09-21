export type ManualExecutionSourceType = 'system' | 'routine';

export type ManualExecutionStepKind =
  | 'plain'
  | 'habit'
  | 'task'
  | 'tracker_entry'
  | 'pomodoro'
  | string;

export interface ManualExecutionStep {
  id: string;
  title: string;
  kind: ManualExecutionStepKind;
  required: boolean;
  linkedObjectSlug?: string;
  trackerFieldId?: string;
  attachedCollectionSlug?: string;
  estimatedMinutes?: number;
}

export type ManualExecutionStepCapability =
  | 'supported'
  | 'delegated'
  | 'requiresFocusRuntime'
  | 'unsupported';

export type ManualExecutionRunCapability =
  | 'supported'
  | 'requiresFocusRuntime'
  | 'unsupported';

export interface SystemExecutionEvidence {
  executed_at: string;
  finished_at?: string;
  occurrence_id?: string;
  scheduled_for?: string;
  step_completions: Record<string, boolean>;
  notes?: string;
}

export interface SystemRunSummaryTask {
  id: string;
  type: 'task';
  title: string;
  stage: 'finalized';
  created_at: string;
  updated_at: string;
  duration: number;
  linked_system: string;
}

export interface RoutineExecutionStepEvidence {
  step_id: string;
  title_snapshot: string;
  kind_snapshot: string;
  required_snapshot: boolean;
  completed: boolean;
  completed_at?: string;
}

export interface RoutineExecutionEvidence {
  occurrence_id: string;
  scheduled_for: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
  steps: RoutineExecutionStepEvidence[];
  notes?: string;
  mood_before?: string;
  mood_after?: string;
  legacy_summary?: Record<string, unknown>;
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function requiredText(value: unknown, field: string): string {
  const text = optionalText(value);
  if (!text) throw new Error(`${field} is required.`);
  return text;
}

function boolOrDefault(value: unknown, fallback: boolean): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${String(value)}`);
}

export function parseManualExecutionSteps(value: unknown): ManualExecutionStep[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Checklist steps must be a list.');

  return value.map((raw, index) => {
    const step = asRecord(raw, `Checklist step ${index + 1}`);
    const id = requiredText(step.id, `Checklist step ${index + 1} id`);
    const kind = optionalText(step.kind) ?? 'plain';
    const estimated = step.estimated_minutes == null
      ? undefined
      : Number(step.estimated_minutes);
    if (estimated != null && (!Number.isFinite(estimated) || estimated < 0)) {
      throw new Error(`Checklist step ${id} estimated_minutes is invalid.`);
    }
    return {
      id,
      title: optionalText(step.title) ?? 'Untitled',
      kind,
      required: boolOrDefault(step.required, true),
      linkedObjectSlug: optionalText(step.linked_object_slug),
      trackerFieldId: optionalText(step.tracker_field_id),
      attachedCollectionSlug: optionalText(step.attached_collection_slug),
      estimatedMinutes: estimated,
    };
  });
}

export function normalizeStepCompletions(
  steps: readonly ManualExecutionStep[],
  raw: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const known = new Set(steps.map(step => step.id));
  const unknown = Object.keys(raw).filter(id => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Run contains unknown step ids: ${unknown.join(', ')}`);
  }
  return Object.fromEntries(steps.map(step => [step.id, raw[step.id] === true]));
}

export function parsePersistedStepCompletions(value: unknown): Record<string, boolean> {
  if (value == null) return {};
  const raw = asRecord(value, 'step_completions');
  const result: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(raw)) {
    if (typeof item === 'boolean') {
      result[key] = item;
      continue;
    }
    const normalized = String(item).trim().toLowerCase();
    if (['true', 'done', 'completed', '1'].includes(normalized)) result[key] = true;
    else if (['false', '0'].includes(normalized)) result[key] = false;
    else throw new Error(`Invalid persisted step completion: ${key}=${String(item)}`);
  }
  return result;
}

export function sameStepCompletions(
  left: Readonly<Record<string, boolean>>,
  right: Readonly<Record<string, boolean>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(key => right[key] === left[key]);
}
