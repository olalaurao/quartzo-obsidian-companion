/**
 * VaultSyncFilePolicy - Canonical source of truth for file sync eligibility
 * 
 * This policy defines exactly which files and directories should be synced
 * according to the Sync Protocol/Vault Interop Contract.
 */

export class VaultSyncFilePolicy {
  /**
   * Determine if a file should be synced
   */
  static shouldSyncFile(filePath: string): boolean {
    // Never sync sync state files
    if (filePath.includes('.quartzo-sync-state.json')) {
      return false;
    }

    // Never sync conflict artifacts
    if (filePath.endsWith('.conflict')) {
      return false;
    }
    if (filePath.endsWith('.conflict.json')) {
      return false;
    }
    if (filePath.endsWith('.local')) {
      return false;
    }
    if (filePath.endsWith('.remote')) {
      return false;
    }

    // Never sync Obsidian config
    if (filePath.includes('.obsidian')) {
      return false;
    }

    // Never sync .DS_Store
    if (filePath.includes('.DS_Store')) {
      return false;
    }

    // Never sync .git directory
    if (filePath.includes('.git')) {
      return false;
    }

    // Never sync node_modules
    if (filePath.includes('node_modules')) {
      return false;
    }

    // Sync markdown files
    if (filePath.endsWith('.md')) {
      return true;
    }

    // Sync base files
    if (filePath.endsWith('.base')) {
      return true;
    }

    // Sync attachments in _attachments directory
    if (filePath.includes('_attachments')) {
      return true;
    }

    // Sync files in _deleted directory (for deletion tracking)
    if (filePath.includes('_deleted')) {
      return true;
    }

    // Default: don't sync unknown file types
    return false;
  }

  /**
   * Determine if a directory should be scanned for sync
   */
  static shouldSyncDirectory(dirPath: string): boolean {
    // Never scan .obsidian directory
    if (dirPath.includes('.obsidian')) {
      return false;
    }

    // Never scan .git directory
    if (dirPath.includes('.git')) {
      return false;
    }

    // Never scan node_modules
    if (dirPath.includes('node_modules')) {
      return false;
    }

    // Scan _deleted directory (for deletion tracking)
    if (dirPath.includes('_deleted')) {
      return true;
    }

    // Scan _attachments directory
    if (dirPath.includes('_attachments')) {
      return true;
    }

    // Default: scan directory
    return true;
  }

  /**
   * Get all file extensions that should be synced
   */
  static getSyncedExtensions(): string[] {
    return ['.md', '.base'];
  }

  /**
   * Get all directory patterns that should be synced
   */
  static getSyncedDirectoryPatterns(): string[] {
    return ['_attachments', '_deleted'];
  }

  /**
   * Get all directory patterns that should be excluded
   */
  static getExcludedDirectoryPatterns(): string[] {
    return ['.obsidian', '.git', 'node_modules'];
  }

  /**
   * Get all file patterns that should be excluded
   */
  static getExcludedFilePatterns(): string[] {
    return ['.quartzo-sync-state.json', '.DS_Store', '.conflict', '.conflict.json', '.local', '.remote'];
  }
}
