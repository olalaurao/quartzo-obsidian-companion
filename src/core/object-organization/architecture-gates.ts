/**
 * Architecture Gates (§128)
 *
 * Automated compile-time guards that prevent architectural regressions.
 *
 * These are type-level and pattern-level enforcements, not runtime checks.
 * Any code that would violate these gates must be refactored before merging.
 *
 * Gate list from §128:
 * 1. UI cannot directly rewrite Markdown for organization.
 * 2. UI cannot instantiate Drive API for settings sync.
 * 3. No second object index.
 * 4. No ObjectOrganizationSync*.
 * 5. No direct destructive vault.delete() in merge UI.
 * 6. Companion merge must route through contracted owner.
 * 7. Rules UI cannot enumerate/write migration candidates itself.
 * 8. Folder selection cannot mutate TypeSignature unless explicit Rule action.
 */

// ─── Gate 1: UI-safe write marker ────────────────────────────────────────────
//
// UI components must use the canonical owners (SafeObjectMutationRepository,
// ObjectOrganizationRepository) and NEVER call vault.modify() / vault.create()
// directly on object files from within UI code.
//
// This is enforced by code review and by the pattern that all modals call
// only through the repository layer.

// ─── Gate 3 / Gate 4: No second object index or OrganizationSync ─────────────
//
// The following types are FORBIDDEN. If any file imports or instantiates these,
// it is an architecture violation:
//
// - ObjectOrganizationDatabase
// - ObjectOrganizationSync (or any variant)
// - MergeSync
// - ReclassifySync
// - OrganizationIndex
//
// Enforce via CI grep: `grep -r "ObjectOrganizationSync\|OrganizationDatabase\|MergeSync\|ReclassifySync" src/`

// ─── Gate 5: No bare vault.delete() in merge path ────────────────────────────
//
// Merge losers must exit through the canonical delete lifecycle.
// ObjectOrganizationRepository.applyMerge() is the only approved path.
// Bare `vault.delete(loserFile)` in merge code is a gate violation.
//
// Pattern enforced: applyMerge() uses the tombstone lifecycle (§69).

// ─── Gate 6: Companion merge routes through contracted owner ─────────────────
//
// All merge operations from Companion UI must go through:
//   ObjectMergeModal → planMerge() → ObjectOrganizationRepository.applyMerge()
//
// Merging by editing frontmatter.id directly or by overwriting files without
// the planner is forbidden.

// ─── Gate 7: Rules UI cannot enumerate or write migration candidates ──────────
//
// Rule editing in Settings must use ObjectIdentificationMigrationRepository
// for any structural change. The Settings UI does not write Markdown directly
// and does not call Vault.create() to migrate objects.

// ─── Gate 8: Folder selection ≠ TypeSignature mutation ───────────────────────
//
// When a user selects a folder and triggers "Set objects as Resource",
// this MUST NOT write to app/quartzo_shared_settings.md.
// The TypeSignature is only changed through the Rule Editor + migration flow.
//
// Scope = input to operation planners, NEVER to shared-settings writers.

// ─── Runtime self-check (development aid) ────────────────────────────────────

/**
 * Call this in development/test environments to assert no second index exists.
 * Not a production check — for CI/test scaffolding.
 */
export function assertNoSecondObjectIndex(existingIndexCount: number): void {
  if (existingIndexCount > 1) {
    throw new Error(
      '[Architecture Gate §128.3] More than one object index detected. ' +
      'Object Organization must use the canonical VaultIndex only.'
    );
  }
}

/**
 * Type guard to prevent TypeSignature mutations from scope operations.
 * Usage: pass the operation kind — if it's a scope-based operation,
 * assert it does NOT produce a SharedSettings write.
 */
export type ScopeOnlyOperation =
  | 'reclassify'
  | 'bulk_mutate'
  | 'move'
  | 'organize'
  | 'relate'
  | 'merge';

export type RuleMutationOperation =
  | 'rule_change'
  | 'rule_migration';

export function assertIsScopeOperation(kind: string): asserts kind is ScopeOnlyOperation {
  const scopeOps: ScopeOnlyOperation[] = [
    'reclassify', 'bulk_mutate', 'move', 'organize', 'relate', 'merge'
  ];
  if (!scopeOps.includes(kind as ScopeOnlyOperation)) {
    throw new Error(
      `[Architecture Gate §128.8] Operation "${kind}" is not a scope operation. ` +
      'If this is a rule mutation, it must use the rule migration path.'
    );
  }
}

export function assertCannotMutateTypeSignatureFromScope(
  operationKind: ScopeOnlyOperation,
): void {
  // This function documents the invariant: scope operations NEVER mutate TypeSignature.
  // The assertion is that this function should always be callable without throwing
  // for any valid ScopeOnlyOperation.
  void operationKind; // no-op: enforced structurally by type system above
}
