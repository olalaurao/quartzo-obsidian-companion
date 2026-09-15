export interface SyncVector {
  id: string;
  baseHash?: string | null;
  localHash?: string | null;
  remoteHash?: string | null;
  localExists?: boolean;
  remoteExists?: boolean;
  duplicateRemoteIdentity?: boolean;
  postWriteExpectedHash?: string;
  path?: string;
  contentEncoding?: string;
  expected: string;
}

export interface SyncResult {
  action: string;
  conflict?: boolean;
  adoptionRequired?: boolean;
  failClosed?: boolean;
}

export interface SyncState {
  baseline: Record<string, string>; // path -> hash
  local: Record<string, string>; // path -> hash
  remote: Record<string, string>; // path -> hash
}
