import { TFile, Vault } from 'obsidian';
import type { OrganizePlan, OrganizeActionPlan } from '../core/object-organization/organize';
import type { MergePlan } from '../core/object-organization/merge';
import { SharedSettingsRepository } from './shared-settings';
import { ObjectParser } from '../core/objects';

export interface ObjectOrganizationResult {
  migrated: number;
  remaining: number;
  failedPath?: string;
  error?: Error;
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

    // 1. Preflight: Verify settings revision hasn't changed since plan
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
      // Recovery check: Maybe it already moved?
      if (action.moves) {
        const dest = this.vault.getAbstractFileByPath(action.destinationPath);
        if (dest instanceof TFile) {
          const destContent = await this.vault.read(dest);
          if (destContent === action.newMarkdown) return; // Already exactly as planned
        }
      }
      throw new Error(`Source file not found: ${action.sourcePath}`);
    }

    // If it's a move, check destination isn't unexpectedly occupied
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
        // If content matches, it's a recovered partial state, but we shouldn't delete source blindly unless sure
        // Actually, Obsidian might not allow rename to existing file.
      }
    }

    let modifiedInPlace = false;
    
    // Process markdown changes if needed
    if (action.newMarkdown !== action.expectedMarkdown) {
      await this.vault.process(source, current => {
        // §8: Check if changed unexpectedly
        if (current !== action.expectedMarkdown) {
          // It might already be the *new* state (idempotency/retry)
          if (current === action.newMarkdown) return current;
          throw new Error(`File changed since preview: ${action.sourcePath}`);
        }
        return action.newMarkdown;
      });
      modifiedInPlace = true;
    }

    // Handle move
    if (action.moves) {
      await this.ensureFolder(action.destinationPath);
      
      const sourceNow = this.vault.getAbstractFileByPath(action.sourcePath);
      if (!(sourceNow instanceof TFile)) {
         throw new Error(`Source file vanished before move: ${action.sourcePath}`);
      }
      
      try {
        await this.vault.rename(sourceNow, action.destinationPath);
      } catch (e) {
        throw new Error(`Failed to move file to ${action.destinationPath}: ${e}`);
      }
    }
  }

  /**
   * Applies a planned Merge operation.
   * Updates survivor and moves losers to the _deleted/ folder as tombstones (§69).
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

    // 1. Update Survivor
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

    // 2. Retire Losers
    // They are moved to _deleted/ folder to prevent resurrection
    await this.ensureFolder('_deleted/x'); // Quick way to ensure _deleted exists

    for (const loser of plan.action.losersToRetire) {
      const loserFile = this.vault.getAbstractFileByPath(loser.path);
      if (!(loserFile instanceof TFile)) continue; // Already gone or not a file

      await this.vault.process(loserFile, current => {
        if (current !== loser.expectedMarkdown) {
           if (current === loser.newMarkdown) return current;
           // If it changed, we still want to retire it unless we decide to abort.
           // Since survivor has been updated, aborting now leaves inconsistent state.
           // In merge, we overwrite the loser with the tombstone anyway.
        }
        return loser.newMarkdown;
      });

      // Move to _deleted folder
      const filename = loser.path.split('/').pop()!;
      const destPath = `_deleted/${loser.id}.md`;
      const existing = this.vault.getAbstractFileByPath(destPath);
      if (!existing) {
         await this.vault.rename(loserFile, destPath);
      } else {
         // If a tombstone with the same ID exists, we can just delete this duplicate instance
         await this.vault.delete(loserFile);
      }
    }
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
