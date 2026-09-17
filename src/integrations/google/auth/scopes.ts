export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
export const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

export const GOOGLE_COMPANION_SCOPES = [
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_CALENDAR_READONLY_SCOPE,
] as const;
