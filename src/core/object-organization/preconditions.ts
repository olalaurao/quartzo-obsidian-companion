/**
 * Operation preconditions (§8)
 *
 * Before any Apply, all preconditions must hold.
 * A stale preview must never authorize overwriting newer state.
 */

import type { QuartzoSharedSettings } from '../shared-settings';

export interface OperationPreconditionResult {
  valid: boolean;
  failedChecks: OperationPreconditionFailure[];
}

export interface OperationPreconditionFailure {
  kind: PreconditionFailureKind;
  message: string;
  /** Path or object ID that caused the failure, for diagnostic display */
  subject?: string;
}

export type PreconditionFailureKind =
  | 'settings_revision_changed'
  | 'object_id_mismatch'
  | 'source_path_missing'
  | 'hash_changed'
  | 'destination_appeared'
  | 'survivor_missing'
  | 'loser_missing'
  | 'concurrent_migration';

/**
 * Check that the settings revision used at plan time still matches the current state.
 * §8: settings revision must still be valid at Apply time.
 */
export function checkSettingsRevision(
  plannedRevision: number,
  current: QuartzoSharedSettings | null,
): OperationPreconditionFailure | null {
  if (!current) {
    return {
      kind: 'settings_revision_changed',
      message: 'Shared Object Identification settings are unavailable. Cannot apply.',
    };
  }
  const currentRevision = current.objectIdentification?.revision ?? 0;
  if (currentRevision !== plannedRevision) {
    return {
      kind: 'settings_revision_changed',
      message: `Object Identification changed (revision ${plannedRevision} → ${currentRevision}). Refresh preview before applying.`,
    };
  }
  return null;
}

/**
 * Check that a source path still exists in the vault.
 * §8: source path must still be valid.
 */
export function checkSourceExists(
  path: string,
  existingPaths: ReadonlySet<string>,
): OperationPreconditionFailure | null {
  const normalized = normalizePath(path);
  if (!existingPaths.has(normalized)) {
    return {
      kind: 'source_path_missing',
      message: `Source file no longer exists: ${path}`,
      subject: path,
    };
  }
  return null;
}

/**
 * Check that a hash/current Markdown matches the preview hash.
 * §8: hash must coincide with preview when necessary.
 */
export function checkContentHash(
  path: string,
  expectedMarkdown: string,
  currentMarkdown: string,
): OperationPreconditionFailure | null {
  if (currentMarkdown !== expectedMarkdown) {
    return {
      kind: 'hash_changed',
      message: `File changed since preview: ${path}`,
      subject: path,
    };
  }
  return null;
}

/**
 * Check that a destination path has not appeared since planning.
 * §8: destination must not have appeared.
 */
export function checkDestinationAbsent(
  destinationPath: string,
  existingPaths: ReadonlySet<string>,
): OperationPreconditionFailure | null {
  const normalized = normalizePath(destinationPath);
  if (existingPaths.has(normalized)) {
    return {
      kind: 'destination_appeared',
      message: `Destination appeared since preview: ${destinationPath}`,
      subject: destinationPath,
    };
  }
  return null;
}

/**
 * Check that no concurrent structural migration is in progress for the same type.
 * §11: second client cannot start incompatible migration during active transition.
 */
export function checkNoConcurrentMigration(
  objectType: string,
  current: QuartzoSharedSettings | null,
): OperationPreconditionFailure | null {
  const transition = current?.objectIdentification?.transition;
  if (!transition) return null;
  if (
    transition.objectType === objectType &&
    transition.phase !== 'failed'
  ) {
    return {
      kind: 'concurrent_migration',
      message: `A structural migration for "${objectType}" is already in progress (phase: ${transition.phase}). Wait for it to complete.`,
      subject: objectType,
    };
  }
  return null;
}

/**
 * Aggregate multiple precondition checks into a single result.
 */
export function aggregatePreconditions(
  failures: Array<OperationPreconditionFailure | null>,
): OperationPreconditionResult {
  const failedChecks = failures.filter((f): f is OperationPreconditionFailure => f !== null);
  return {
    valid: failedChecks.length === 0,
    failedChecks,
  };
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}
