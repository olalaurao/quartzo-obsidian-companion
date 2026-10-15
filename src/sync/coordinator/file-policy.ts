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
  'crash_reports',
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

const GOOGLE_WORKSPACE_MIME_PREFIX = 'application/vnd.google-apps.';

/** Protocol 1.2: transport regular vault content as bytes, excluding device-local and temporary data. */
export class VaultSyncFilePolicy {
  static shouldSyncFile(rawPath: string): boolean {
    const filePath = normalizeVaultPath(rawPath);

    for (const suffix of EXCLUDED_FILE_SUFFIXES) {
      if (filePath.toLowerCase().endsWith(suffix.toLowerCase())) return false;
    }

    if (!filePath || filePath.includes('\0')) return false;
    const segments = filePath.split('/');
    for (const seg of segments) {
      if (seg === '.' || seg === '..' || EXCLUDED_DIRS.has(seg.toLowerCase())) return false;
    }
    const name = segments[segments.length - 1].toLowerCase();
    if (['.ds_store', 'thumbs.db', 'desktop.ini'].includes(name) ||
        name.startsWith('.#') || name.endsWith('~') ||
        ['.tmp', '.temp', '.swp'].some(suffix => name.endsWith(suffix))) return false;
    return true;
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
      if (EXCLUDED_DIRS.has(seg.toLowerCase()) || seg === '..' || seg === '.') return false;
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
