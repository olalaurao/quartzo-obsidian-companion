import { describe, expect, it } from 'vitest';
import {
  GOOGLE_CALENDAR_READONLY_SCOPE,
  GOOGLE_COMPANION_SCOPES,
  GOOGLE_DRIVE_SCOPE,
} from '../../src/integrations/google/auth/scopes';

describe('Google Companion OAuth scopes', () => {
  it('uses Drive plus least-privilege Calendar read-only access', () => {
    expect(GOOGLE_COMPANION_SCOPES).toEqual([
      GOOGLE_DRIVE_SCOPE,
      GOOGLE_CALENDAR_READONLY_SCOPE,
    ]);
    expect(GOOGLE_COMPANION_SCOPES).not.toContain('https://www.googleapis.com/auth/calendar');
  });
});
