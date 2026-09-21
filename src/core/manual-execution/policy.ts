import type {
  ManualExecutionRunCapability,
  ManualExecutionStep,
  ManualExecutionStepCapability,
} from './types';

const DEFAULT_DELEGATED_KINDS = new Set(['habit', 'task', 'tracker_entry']);

export function supportsManualRunSource(sourceType: string): boolean {
  return sourceType === 'system' || sourceType === 'routine';
}

export function allowsBackgroundAutoRun(_sourceType: string): boolean {
  return false;
}

export function resolveManualExecutionStepCapability(
  step: ManualExecutionStep,
): ManualExecutionStepCapability {
  switch (step.kind) {
    case 'plain':
      return 'supported';
    case 'habit':
    case 'task':
      return step.linkedObjectSlug?.trim() ? 'delegated' : 'unsupported';
    case 'tracker_entry':
      return step.linkedObjectSlug?.trim() && step.trackerFieldId?.trim()
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
  steps: readonly ManualExecutionStep[],
  options: {
    focusRuntimeAvailable?: boolean;
    availableDelegatedKinds?: ReadonlySet<string>;
  } = {},
): ManualExecutionRunCapability {
  if (!supportsManualRunSource(sourceType) || steps.length === 0) {
    return 'unsupported';
  }

  const delegated = options.availableDelegatedKinds ?? DEFAULT_DELEGATED_KINDS;
  let needsFocus = false;
  for (const step of steps) {
    const capability = resolveManualExecutionStepCapability(step);
    if (capability === 'unsupported') return 'unsupported';
    if (capability === 'delegated' && !delegated.has(step.kind)) {
      return 'unsupported';
    }
    if (capability === 'requiresFocusRuntime' && !options.focusRuntimeAvailable) {
      needsFocus = true;
    }
  }
  return needsFocus ? 'requiresFocusRuntime' : 'supported';
}

export function canStartManualExecution(
  sourceType: string,
  steps: readonly ManualExecutionStep[],
  options: {
    focusRuntimeAvailable?: boolean;
    availableDelegatedKinds?: ReadonlySet<string>;
  } = {},
): boolean {
  return resolveManualExecutionRunCapability(sourceType, steps, options) === 'supported';
}
