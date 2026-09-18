import { normalizeVaultPath } from './path-utils';

/**
 * Canonical excluded directory segments.
 * Applied as exact path-segment matches against normalized vault-relative paths.
 */
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  '.git',
  '.trash',
  '_backups',
  '_conflicts',
  '_diagnostics',
  '_cache',
  'node_modules',
]);

/**
 * File suffixes that are always excluded regardless of directory.
 */
const EXCLUDED_FILE_SUFFIXES = [
  '.quartzo-sync-state.json',
  '.DS_Store',
  '.conflict',
  '.conflict.json',
  '.local',
  '.remote',
];

const CANONICAL_TEXT_EXTENSIONS = ['.md', '.base'];
const CANONICAL_BINARY_ROOTS = new Set(['_attachments', '_deleted']);
const GOOGLE_WORKSPACE_MIME_PREFIX = 'application/vnd.google-apps.';

/**
 * VaultSyncFilePolicy - Canonical source of truth for file sync eligibility.
 * Uses normalized vault-relative paths with '/' separators.
 *
 * The sync contract is an allow-list, not merely a deny-list:
 * - Markdown and Bases are canonical anywhere outside excluded directories.
 * - _attachments/** and _deleted/** may contain arbitrary raw-byte files.
 * - unrelated Drive sidecars (for example Finance's Google Sheet) are not
 *   Obsidian-vault content and must never enter pairing/reconciliation.
 */
export class VaultSyncFilePolicy {
  static shouldSyncFile(rawPath: string): boolean {
    const filePath = normalizeVaultPath(rawPath);

    for (const suffix of EXCLUDED_FILE_SUFFIXES) {
      if (filePath.endsWith(suffix)) return false;
    }

    const segments = filePath.split('/');
    for (const seg of segments) {
      if (EXCLUDED_DIRS.has(seg)) return false;
    }

    const lowerPath = filePath.toLowerCase();
    if (CANONICAL_TEXT_EXTENSIONS.some(extension => lowerPath.endsWith(extension))) {
      return true;
    }

    return segments.length > 1 && CANONICAL_BINARY_ROOTS.has(segments[0]);
  }

  static shouldSyncRemoteFile(rawPath: string, mimeType: string | null | undefined): boolean {
    if (!this.shouldSyncFile(rawPath)) return false;
    if (mimeType?.startsWith(GOOGLE_WORKSPACE_MIME_PREFIX)) return false;
    return true;
  }

  static shouldSyncDirectory(rawPath: string): boolean {
    const dirPath = normalizeVaultPath(rawPath);

    const segments = dirPath.split('/');
    for (const seg of segments) {
      if (EXCLUDED_DIRS.has(seg)) return false;
    }

    return true;
  }

  static getExcludedDirectories(): string[] {
    return Array.from(EXCLUDED_DIRS);
  }

  static getExcludedFileSuffixes(): string[] {
    return [...EXCLUDED_FILE_SUFFIXES];
  }
}
