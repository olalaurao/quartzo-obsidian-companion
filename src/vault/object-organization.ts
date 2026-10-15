import { TFile, Vault, normalizePath } from 'obsidian';
import type { OrganizePlan, OrganizeActionPlan } from '../core/object-organization/organize';
import type { MergePlan } from '../core/object-organization/merge';
import { mergeReferenceKeys, rewriteMergeWikiLinks } from '../core/object-organization/reference-rewrite';
import type { BatchCreatePlan, BatchOperationReport } from '../core/object-organization/batch-workbench';
import type { ActivityEvent } from '../core/activity-history';
import { ObjectParser } from '../core/objects';
import {
  buildCanonicalRetirementTombstone,
  canonicalRetirementPath,
} from '../core/object-organization/retire';
import { SharedSettingsRepository } from './shared-settings';
import { ActivityHistoryWriter } from './activity-history';

export interface ObjectOrganizationResult {
  migrated: number;
  remaining: number;
  failedPath?: string;
  error?: Error;
}

export interface CanonicalRetirementRequest {
  path: string;
  id: string;
  expectedMarkdown: string;
  deletedAt: string;
}

export interface CanonicalRetirementApplied {
  id: string;
  sourcePath: string;
  tombstonePath: string;
}

export interface CanonicalRetirementResult extends ObjectOrganizationResult {
  retired: CanonicalRetirementApplied[];
}

interface RetireFileInput {
  path: string;
  id: string;
  destinationPath?: string;
  expectedMarkdown: string;
  tombstoneMarkdown: string;
}

export class ObjectOrganizationRepository {
  private readonly activityWriter: ActivityHistoryWriter;

  constructor(
    private readonly vault: Vault,
    private readonly settingsRepo: SharedSettingsRepository,
  ) {
    this.activityWriter = new ActivityHistoryWriter(vault);
  }

