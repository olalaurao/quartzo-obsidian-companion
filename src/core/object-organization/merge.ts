/**
 * Merge Planner (§57 - §72)
 *
 * Plans the consolidation of multiple object IDs into a single survivor,
 * rewriting references, and retiring losers safely.
 */

import { generateOperationId } from './operation-id';
import {
  checkSettingsRevision,
  checkNoConcurrentMigration,
  type OperationPreconditionFailure,
} from './preconditions';
import type { QuartzoSharedSettings } from '../shared-settings';
import { ObjectParser } from '../objects';
import { buildCanonicalRetirementTombstone } from './retire';

export type PropertyResolutionStrategy =
  | 'use_survivor'
  | 'use_loser'
  | 'union_dedupe'
  | 'explicit_choice';

export interface PropertyResolution {
  field: string;
  strategy: PropertyResolutionStrategy;
  chosenValue?: unknown;
}

export interface MergePlanInput {
  survivorId: string;
  survivorMarkdown: string;
  survivorPath: string;
  targetType: string;
  losers: Array<{
    id: string;
    path: string;
    markdown: string;
  }>;
  propertyResolutions: PropertyResolution[];
  bodyResolution: 'keep_survivor' | 'combine' | 'custom';
  customBody?: string;
  settingsRevision: number;
  settings: QuartzoSharedSettings;
}

export interface MergeActionPlan {
  survivorPath: string;
  expectedSurvivorMarkdown: string;
  newSurvivorMarkdown: string;
  losersToRetire: Array<{
    id: string;
    path: string;
    expectedMarkdown: string;
    newMarkdown: string;
  }>;
}

export interface MergePlan {
  operationId: string;
  kind: 'merge';
  baseSettingsRevision: number;
  action: MergeActionPlan;
  blockers: OperationPreconditionFailure[];
  warnings: string[];
}

/**
 * Plans a Merge operation.
 * Merge is ID-based. Survivor is explicit. Cross-type merge requires explicit target type.
 * Losers are NOT deleted with `vault.delete()`; they use the canonical retirement tombstone (§69).
 */
export function planMerge(input: MergePlanInput): MergePlan {
  const {
    survivorId,
    survivorMarkdown,
    survivorPath,
    targetType,
    losers,
    propertyResolutions,
    bodyResolution,
    customBody,
    settingsRevision,
    settings,
  } = input;

  const operationId = generateOperationId('merge', {
    survivorId,
    targetType,
    losers: losers.map(l => l.id).sort(),
  });

  const blockers: OperationPreconditionFailure[] = [];
  const warnings: string[] = [];

  const revisionCheck = checkSettingsRevision(settingsRevision, settings);
  if (revisionCheck) blockers.push(revisionCheck);

  const migrationCheck = checkNoConcurrentMigration(targetType, settings);
  if (migrationCheck) blockers.push(migrationCheck);

  if (losers.some(l => l.id === survivorId)) {
    blockers.push({
      kind: 'survivor_missing',
      message: 'Survivor ID cannot also be in the losers list.',
      subject: survivorId,
    });
  }

  const survivorParsed = ObjectParser.parseMarkdown(survivorMarkdown);
  const nextFrontmatter = { ...survivorParsed.frontmatter };
  let nextBody = survivorParsed.body;

  for (const res of propertyResolutions) {
    if (res.strategy === 'use_survivor') {
      continue;
    } else if (res.strategy === 'explicit_choice' || res.strategy === 'use_loser') {
      if (res.chosenValue === undefined) {
        delete nextFrontmatter[res.field];
      } else {
        nextFrontmatter[res.field] = res.chosenValue;
      }
    } else if (res.strategy === 'union_dedupe') {
      const collected = new Set<string>();

      const addValues = (val: unknown) => {
        if (Array.isArray(val)) val.forEach(v => collected.add(String(v)));
        else if (val) collected.add(String(val));
      };

      addValues(survivorParsed.frontmatter[res.field]);
      for (const loser of losers) {
        const lp = ObjectParser.parseMarkdown(loser.markdown);
        addValues(lp.frontmatter[res.field]);
      }

      nextFrontmatter[res.field] = Array.from(collected);
    }
  }

  if (bodyResolution === 'custom' && customBody !== undefined) {
    nextBody = customBody;
  } else if (bodyResolution === 'combine') {
    for (const loser of losers) {
      const lp = ObjectParser.parseMarkdown(loser.markdown);
      if (lp.body.trim()) {
        nextBody += `\n\n--- Content from ${loser.id} ---\n\n${lp.body.trim()}`;
      }
    }
  }

  nextFrontmatter.type = targetType;

  const newSurvivorMarkdown = ObjectParser.serializeMarkdown(nextFrontmatter, nextBody);

  const deletedAt = new Date().toISOString();
  const losersToRetire = losers.map(loser => ({
    id: loser.id,
    path: loser.path,
    expectedMarkdown: loser.markdown,
    newMarkdown: buildCanonicalRetirementTombstone({
      id: loser.id,
      deletedAt,
      mergedInto: survivorId,
    }),
  }));

  return {
    operationId,
    kind: 'merge',
    baseSettingsRevision: settingsRevision,
    action: {
      survivorPath,
      expectedSurvivorMarkdown: survivorMarkdown,
      newSurvivorMarkdown,
      losersToRetire,
    },
    blockers,
    warnings,
  };
}
