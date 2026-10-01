/**
 * Organize Planner (§32, §33, §34, §35)
 *
 * A composite operation that plans reclassify + move + bulk properties
 * + relationships across a resolved scope.
 */

import { generateOperationId } from './operation-id';
import {
  checkDestinationAbsent,
  checkNoConcurrentMigration,
  checkSettingsRevision,
  checkSourceExists,
  type OperationPreconditionFailure,
} from './preconditions';
import { planReclassify, type ReclassifyPlan } from './reclassify';
import type { ResolvedOrganizationScope } from './scope-resolver';
import type { QuartzoSharedSettings } from '../shared-settings';
import { ObjectParser } from '../objects';

export type PropertyOperationKind = 'set' | 'add' | 'remove' | 'clear' | 'leave_unchanged';

export interface PropertyOperation {
  kind: PropertyOperationKind;
  key: string;
  value?: string | string[];
}

export interface OrganizePlanInput {
  scope: ResolvedOrganizationScope;
  targetType?: string;
  destinationFolder?: string;
  propertyOperations?: PropertyOperation[];
  settingsRevision: number;
  settings: QuartzoSharedSettings;
  /**
   * Canonical object identity resolved by the caller from the VaultIndex or the
   * platform ID owner. This lets ordinary Markdown receive one stable ID during
   * preview instead of inventing an empty or per-render identity.
   */
  objectIdsByPath?: ReadonlyMap<string, string>;
  vaultState: {
    paths: ReadonlySet<string>;
    /** Exact current Markdown bytes used by the stale-preview precondition. */
    readMarkdown: (path: string) => string | undefined;
  };
}

export interface OrganizeActionPlan {
  sourcePath: string;
  destinationPath: string;
  moves: boolean;
  expectedMarkdown: string;
  newMarkdown: string;
  identificationChanges: { action: 'remove' | 'apply'; signature: string }[];
  propertyChanges: { key: string; action: string; before?: unknown; after?: unknown }[];
}

export interface OrganizePlan {
  operationId: string;
  kind: 'organize';
  scope: ResolvedOrganizationScope;
  targetType?: string;
  baseSettingsRevision: number;
  actions: OrganizeActionPlan[];
  blockers: OperationPreconditionFailure[];
  warnings: string[];
}

