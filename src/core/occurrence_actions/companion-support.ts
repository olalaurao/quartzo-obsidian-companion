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

    // System and Routine completion also owns execution evidence. That adapter
    // is implemented in the later Systems/Routines milestone, so fail closed
    // instead of recording only half of the canonical mutation.
    case 'system':
    case 'routine':
      return 'unsupported';

    default:
      return 'response_only';
  }
}
