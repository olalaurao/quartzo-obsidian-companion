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
  '_deleted',
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

/**
 * VaultSyncFilePolicy - Canonical source of truth for file sync eligibility.
 * Uses normalized vault-relative paths with '/' separators.
 * Segment-based exclusion prevents false positives like _backups/foo.md matching .md.
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
