/**
 * Canonical vault-relative path normalization.
 * Always uses '/' internally regardless of OS.
 */

export function normalizeVaultPath(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/^\//, '');
}

export function isSameVaultPath(a: string, b: string): boolean {
  return normalizeVaultPath(a) === normalizeVaultPath(b);
}

export function parentVaultPath(p: string): string {
  const normalized = normalizeVaultPath(p);
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.substring(0, idx) : '';
}

export function basename(p: string): string {
  const normalized = normalizeVaultPath(p);
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.substring(idx + 1) : normalized;
}
