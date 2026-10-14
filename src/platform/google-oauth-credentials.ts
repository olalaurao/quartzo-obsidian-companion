export function resolveGoogleOAuthClientSecret(buildSecret: string, storedSecret: string | null): string | undefined {
  return buildSecret || storedSecret || undefined;
}
