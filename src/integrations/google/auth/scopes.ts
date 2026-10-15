export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export const GOOGLE_COMPANION_SCOPES = [
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
] as const;

export function googleConnectionScopes(purpose: 'drive' | 'calendar'): string[] {
  return ['openid', 'email', purpose === 'drive' ? GOOGLE_DRIVE_SCOPE : GOOGLE_CALENDAR_READONLY_SCOPE];
}