  /**
   * Applies a planned composite Organize operation.
   * Runs the preconditions check (implicitly via settings version) and processes each action.
   * If an I/O error occurs, returns partial progress so the UI can recover (§81).
   */
  async applyOrganize(plan: OrganizePlan): Promise<ObjectOrganizationResult> {
    if (plan.blockers.length > 0) {
      throw new Error('Cannot apply operation with unresolved blockers.');
    }

    const currentSettings = await this.settingsRepo.load();
    if (!currentSettings) {
      throw new Error('Shared Quartzo settings are missing.');
    }
    const currentRevision = currentSettings.objectIdentification.revision;
    if (currentRevision !== plan.baseSettingsRevision) {
      throw new Error(
        `Object Identification revision conflict: expected ${plan.baseSettingsRevision}, found ${currentRevision}. Refresh preview before applying.`,
      );
    }

    let migrated = 0;

    for (const action of plan.actions) {
      try {
        await this.applyAction(action);
        if (action.moves) await this.appendMovedActivity(action, plan.operationId);
        migrated++;
      } catch (error) {
        return {
          migrated,
          remaining: plan.actions.length - migrated,
          failedPath: action.sourcePath,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }

    return { migrated, remaining: 0 };
  }

  private async applyAction(action: OrganizeActionPlan): Promise<void> {
    const source = this.vault.getAbstractFileByPath(action.sourcePath);
    if (!(source instanceof TFile)) {
      if (action.moves) {
        const dest = this.vault.getAbstractFileByPath(action.destinationPath);
        if (dest instanceof TFile) {
          const destContent = await this.vault.read(dest);
          if (destContent === action.newMarkdown) return;
        }
      }
      throw new Error(`Source file not found: ${action.sourcePath}`);
    }

    if (action.moves) {
      const dest = this.vault.getAbstractFileByPath(action.destinationPath);
      if (dest) {
        if (!(dest instanceof TFile)) {
          throw new Error(`Destination exists but is not a file: ${action.destinationPath}`);
        }
        const destContent = await this.vault.read(dest);
        if (destContent !== action.newMarkdown) {
          throw new Error(`Destination already exists: ${action.destinationPath}`);
        }
      }
    }

    if (action.newMarkdown !== action.expectedMarkdown) {
      await this.vault.process(source, current => {
        if (current !== action.expectedMarkdown) {
          if (current === action.newMarkdown) return current;
          throw new Error(`File changed since preview: ${action.sourcePath}`);
        }
        return action.newMarkdown;
      });
    }

    if (action.moves) {
      await this.ensureFolder(action.destinationPath);

      const sourceNow = this.vault.getAbstractFileByPath(action.sourcePath);
      if (!(sourceNow instanceof TFile)) {
        throw new Error(`Source file vanished before move: ${action.sourcePath}`);
      }

      try {
        await this.vault.rename(sourceNow, action.destinationPath);
      } catch (error) {
        throw new Error(`Failed to move file to ${action.destinationPath}: ${error}`);
      }
    }
  }

  /**
   * Canonically retires ordinary objects by converting each file to a tombstone and
   * moving it under _deleted/<object-id>.md. The rename is intentionally observable
   * by the existing sync watcher so a tracked remote keeps the same remoteFileId.
   */
  async applyRetirements(requests: readonly CanonicalRetirementRequest[]): Promise<CanonicalRetirementResult> {
    const retired: CanonicalRetirementApplied[] = [];

    for (const request of requests) {
      try {
        const tombstoneMarkdown = buildCanonicalRetirementTombstone({
          id: request.id,
          deletedAt: request.deletedAt,
        });
        const tombstonePath = await this.retireFile({
          path: request.path,
          id: request.id,
          expectedMarkdown: request.expectedMarkdown,
          tombstoneMarkdown,
        });
        retired.push({
          id: request.id,
          sourcePath: normalizePath(request.path),
          tombstonePath,
        });
        await this.appendRetiredActivity({
          id: request.id,
          sourcePath: request.path,
          tombstonePath,
          expectedMarkdown: request.expectedMarkdown,
          occurredAt: request.deletedAt,
        });
      } catch (error) {
        return {
          migrated: retired.length,
          remaining: requests.length - retired.length,
          failedPath: request.path,
          error: error instanceof Error ? error : new Error(String(error)),
          retired,
        };
      }
    }

    return {
      migrated: retired.length,
      remaining: 0,
      retired,
    };
  }

  /**
   * Applies a planned Merge operation.
   * Updates survivor and retires losers through the same canonical tombstone lifecycle.
   */
  async applyMerge(plan: MergePlan): Promise<void> {
    if (plan.blockers.length > 0) {
      throw new Error('Cannot apply merge with unresolved blockers.');
    }

    const currentSettings = await this.settingsRepo.load();
    if (!currentSettings) throw new Error('Shared Quartzo settings are missing.');
    if (currentSettings.objectIdentification.revision !== plan.baseSettingsRevision) {
      throw new Error('Object Identification revision conflict. Refresh preview before merging.');
    }

    const survivorPath = normalizePath(plan.action.survivorPath);
    const survivorFile = this.vault.getAbstractFileByPath(survivorPath);
    if (!(survivorFile instanceof TFile)) {
      throw new Error(`Survivor file missing: ${plan.action.survivorPath}`);
    }
    const originalSurvivor = await this.vault.read(survivorFile);
    if (originalSurvivor !== plan.action.expectedSurvivorMarkdown &&
        originalSurvivor !== plan.action.newSurvivorMarkdown) {
      throw new Error(`Survivor file changed since preview: ${plan.action.survivorPath}`);
    }

    const loserPaths = new Set(plan.action.losersToRetire.map(loser => normalizePath(loser.path)));
    const referenceKeys = new Set<string>();
    for (const loser of plan.action.losersToRetire) {
      for (const key of mergeReferenceKeys({
        id: loser.id,
        path: normalizePath(loser.path),
        markdown: loser.expectedMarkdown,
      })) {
        referenceKeys.add(key);
      }
    }

    const snapshots = new Map<string, string>([[survivorPath, originalSurvivor]]);
    const updates = new Map<string, { expected: string; next: string }>();
    const survivorWithReferences = rewriteMergeWikiLinks(
      plan.action.newSurvivorMarkdown,
      referenceKeys,
      survivorPath,
    );
    if (survivorWithReferences !== originalSurvivor) {
      updates.set(survivorPath, {
        expected: originalSurvivor,
        next: survivorWithReferences,
      });
    }

    for (const file of this.vault.getMarkdownFiles()) {
      const path = normalizePath(file.path);
      if (loserPaths.has(path) || path === survivorPath) continue;
      const markdown = await this.vault.read(file);
      const rewritten = rewriteMergeWikiLinks(markdown, referenceKeys, survivorPath);
      if (rewritten === markdown) continue;
      snapshots.set(path, markdown);
      updates.set(path, { expected: markdown, next: rewritten });
    }

    for (const loser of plan.action.losersToRetire) {
      snapshots.set(normalizePath(loser.path), loser.expectedMarkdown);
      const source = this.vault.getAbstractFileByPath(normalizePath(loser.path));
      if (!(source instanceof TFile) || await this.vault.read(source) !== loser.expectedMarkdown) {
        throw new Error(`Loser file changed since preview: ${loser.path}`);
      }
    }

    const attemptedRetirements: typeof plan.action.losersToRetire = [];
    try {
      for (const [path, update] of updates) {
        if (update.expected === update.next) continue;
        const file = this.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error(`Reference file disappeared: ${path}`);
        await this.vault.process(file, current => {
          if (current !== update.expected) {
            if (current === update.next) return current;
            throw new Error(`Reference file changed during merge: ${path}`);
          }
          return update.next;
        });
      }

      for (const loser of plan.action.losersToRetire) {
        attemptedRetirements.push(loser);
        const tombstonePath = await this.retireFile({
          path: loser.path,
          id: loser.id,
          destinationPath: loser.tombstonePath,
          expectedMarkdown: loser.expectedMarkdown,
          tombstoneMarkdown: loser.newMarkdown,
        });
        await this.appendRetiredActivity({
          id: loser.id,
          sourcePath: loser.path,
          tombstonePath,
          expectedMarkdown: loser.expectedMarkdown,
          operationId: plan.operationId,
        });
      }
    } catch (error) {
      for (const loser of attemptedRetirements.slice().reverse()) {
        await this.restoreMergeLoser(
          loser.path,
          loser.id,
          loser.tombstonePath,
          loser.expectedMarkdown,
          loser.newMarkdown,
        );
      }
      for (const [path, markdown] of snapshots) {
        if (loserPaths.has(path)) continue;
        const file = this.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.vault.process(file, () => markdown);
        }
      }
      throw error;
    }
  }

  private async restoreMergeLoser(
    path: string,
    id: string,
    destinationPath: string,
    original: string,
    tombstoneMarkdown: string,
  ): Promise<void> {
    const sourcePath = normalizePath(path);
    let source = this.vault.getAbstractFileByPath(sourcePath);
    const retiredPath = normalizePath(destinationPath || canonicalRetirementPath(id));
    let retired = this.vault.getAbstractFileByPath(retiredPath);
    if (!(source instanceof TFile) && retired instanceof TFile) {
      await this.vault.rename(retired, sourcePath);
      source = this.vault.getAbstractFileByPath(sourcePath);
      retired = null;
    }
    if (source instanceof TFile) {
      const current = await this.vault.read(source);
      if (current === tombstoneMarkdown || current !== original) {
        await this.vault.process(source, () => original);
      }
    }
  }

  async applyBatchCreate(plan: BatchCreatePlan): Promise<BatchOperationReport> {
    if (plan.blockers.length > 0) {
      throw new Error('Cannot apply batch create with unresolved blockers.');
    }

    let applied = 0;
    const messages: string[] = [];

    for (const action of plan.actions) {
      try {
        await this.ensureFolder(action.path);
        if (this.vault.getAbstractFileByPath(action.path)) {
          throw new Error(`Target already exists: ${action.path}`);
        }
        await this.vault.create(action.path, action.content);
        applied++;
        // The Markdown commit is durable even if its derived activity fails.
        // Report that warning without offering to recreate an existing object.
        try {
          await this.appendCreatedActivity(action.content, action.path);
        } catch (error) {
          messages.push(`${action.path}: created; activity update failed: ${String(error)}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        messages.push(`${action.path}: ${message}`);
        return {
          attempted: plan.actions.length,
          applied,
          skipped: plan.actions.length - applied - 1,
          failed: 1,
          failedPath: action.path,
          messages,
        };
      }
    }

    return {
      attempted: plan.actions.length,
      applied,
      skipped: 0,
      failed: 0,
      messages,
    };
  }

  private async appendMovedActivity(action: OrganizeActionPlan, operationId: string): Promise<void> {
    const snapshot = objectSnapshot(action.newMarkdown, action.destinationPath);
    const activity: ActivityEvent = {
      eventId: `object_moved:${operationId}:${snapshot.id}:${normalizePath(action.sourcePath)}:${normalizePath(action.destinationPath)}`,
      occurredAt: new Date().toISOString(),
      eventType: 'object_moved',
      sourceId: snapshot.id,
      sourceType: snapshot.type,
      sourcePath: normalizePath(action.destinationPath),
      previousPath: normalizePath(action.sourcePath),
      originClient: 'obsidian_companion',
      originKind: 'companion',
      titleSnapshot: snapshot.title,
      operationId,
    };
    await this.activityWriter.append(activity);
  }

  private async appendRetiredActivity(input: {
    id: string;
    sourcePath: string;
    tombstonePath: string;
    expectedMarkdown: string;
    occurredAt?: string;
    operationId?: string;
  }): Promise<void> {
    const snapshot = objectSnapshot(input.expectedMarkdown, input.sourcePath);
    const activity: ActivityEvent = {
      eventId: `object_retired:${input.operationId ?? input.id}:${snapshot.id}:${normalizePath(input.tombstonePath)}`,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      eventType: 'object_retired',
      sourceId: snapshot.id,
      sourceType: snapshot.type,
      sourcePath: normalizePath(input.tombstonePath),
      previousPath: normalizePath(input.sourcePath),
      originClient: 'obsidian_companion',
      originKind: 'companion',
      titleSnapshot: snapshot.title,
      ...(input.operationId ? { operationId: input.operationId } : {}),
    };
    await this.activityWriter.append(activity);
  }

  private async appendCreatedActivity(markdown: string, path: string): Promise<void> {
    const snapshot = objectSnapshot(markdown, path);
    const activity: ActivityEvent = {
      eventId: `object_created:${snapshot.id}`,
      occurredAt: new Date().toISOString(),
      eventType: 'object_created',
      sourceId: snapshot.id,
      sourceType: snapshot.type,
      sourcePath: normalizePath(path),
      originClient: 'obsidian_companion',
      originKind: 'companion',
      titleSnapshot: snapshot.title,
    };
    await this.activityWriter.append(activity);
  }

  private async retireFile(input: RetireFileInput): Promise<string> {
    const sourcePath = normalizePath(input.path);
    const destinationPath = normalizePath(input.destinationPath ?? canonicalRetirementPath(input.id));
    const source = this.vault.getAbstractFileByPath(sourcePath);

    if (!(source instanceof TFile)) {
      const existingTombstone = this.vault.getAbstractFileByPath(destinationPath);
      if (existingTombstone instanceof TFile) {
        const existingMarkdown = await this.vault.read(existingTombstone);
        if (existingMarkdown === input.tombstoneMarkdown) return destinationPath;
      }
      throw new Error(`Source file not found for canonical retirement: ${sourcePath}`);
    }

    const occupied = this.vault.getAbstractFileByPath(destinationPath);
    if (occupied) {
      throw new Error(
        `Canonical tombstone destination already exists: ${destinationPath}. Resolve the collision before deleting.`,
      );
    }

    await this.vault.process(source, current => {
      if (current !== input.expectedMarkdown) {
        if (current === input.tombstoneMarkdown) return current;
        throw new Error(`File changed since delete preview: ${sourcePath}`);
      }
      return input.tombstoneMarkdown;
    });

    await this.ensureFolder(destinationPath);
    const sourceNow = this.vault.getAbstractFileByPath(sourcePath);
    if (!(sourceNow instanceof TFile)) {
      const recovered = this.vault.getAbstractFileByPath(destinationPath);
      if (recovered instanceof TFile && await this.vault.read(recovered) === input.tombstoneMarkdown) {
        return destinationPath;
      }
      throw new Error(`Source file vanished before canonical retirement move: ${sourcePath}`);
    }

    await this.vault.rename(sourceNow, destinationPath);
    return destinationPath;
  }

  private async ensureFolder(filePath: string): Promise<void> {
    const segments = filePath.split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.vault.getAbstractFileByPath(current)) {
        await this.vault.createFolder(current);
      }
    }
  }
}

function objectSnapshot(markdown: string, fallbackPath: string): { id: string; type: string; title: string } {
  const parsed = ObjectParser.parseMarkdown(markdown);
  const id = typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id.trim()
    ? parsed.frontmatter.id.trim()
    : fallbackPath;
  const type = typeof parsed.frontmatter.type === 'string' && parsed.frontmatter.type.trim()
    ? parsed.frontmatter.type.trim()
    : 'object';
  const title = typeof parsed.frontmatter.title === 'string' && parsed.frontmatter.title.trim()
    ? parsed.frontmatter.title.trim()
    : id;
  return { id, type, title };
}
