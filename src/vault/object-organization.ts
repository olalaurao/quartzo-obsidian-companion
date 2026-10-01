import { TFile, Vault, normalizePath } from 'obsidian';
import type { OrganizePlan, OrganizeActionPlan } from '../core/object-organization/organize';
import type { MergePlan } from '../core/object-organization/merge';
import {
  buildCanonicalRetirementTombstone,
  canonicalRetirementPath,
} from '../core/object-organization/retire';
import { SharedSettingsRepository } from './shared-settings';

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
  expectedMarkdown: string;
  tombstoneMarkdown: string;
}

export class ObjectOrganizationRepository {
  constructor(
    private readonly vault: Vault,
    private readonly settingsRepo: SharedSettingsRepository,
  ) {}

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

    const survivorFile = this.vault.getAbstractFileByPath(plan.action.survivorPath);
    if (!(survivorFile instanceof TFile)) {
      throw new Error(`Survivor file missing: ${plan.action.survivorPath}`);
    }

    if (plan.action.newSurvivorMarkdown !== plan.action.expectedSurvivorMarkdown) {
      await this.vault.process(survivorFile, current => {
        if (current !== plan.action.expectedSurvivorMarkdown) {
          if (current === plan.action.newSurvivorMarkdown) return current;
          throw new Error(`Survivor file changed since preview: ${plan.action.survivorPath}`);
        }
        return plan.action.newSurvivorMarkdown;
      });
    }

    for (const loser of plan.action.losersToRetire) {
      await this.retireFile({
        path: loser.path,
        id: loser.id,
        expectedMarkdown: loser.expectedMarkdown,
        tombstoneMarkdown: loser.newMarkdown,
      });
    }
  }

  private async retireFile(input: RetireFileInput): Promise<string> {
    const sourcePath = normalizePath(input.path);
    const destinationPath = normalizePath(canonicalRetirementPath(input.id));
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
