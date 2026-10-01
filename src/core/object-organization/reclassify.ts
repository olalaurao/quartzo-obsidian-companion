/**
 * Reclassify Planner (§19, §20, §21, §22)
 *
 * Pure planner that computes the mutations required to make an object
 * satisfy a target TypeSignature, without changing the rule itself.
 */

import { generateOperationId } from './operation-id';
import {
  checkContentHash,
  checkNoConcurrentMigration,
  checkSettingsRevision,
  checkSourceExists,
  type OperationPreconditionFailure,
} from './preconditions';
import {
  applyTypeSignature,
  identifyObjectFromSignatures,
  normalizeSharedFolder,
  type QuartzoSharedSettings,
  type TypeSignature,
} from '../shared-settings';
import { ObjectParser } from '../objects';

export interface ReclassifyPlanInput {
  objectId: string;
  targetType: string;
  sourcePath: string;
  sourceMarkdown: string;
  sourceFrontmatter: Record<string, unknown>;
  sourceBody: string;
  settingsRevision: number;
  settings: QuartzoSharedSettings;
  existingVaultPaths: ReadonlySet<string>;
}

export interface ReclassifyPlan {
  operationId: string;
  kind: 'reclassify';
  objectId: string;
  targetType: string;
  baseSettingsRevision: number;
  sourcePath: string;
  destinationPath: string;
  moves: boolean;
  expectedMarkdown: string;
  newMarkdown: string;
  blockers: OperationPreconditionFailure[];
  warnings: string[];
  identificationChanges: { action: 'remove' | 'apply'; signature: string }[];
}

/**
 * Plans a reclassify operation.
 * §20: Reclassify is NOT blindly setting `type`. It removes competing canonical markers
 * and applies the target TypeSignature marker.
 */
export function planReclassify(input: ReclassifyPlanInput): ReclassifyPlan {
  const {
    objectId,
    targetType,
    sourcePath,
    sourceMarkdown,
    sourceFrontmatter,
    sourceBody,
    settingsRevision,
    settings,
    existingVaultPaths,
  } = input;

  const operationId = generateOperationId('reclassify', { objectId, targetType });
  const canonicalTargetType = canonicalProductType(settings, targetType);
  const targetSignature = settings.typeSignatures[canonicalTargetType] as TypeSignature | undefined;

  const blockers: OperationPreconditionFailure[] = [];
  const warnings: string[] = [];
  const identificationChanges: { action: 'remove' | 'apply'; signature: string }[] = [];

  // 1. Preflight checks
  const revisionCheck = checkSettingsRevision(settingsRevision, settings);
  if (revisionCheck) blockers.push(revisionCheck);

  const migrationCheck = checkNoConcurrentMigration(canonicalTargetType, settings);
  if (migrationCheck) blockers.push(migrationCheck);

  const existsCheck = checkSourceExists(sourcePath, existingVaultPaths);
  if (existsCheck) blockers.push(existsCheck);

  if (!targetSignature) {
    blockers.push({
      kind: 'survivor_missing',
      message: `Target type "${targetType}" is not configured in Object Identification.`,
      subject: targetType,
    });
  }

  // 2. Identify competing markers
  const currentIdentification = identifyObjectFromSignatures(settings, sourcePath, sourceFrontmatter, sourceBody);
  let nextFrontmatter = { ...sourceFrontmatter };
  let nextBody = sourceBody;

  for (const match of currentIdentification.matchedSignatures) {
    if (match.objectType === canonicalTargetType) continue; // Keep markers that already align

    // §20: Remove competing canonical markers
    if (match.markerType === 'property') {
      const sep = match.markerValue.indexOf(':');
      if (sep >= 0) {
        const key = match.markerValue.slice(0, sep).trim();
        delete nextFrontmatter[key];
      } else {
        const key = match.markerValue.trim();
        delete nextFrontmatter[key];
      }
      identificationChanges.push({ action: 'remove', signature: match.source });
    } else if (match.markerType === 'tag') {
      const tag = match.markerValue.trim();
      const regex = new RegExp(`(^|\\s)${tag}(\\s|$)`, 'g');
      nextBody = nextBody.replace(regex, ' ').trim();
      identificationChanges.push({ action: 'remove', signature: match.source });
    }
  }

  // 3. Apply target marker
  let destinationPath = sourcePath;
  if (targetSignature) {
    const applied = applyTypeSignature(nextFrontmatter, nextBody, targetSignature);
    nextFrontmatter = applied.frontmatter;
    nextBody = applied.body;
    
    // §20: Ensure ID is present for previously unidentified markdown
    if (!nextFrontmatter.id) {
       nextFrontmatter.id = objectId;
    }

    if (targetSignature.markerType === 'folder') {
      const folder = normalizeSharedFolder(targetSignature.markerValue);
      const filename = sourcePath.split('/').pop()!;
      destinationPath = folder ? `${folder}/${filename}` : filename;
    }
    
    // Check if it already satisfied the marker
    const alreadySatisfied = currentIdentification.matchedSignatures.some(
      m => m.objectType === canonicalTargetType && m.markerType === targetSignature.markerType && m.markerValue === targetSignature.markerValue
    );
    if (!alreadySatisfied) {
       const sourceDesc = targetSignature.markerType === 'folder' 
          ? `Folder \`${targetSignature.markerValue}\``
          : targetSignature.markerType === 'tag' 
             ? `Tag \`${targetSignature.markerValue.startsWith('#') ? targetSignature.markerValue : '#' + targetSignature.markerValue}\``
             : `Property \`${targetSignature.markerValue}\``;
       identificationChanges.push({ action: 'apply', signature: sourceDesc });
    }
  }

  const moves = sourcePath !== destinationPath;
  if (moves) {
    const destNormalized = destinationPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (existingVaultPaths.has(destNormalized)) {
      blockers.push({
        kind: 'destination_appeared',
        message: `Cannot move to ${destinationPath} because a file already exists there.`,
        subject: destinationPath,
      });
    }
  }

  return {
    operationId,
    kind: 'reclassify',
    objectId,
    targetType,
    baseSettingsRevision: settingsRevision,
    sourcePath,
    destinationPath,
    moves,
    expectedMarkdown: sourceMarkdown,
    newMarkdown: ObjectParser.serializeMarkdown(nextFrontmatter, nextBody),
    blockers,
    warnings,
    identificationChanges,
  };
}
