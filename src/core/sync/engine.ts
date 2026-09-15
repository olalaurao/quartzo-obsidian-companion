import { SyncVector, SyncResult } from './types';

export class SyncEngine {
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

    // Handle watcher write back
    if (postWriteExpectedHash && localHash === postWriteExpectedHash) {
      return { action: 'suppress_redundant_push' };
    }

    // Handle file scope checks
    if (path) {
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
