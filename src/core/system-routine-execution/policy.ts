import type {
  ChecklistStepData,
  ManualExecutionRunCapability,
  ManualExecutionStepCapability,
} from './types';

function hasText(value: string | undefined): boolean {
  return value?.trim().length !== 0 && value != null;
}

export function normalizeChecklistSteps(raw: unknown): ChecklistStepData[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        id: '',
        title: `Step ${index + 1}`,
        kind: 'unsupported',
        required: true,
      };
    }
    const map = value as Record<string, unknown>;
    return {
      id: String(map.id ?? '').trim(),
      title: String(map.title ?? `Step ${index + 1}`),
      kind: String(map.kind ?? 'plain').trim() || 'plain',
      linkedObjectSlug: map.linked_object_slug == null
        ? undefined
        : String(map.linked_object_slug).trim(),
      trackerFieldId: map.tracker_field_id == null
        ? undefined
        : String(map.tracker_field_id).trim(),
      required: map.required !== false,
    };
  });
}

export function supportsManualRunSource(sourceType: string): boolean {
  return sourceType === 'system' || sourceType === 'routine';
}

export function allowsBackgroundAutoRun(_sourceType: string): boolean {
  return false;
}

export function resolveManualExecutionStepCapability(
  step: ChecklistStepData,
): ManualExecutionStepCapability {
  if (!hasText(step.id)) return 'unsupported';
  switch (step.kind) {
    case 'plain':
      return 'supported';
    case 'habit':
    case 'task':
      return hasText(step.linkedObjectSlug) ? 'delegated' : 'unsupported';
    case 'tracker_entry':
      return hasText(step.linkedObjectSlug) && hasText(step.trackerFieldId)
        ? 'delegated'
        : 'unsupported';
    case 'pomodoro':
      return 'requiresFocusRuntime';
    default:
      return 'unsupported';
  }
}

export function resolveManualExecutionRunCapability(
  sourceType: string,
  steps: ChecklistStepData[],
  options: {
    focusRuntimeAvailable?: boolean;
    availableDelegatedKinds?: ReadonlySet<string>;
  } = {},
): ManualExecutionRunCapability {
  if (!supportsManualRunSource(sourceType) || steps.length === 0) return 'unsupported';
  const delegated = options.availableDelegatedKinds ?? new Set(['habit', 'task', 'tracker_entry']);
  let needsFocus = false;

  for (const step of steps) {
    const capability = resolveManualExecutionStepCapability(step);
    if (capability === 'unsupported') return 'unsupported';
    if (capability === 'delegated' && !delegated.has(step.kind)) return 'unsupported';
    if (capability === 'requiresFocusRuntime' && !options.focusRuntimeAvailable) {
      needsFocus = true;
    }
  }
  return needsFocus ? 'requiresFocusRuntime' : 'supported';
}
