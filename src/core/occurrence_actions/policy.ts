import type { OccurrenceOutcome } from './types';

export type OccurrenceSemanticRole =
  | 'taskWork'
  | 'habitSlot'
  | 'eventAttendance'
  | 'externalEventAttendance'
  | 'reminderPrompt'
  | 'focusSession'
  | 'historicalFocus'
  | 'trackerPrompt'
  | 'historicalRecord'
  | 'journalPrompt'
  | 'historicalJournal'
  | 'timeAllocation'
  | 'systemRun'
  | 'routineRun'
  | 'rotationBlock'
  | 'contactPrompt'
  | 'goalStart'
  | 'goalDeadline'
  | 'sleepEvidence'
  | 'referencePrompt';

export type OccurrenceStartAction =
  | 'none'
  | 'focusToDo'
  | 'startPlannedTime'
  | 'startRoutine'
  | 'startFocusSession'
  | 'runSystem'
  | 'startRotationBlock';

export type OccurrenceQuickOutcomeControl = 'none' | 'checkbox' | 'attendance';

export interface OccurrencePolicyInput {
  sourceType: string;
  outcome: OccurrenceOutcome;
  completable: boolean;
  playable?: boolean;
  editable?: boolean;
  reminderId?: string;
  temporalKind?: 'instant' | 'interval';
  durationMinutes?: number;
  provenance?: string;
  completed?: boolean;
  restrictionMetadata?: Record<string, unknown>;
  specialRole?: string;
}

export interface OccurrenceActionCapabilities {
  role: OccurrenceSemanticRole;
  outcome: OccurrenceOutcome;
  startAction: OccurrenceStartAction;
  quickOutcomeControl: OccurrenceQuickOutcomeControl;
  isEvidence: boolean;
  canReportDone: boolean;
  canSkip: boolean;
  canAlreadyDid: boolean;
  canStart: boolean;
  canReplan: boolean;
  canNextOpportunity: boolean;
  canSnooze: boolean;
  canOpen: boolean;
  canLogLinkedTracker: boolean;
  doneLabel?: string;
  skipLabel?: string;
  startLabel?: string;
  statusLabel?: string;
  clearOutcomeLabel?: string;
  logLinkedTrackerLabel?: string;
}

function roleFor(input: OccurrencePolicyInput): OccurrenceSemanticRole {
  const explicit = input.restrictionMetadata?.semantic_role;
  if (typeof explicit === 'string' && ROLES.has(explicit as OccurrenceSemanticRole)) {
    return explicit as OccurrenceSemanticRole;
  }

  if (
    input.specialRole === 'sleep' ||
    input.sourceType === 'sleep_session' ||
    input.provenance === 'sleep_session'
  ) {
    return 'sleepEvidence';
  }

  if (input.reminderId && !hasDomainCompletionSemantics(input.sourceType)) {
    return 'referencePrompt';
  }

  switch (input.sourceType) {
    case 'task': return 'taskWork';
    case 'habit': return 'habitSlot';
    case 'event': return 'eventAttendance';
    case 'googleCalendar':
    case 'google_calendar': return 'externalEventAttendance';
    case 'reminder': return 'reminderPrompt';
    case 'pomodoro':
    case 'focus_session': return input.completed ? 'historicalFocus' : 'focusSession';
    case 'trackerRecord':
    case 'tracking_record': return 'historicalRecord';
    case 'trackerPrompt':
    case 'tracker_prompt': return 'trackerPrompt';
    case 'journalEntry':
    case 'journal_entry': return 'historicalJournal';
    case 'journalPrompt':
    case 'journal_prompt': return 'journalPrompt';
    case 'timeBlock':
    case 'time_block': return 'timeAllocation';
    case 'system': return 'systemRun';
    case 'routine': return 'routineRun';
    case 'rotationBlock':
    case 'projectRotation':
    case 'project_rotation': return 'rotationBlock';
    case 'person':
    case 'personContact':
    case 'person_contact': return 'contactPrompt';
    case 'goalStart':
    case 'goal_start': return 'goalStart';
    case 'goalDeadline':
    case 'goal_deadline': return 'goalDeadline';
    default: return 'referencePrompt';
  }
}

const ROLES = new Set<OccurrenceSemanticRole>([
  'taskWork','habitSlot','eventAttendance','externalEventAttendance','reminderPrompt',
  'focusSession','historicalFocus','trackerPrompt','historicalRecord','journalPrompt',
  'historicalJournal','timeAllocation','systemRun','routineRun','rotationBlock',
  'contactPrompt','goalStart','goalDeadline','sleepEvidence','referencePrompt',
]);

function hasDomainCompletionSemantics(sourceType: string): boolean {
  return new Set([
    'task','habit','event','googleCalendar','google_calendar','reminder','pomodoro',
    'focus_session','timeBlock','time_block','system','routine','rotationBlock',
    'projectRotation','project_rotation','person','personContact','person_contact',
    'goalStart','goal_start','goalDeadline','goal_deadline',
  ]).has(sourceType);
}

function isEvidence(role: OccurrenceSemanticRole): boolean {
  return ['historicalFocus','historicalRecord','historicalJournal','sleepEvidence'].includes(role);
}

function canReportDone(role: OccurrenceSemanticRole, input: OccurrencePolicyInput): boolean {
  if (['taskWork','habitSlot','eventAttendance','externalEventAttendance','reminderPrompt','focusSession'].includes(role)) {
    return input.completable;
  }
  if ([
    'trackerPrompt','journalPrompt','timeAllocation','systemRun','routineRun','rotationBlock',
    'contactPrompt','goalStart','goalDeadline',
  ].includes(role)) return true;
  return role === 'referencePrompt' ? input.completable : false;
}

function canSkip(role: OccurrenceSemanticRole): boolean {
  return !isEvidence(role);
}