export function planOrganize(input: OrganizePlanInput): OrganizePlan {
  const {
    scope,
    targetType,
    destinationFolder,
    propertyOperations = [],
    settingsRevision,
    settings,
    objectIdsByPath,
    vaultState,
  } = input;

  const operationId = generateOperationId('organize', {
    targetType,
    destinationFolder,
    propertyOperations,
    scopeFiles: scope.eligibleMarkdownPaths.slice(0, 100), // fingerprint first 100 for stability
  });

  const blockers: OperationPreconditionFailure[] = [];
  const warnings: string[] = [];
  const actions: OrganizeActionPlan[] = [];

  const revisionCheck = checkSettingsRevision(settingsRevision, settings);
  if (revisionCheck) blockers.push(revisionCheck);

  if (targetType) {
    const migrationCheck = checkNoConcurrentMigration(targetType, settings);
    if (migrationCheck) blockers.push(migrationCheck);
  }

  // To prevent multiple items from moving to the exact same destination if there is a collision
  const claimedDestinations = new Map<string, string>();

  for (const path of scope.eligibleMarkdownPaths) {
    const existsCheck = checkSourceExists(path, vaultState.paths);
    if (existsCheck) {
      blockers.push(existsCheck);
      continue;
    }

    const currentMarkdown = vaultState.readMarkdown(path);
    if (currentMarkdown === undefined) {
      blockers.push({
        kind: 'source_path_missing',
        message: `Could not read source file: ${path}`,
        subject: path,
      });
      continue;
    }

    let parsed: ReturnType<typeof ObjectParser.parseMarkdown>;
    try {
      parsed = ObjectParser.parseMarkdown(currentMarkdown);
    } catch (error) {
      blockers.push({
        kind: 'object_id_mismatch',
        message: `Could not safely parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
        subject: path,
      });
      continue;
    }

    const parsedId = typeof parsed.frontmatter.id === 'string'
      ? parsed.frontmatter.id.trim()
      : String(parsed.frontmatter.id ?? '').trim();
    const objectId = parsedId || objectIdsByPath?.get(path)?.trim() || '';

    if (targetType && !objectId) {
      blockers.push({
        kind: 'object_id_mismatch',
        message: `Cannot set a Quartzo type for ${path} without a canonical object ID. Refresh the preview and try again.`,
        subject: path,
      });
      continue;
    }

    // 1. Reclassify if requested
    let reclassifyPlan: ReclassifyPlan | undefined;
    if (targetType) {
      reclassifyPlan = planReclassify({
        objectId,
        targetType,
        sourcePath: path,
        sourceMarkdown: currentMarkdown,
        sourceFrontmatter: parsed.frontmatter,
        sourceBody: parsed.body,
        settingsRevision,
        settings,
        existingVaultPaths: vaultState.paths,
      });
      blockers.push(...reclassifyPlan.blockers);
      warnings.push(...reclassifyPlan.warnings);
    }

    // 2. Compute current active frontmatter/body
    const reclassified = reclassifyPlan
      ? ObjectParser.parseMarkdown(reclassifyPlan.newMarkdown)
      : null;
    const currentFrontmatter = reclassified
      ? { ...reclassified.frontmatter }
      : { ...parsed.frontmatter };
    const currentBody = reclassified?.body ?? parsed.body;

    // 3. Apply Bulk Properties
    const propertyChanges: OrganizeActionPlan['propertyChanges'] = [];
    for (const op of propertyOperations) {
      if (op.kind === 'leave_unchanged') continue;
      if (!op.key.trim()) {
        blockers.push({
          kind: 'object_id_mismatch',
          message: `Property operation for ${path} has an empty property name.`,
          subject: path,
        });
        continue;
      }

      const before = currentFrontmatter[op.key];
      let after: unknown = before;

      if (op.kind === 'clear') {
        delete currentFrontmatter[op.key];
        after = undefined;
      } else if (op.kind === 'set') {
        currentFrontmatter[op.key] = op.value;
        after = op.value;
      } else if (op.kind === 'add' && op.value) {
        const valArr = Array.isArray(op.value) ? op.value : [op.value];
        const existing = Array.isArray(before) ? before : before ? [before] : [];
        const combined = [...existing];
        for (const v of valArr) {
          if (!combined.includes(v)) combined.push(v);
        }
        currentFrontmatter[op.key] = combined;
        after = combined;
      } else if (op.kind === 'remove' && op.value) {
        if (Array.isArray(before)) {
          const toRemove = Array.isArray(op.value) ? op.value : [op.value];
          after = before.filter(item => !toRemove.includes(String(item)));
          currentFrontmatter[op.key] = after;
        }
      }

      if (JSON.stringify(before) !== JSON.stringify(after)) {
        propertyChanges.push({ key: op.key, action: op.kind, before, after });
      }
    }

    // 4. Compute destination path
    let destinationPath = reclassifyPlan ? reclassifyPlan.destinationPath : path;
    if (destinationFolder) {
      const filename = destinationPath.split('/').pop()!;
      const folder = destinationFolder.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
      destinationPath = folder ? `${folder}/${filename}` : filename;
    }

    const moves = path !== destinationPath;
    if (moves) {
      const destAbsent = checkDestinationAbsent(destinationPath, vaultState.paths);
      if (destAbsent) blockers.push(destAbsent);

      const claimedBy = claimedDestinations.get(destinationPath.toLowerCase());
      if (claimedBy) {
        blockers.push({
          kind: 'destination_appeared',
          message: `Collision: both ${claimedBy} and ${path} are moving to ${destinationPath}`,
          subject: destinationPath,
        });
      } else {
        claimedDestinations.set(destinationPath.toLowerCase(), path);
      }
    }

    const newMarkdown = ObjectParser.serializeMarkdown(currentFrontmatter, currentBody);

    // Check if anything actually changes (skip no-ops)
    if (newMarkdown === currentMarkdown && !moves) {
      continue;
    }

    actions.push({
      sourcePath: path,
      destinationPath,
      moves,
      expectedMarkdown: currentMarkdown,
      newMarkdown,
      identificationChanges: reclassifyPlan ? reclassifyPlan.identificationChanges : [],
      propertyChanges,
    });
  }

  return {
    operationId,
    kind: 'organize',
    scope,
    targetType,
    baseSettingsRevision: settingsRevision,
    actions,
    blockers,
    warnings,
  };
}
