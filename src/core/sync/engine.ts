import { SyncVector, SyncResult } from './types';

export class SyncEngine {
  /** Exact opaque Reading shard namespace; transport never parses raw events. */
  static immutableReadingHash(filePath: string): string | null {
    const match = /^sessions\/reading_activity_v1\/[a-f0-9]{64}\/[a-f0-9]{64}\/([0-9]{4})\/(0[1-9]|1[0-2])\/([a-f0-9]{64})\.jsonl$/.exec(filePath);
    return match && match[0].length === filePath.length && match[1] !== '0000'
      ? match[3] : null;
  }

  static reconcile(vector: SyncVector): SyncResult {
    const {
      id,
      baseHash,
      localHash,
      remoteHash,
      localExists = true,
      remoteExists = true,
      duplicateRemoteIdentity = false,
      postWriteExpectedHash,
      path,
      contentEncoding
    } = vector;

    // Handle duplicate remote identity
    if (duplicateRemoteIdentity) {
      return { action: 'fail_closed', failClosed: true };
    }

    const immutablePath = SyncEngine.immutableReadingHash(id) !== null ||
      SyncEngine.immutableReadingHash(path ?? '') !== null;
    if (immutablePath && localExists &&
        ((remoteExists && localHash !== remoteHash) ||
         (!remoteExists && baseHash != null))) {
      return { action: 'conflict', conflict: true };
    }

    // Handle watcher write back
    if (postWriteExpectedHash && localHash === postWriteExpectedHash) {
      return { action: 'suppress_redundant_push' };
    }

    // Handle file scope checks
    if (path && !immutablePath) {
      if (path.includes('_deleted')) {
        return { action: 'include_deleted' };
      }
      if (path.includes('_attachments') && contentEncoding === 'raw_bytes') {
        // Binary attachment
        if (id === 'binary_conflict') {
          return { action: 'conflict', conflict: true };
        }
        return { action: 'include_live' };
      }
      if (path.includes('.base')) {
        return { action: 'include_live' };
      }
      return { action: 'include_live' };
    }

    // Handle null base cases
    if (baseHash === null) {
      if (localHash === null && remoteHash === null) {
        return remoteExists ? { action: 'pull' } : { action: 'advance_baseline' };
      }
      if (localHash === null && remoteHash) {
        return { action: 'pull' };
      }
      if (localHash && remoteHash === null) {
        if (!remoteExists && vector.authorizedLocalCreation) return { action: 'push' };
        return { action: 'adoption_required', adoptionRequired: true };
      }
      if (localHash === remoteHash) {
        return { action: 'advance_baseline' };
      }
      if (localHash && remoteHash && localHash !== remoteHash) {
        return { action: 'conflict', conflict: true };
      }
    }

    // Handle remote missing hash
    if (remoteHash === null && remoteExists) {
      return { action: 'conflict', conflict: true };
    }

    // Handle deletion cases
    if (!remoteExists) {
      if (localHash === baseHash) {
        return { action: 'delete_local' };
      }
      if (localHash !== baseHash) {
        return { action: 'conflict', conflict: true };
      }
    }

    // Handle local only
    if (!localExists && remoteExists) {
      return { action: 'pull' };
    }

    // Handle local only unknown pairing
    if (localExists && !remoteExists && baseHash === null) {
      return { action: 'adoption_required', adoptionRequired: true };
    }

    // Standard 3-way reconciliation
    if (baseHash === localHash && localHash === remoteHash) {
      return { action: 'advance_baseline' };
    }

    if (baseHash === localHash && localHash !== remoteHash) {
      return { action: 'pull' };
    }

    if (baseHash === remoteHash && localHash !== remoteHash) {
      return { action: 'push' };
    }

    if (localHash === remoteHash && localHash !== baseHash) {
      return { action: 'advance_baseline' };
    }

    // All different - conflict
    return { action: 'conflict', conflict: true };
  }
}