function supportsAlreadyDid(role: OccurrenceSemanticRole): boolean {
  return [
    'taskWork','habitSlot','eventAttendance','externalEventAttendance',
    'reminderPrompt','focusSession','contactPrompt',
  ].includes(role);
}

function startAction(role: OccurrenceSemanticRole, input: OccurrencePolicyInput): OccurrenceStartAction {
  if (role === 'taskWork') return 'focusToDo';
  if (role === 'timeAllocation' && input.temporalKind === 'interval' && (input.durationMinutes ?? 0) > 0) {
    return 'startPlannedTime';
  }
  if (role === 'habitSlot' && input.playable) return 'startRoutine';
  if (role === 'routineRun' && input.playable) return 'startRoutine';
  if (role === 'focusSession' && input.playable) return 'startFocusSession';
  if (role === 'systemRun' && input.playable) return 'runSystem';
  if (role === 'rotationBlock' && input.playable) return 'startRotationBlock';
  return 'none';
}

function quickOutcomeControl(role: OccurrenceSemanticRole, input: OccurrencePolicyInput): OccurrenceQuickOutcomeControl {
  if (!canReportDone(role, input)) return 'none';
  if (role === 'eventAttendance' || role === 'externalEventAttendance') return 'attendance';
  if (['taskWork','habitSlot','timeAllocation','routineRun'].includes(role)) return 'checkbox';
  return 'none';
}

function doneLabel(role: OccurrenceSemanticRole): string {
  switch (role) {
    case 'eventAttendance':
    case 'externalEventAttendance': return 'Attended';
    case 'trackerPrompt': return 'Log';
    case 'journalPrompt': return 'Write';
    case 'timeAllocation': return 'Block done';
    case 'systemRun': return 'Completed';
    case 'routineRun': return 'Done today';
    case 'rotationBlock': return 'Block done';
    case 'contactPrompt': return 'Contacted';
    case 'goalStart': return 'Started';
    case 'goalDeadline': return 'Reached';
    default: return 'Done';
  }
}

function skipLabel(role: OccurrenceSemanticRole): string {
  switch (role) {
    case 'taskWork':
    case 'habitSlot':
    case 'contactPrompt': return 'Skip today';
    case 'eventAttendance':
    case 'externalEventAttendance': return 'Did not attend';
    case 'timeAllocation': return 'Skip block';
    case 'systemRun': return 'Skip this run';
    case 'routineRun': return 'Skip today';
    case 'rotationBlock': return 'Skip block';
    case 'goalStart': return 'Not started';
    case 'goalDeadline': return 'Not reached';
    default: return 'Skip';
  }
}

function startLabel(role: OccurrenceSemanticRole): string | undefined {
  switch (role) {
    case 'taskWork':
    case 'habitSlot': return 'Start';
    case 'timeAllocation': return 'Start block';
    case 'routineRun': return 'Run routine';
    case 'systemRun': return 'Run system';
    case 'focusSession': return 'Start focus';
    case 'rotationBlock': return 'Start block';
    default: return undefined;
  }
}

function statusLabel(role: OccurrenceSemanticRole, outcome: OccurrenceOutcome): string | undefined {
  if (outcome === 'done') return doneLabel(role);
  if (outcome === 'skipped') return skipLabel(role);
  if (role === 'historicalFocus') return 'Completed';
  if (role === 'historicalRecord') return 'Logged';
  if (role === 'historicalJournal') return 'Written';
  if (role === 'sleepEvidence') return 'Logged';
  return undefined;
}

export class OccurrenceActionPolicy {
  static resolve(input: OccurrencePolicyInput): OccurrenceActionCapabilities {
    const role = roleFor(input);
    if (isEvidence(role)) {
      const label = statusLabel(role, input.outcome);
      return {
        role,
        outcome: input.outcome,
        startAction: 'none',
        quickOutcomeControl: 'none',
        isEvidence: true,
        canReportDone: false,
        canSkip: false,
        canAlreadyDid: false,
        canStart: false,
        canReplan: false,
        canNextOpportunity: false,
        canSnooze: false,
        canOpen: true,
        canLogLinkedTracker: false,
        doneLabel: label,
        statusLabel: label,
      };
    }

    const terminal = input.outcome !== 'pending';
    const reportDone = canReportDone(role, input);
    const resolvedStart = terminal ? 'none' : startAction(role, input);
    const trackerId = input.restrictionMetadata?.linked_tracker_id;
    const trackerSlug = input.restrictionMetadata?.linked_tracker_slug;
    const canLogLinkedTracker = role === 'habitSlot' &&
      ((typeof trackerId === 'string' && trackerId.length > 0) ||
       (typeof trackerSlug === 'string' && trackerSlug.length > 0));

    return {
      role,
      outcome: input.outcome,
      startAction: resolvedStart,
      quickOutcomeControl: quickOutcomeControl(role, input),
      isEvidence: false,
      canReportDone: reportDone,
      canSkip: canSkip(role),
      canAlreadyDid: reportDone && supportsAlreadyDid(role),
      canStart: resolvedStart !== 'none',
      canReplan: Boolean(input.editable) && ['taskWork','goalDeadline','timeAllocation'].includes(role),
      canNextOpportunity: ['taskWork','habitSlot','reminderPrompt'].includes(role),
      canSnooze: role === 'reminderPrompt',
      canOpen: true,
      canLogLinkedTracker,
      doneLabel: doneLabel(role),
      skipLabel: skipLabel(role),
      startLabel: startLabel(role),
      statusLabel: statusLabel(role, input.outcome),
      clearOutcomeLabel: terminal ? 'Undo' : undefined,
      logLinkedTrackerLabel: canLogLinkedTracker ? 'Log details' : undefined,
    };
  }
}
