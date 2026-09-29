import { TFile, type Vault } from 'obsidian';
import {
  buildObjectIdentificationMigrationPlan,
  type ObjectIdentificationCandidate,
  type ObjectIdentificationMigrationPlan,
} from '../core/object-identification-migration';
import {
  identifyTypeFromSignatures,
  type QuartzoSharedSettings,
  type TypeSignature,
} from '../core/shared-settings';
import { ObjectParser } from '../core/objects';

export interface ObjectIdentificationMigrationResult {
  migrated: number;
  remaining: number;
  failedPath?: string;
}

export class ObjectIdentificationMigrationRepository {
  constructor(
    private readonly vault: Vault,
    private readonly shouldIndexPath: (path: string) => boolean,
  ) {}

  async preview(input: {
    objectType: string;
    oldSignature: TypeSignature;
    newSignature: TypeSignature;
    settings: QuartzoSharedSettings;
  }): Promise<ObjectIdentificationMigrationPlan> {
    const candidates: ObjectIdentificationCandidate[] = [];
    const files = this.vault.getMarkdownFiles().filter(file => this.shouldIndexPath(file.path));

    await Promise.all(files.map(async file => {
      const current = await this.vault.read(file);
      const parsed = ObjectParser.parseMarkdown(current);
      const resolved = identifyTypeFromSignatures(input.settings, file.path, parsed.frontmatter, parsed.body);
      if (resolved !== input.objectType) return;
      candidates.push({
        path: file.path,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        originalMarkdown: current,
      });
    }));

    return buildObjectIdentificationMigrationPlan({
      objectType: input.objectType,
      oldSignature: input.oldSignature,
      newSignature: input.newSignature,
      candidates,
      existingPaths: files.map(file => file.path),
    });
  }

  async apply(plan: ObjectIdentificationMigrationPlan): Promise<ObjectIdentificationMigrationResult> {
    if (plan.blockers.length > 0) {
      throw new Error('Cannot apply Object Identification migration with preflight blockers.');
    }

    let migrated = 0;
    for (const action of plan.actions) {
      try {
        const source = this.vault.getAbstractFileByPath(action.sourcePath);
        if (!(source instanceof TFile)) {
          const destination = this.vault.getAbstractFileByPath(action.destinationPath);
          if (destination instanceof TFile && await this.vault.read(destination) === action.markdown) {
            migrated++;
            continue;
          }
          throw new Error(`Object file not found: ${action.sourcePath}`);
        }

        const current = await this.vault.read(source);
        if (
          action.originalMarkdown !== undefined
          && current !== action.originalMarkdown
          && current !== action.markdown
        ) {
          throw new Error(`Object changed since migration preview: ${action.sourcePath}`);
        }
        if (!action.moves) {
          if (current !== action.markdown) {
            await this.vault.process(source, latest => {
              if (
                action.originalMarkdown !== undefined
                && latest !== action.originalMarkdown
                && latest !== action.markdown
              ) {
                throw new Error(`Object changed since migration preview: ${action.sourcePath}`);
              }
              return action.markdown;
            });
          }
          migrated++;
          continue;
        }

        const destination = this.vault.getAbstractFileByPath(action.destinationPath);
        if (destination instanceof TFile) {
          const destinationCurrent = await this.vault.read(destination);
          if (destinationCurrent === action.markdown) {
            await this.vault.delete(source);
            migrated++;
            continue;
          }
          throw new Error(`Destination already exists: ${action.destinationPath}`);
        }

        await this.ensureFolder(action.destinationPath);
        await this.vault.create(action.destinationPath, action.markdown);
        const written = this.vault.getAbstractFileByPath(action.destinationPath);
        if (!(written instanceof TFile) || await this.vault.read(written) !== action.markdown) {
          throw new Error(`Destination write could not be verified: ${action.destinationPath}`);
        }
        await this.vault.delete(source);
        migrated++;
      } catch (error) {
        return {
          migrated,
          remaining: plan.actions.length - migrated,
          failedPath: action.sourcePath,
        };
      }
    }

    return { migrated, remaining: 0 };
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
