export const GOOGLE_REFRESH_TOKEN_SECRET_ID = 'quartzo-companion-refresh-token';
export const GOOGLE_OAUTH_CLIENT_SECRET_ID = 'quartzo-companion-oauth-client-secret';

const OBSIDIAN_SECRET_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export function assertValidObsidianSecretId(id: string): string {
  if (!OBSIDIAN_SECRET_ID_PATTERN.test(id)) {
    throw new Error(`Invalid Obsidian SecretStorage ID: ${id}`);
  }
  return id;
}

for (const id of [GOOGLE_REFRESH_TOKEN_SECRET_ID, GOOGLE_OAUTH_CLIENT_SECRET_ID]) {
  assertValidObsidianSecretId(id);
}
