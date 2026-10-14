import { describe, expect, it } from 'vitest';
import { resolveGoogleOAuthClientSecret } from '../../src/platform/google-oauth-credentials';

describe('Google OAuth client secret resolution', () => {
  it('prefers the build credential and falls back to Obsidian SecretStorage', () => {
    expect(resolveGoogleOAuthClientSecret('build-secret', 'stored-secret')).toBe('build-secret');
    expect(resolveGoogleOAuthClientSecret('', 'stored-secret')).toBe('stored-secret');
  });

  it('omits an unset client secret so OAuth can report missing configuration clearly', () => {
    expect(resolveGoogleOAuthClientSecret('', null)).toBeUndefined();
  });
});
