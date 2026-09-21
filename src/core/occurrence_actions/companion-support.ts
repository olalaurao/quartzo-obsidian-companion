export type CompanionOccurrenceDomainMode =
  | 'response_only'
  | 'domain_mutation'
  | 'unsupported';

export function companionOccurrenceDomainMode(sourceType: string): CompanionOccurrenceDomainMode {
  switch (sourceType) {
    case 'task':
    case 'habit':
    case 'reminder':
    case 'event':
    case 'person':
    case 'personContact':
    case 'person_contact':
    case 'goal':
    case 'goalStart':
    case 'goal_start':
    case 'goalDeadline':
    case 'goal_deadline':
      return 'domain_mutation';

    // These canonical occurrence outcomes intentionally live in the shared
    // occurrence shard; their source object does not need a completion write.
    case 'timeBlock':
    case 'time_block':
    case 'project':
    case 'rotationBlock':
    case 'projectRotation':
    case 'project_rotation':
    case 'googleCalendar':
    case 'google_calendar':
    case 'focus_session':
    case 'pomodoro':
    case 'pomodoro_session':
      return 'response_only';

    // System/Routine user-triggered Run is owned separately by
    // core/manual-execution + vault/manual-execution and persists execution
    // evidence. Direct Done/Already did remains fail-closed here: Run is not
    // equivalent to an occurrence outcome, and cross-client completion
    // projection is not guessed.
    case 'system':
    case 'routine':
      return 'unsupported';

    default:
      return 'response_only';
  }
}
