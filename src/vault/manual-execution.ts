import { TFile, type Vault, normalizePath } from 'obsidian';
import { ObjectParser } from '../core/objects';
import {
  applyTypeSignature,
  resolveCreationFolder,
  resolveTypeSignature,
  type QuartzoSharedSettings,
} from '../core/shared-settings';
import {
  canonicalObjectSlug,
  finalizeRoutineOccurrence,
  finalizeSystemRun,
  mutateRoutineOccurrence,
  type RoutineOccurrenceMutationInput,
  type RoutineOccurrenceMutationResult,
  type SystemRunFinalization,
  type SystemRunSummaryTask,
} from '../core/manual-execution';
import type { IndexedObject, VaultIndex } from './index/types';

export interface PersistedSystemRun {
  sourceMarkdown: string;
  summaryPath: string;
  finalization: SystemRunFinalization;
}

export interface PersistedRoutineRun {
  sourceMarkdown: string;
  result: RoutineOccurrenceMutationResult;
}

export class ManualExecutionRepository {
  constructor(private readonly vault: Vault) {}

  async finishSystem(
    source: IndexedObject,
    input: {
      startedAt: string;
      finishedAt: string;
      stepCompletions: Readonly<Record<string, boolean>>;
    },
    index: VaultIndex,
    settings: QuartzoSharedSettings | null,
  ): Promise<PersistedSystemRun> {
    if (source.type !== 'system') throw new Error('System execution requires a System source.');
    const file = this.requireFile(source.path);
    let finalization: SystemRunFinalization | null = null;
    let sourceMarkdown = '';

    await this.vault.process(file, current => {
      const parsed = ObjectParser.parseMarkdown(current);
      this.assertSourceIdentity(parsed.frontmatter, source, 'system');
      finalization = finalizeSystemRun(parsed.frontmatter, input);
      sourceMarkdown = ObjectParser.serializeMarkdown(finalization.frontmatter, parsed.body);
      return sourceMarkdown;
    });

    if (!finalization) throw new Error('System finalization did not produce evidence.');
    const summaryPath = await this.ensureSystemSummaryTask(
      finalization.summaryTask,
      index,
      settings,
    );
    return { sourceMarkdown, summaryPath, finalization };
  }

  async updateRoutineOccurrence(
    source: IndexedObject,
    input: RoutineOccurrenceMutationInput,
  ): Promise<PersistedRoutineRun> {
    return this.persistRoutineMutation(source, input, false);
  }

  async finishRoutineOccurrence(
    source: IndexedObject,
    input: Omit<RoutineOccurrenceMutationInput, 'completePlainSteps'>,
  ): Promise<PersistedRoutineRun> {
    return this.persistRoutineMutation(source, input, true);
  }

  private async persistRoutineMutation(
    source: IndexedObject,
    input: RoutineOccurrenceMutationInput,
    finish: boolean,
  ): Promise<PersistedRoutineRun> {
    if (source.type !== 'routine') throw new Error('Routine execution requires a Routine source.');
    const file = this.requireFile(source.path);
    let result: RoutineOccurrenceMutationResult | null = null;
    let sourceMarkdown = '';

    await this.vault.process(file, current => {
      const parsed = ObjectParser.parseMarkdown(current);
      this.assertSourceIdentity(parsed.frontmatter, source, 'routine');
      result = finish
        ? finalizeRoutineOccurrence(parsed.frontmatter, input)
        : mutateRoutineOccurrence(parsed.frontmatter, input);
      sourceMarkdown = ObjectParser.serializeMarkdown(result.frontmatter, parsed.body);
      return sourceMarkdown;
    });

    if (!result) throw new Error('Routine mutation did not produce execution evidence.');
    return { sourceMarkdown, result };
  }

  private requireFile(path: string): TFile {
    const file = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) throw new Error(`Execution source file not found: ${path}`);
    return file;
  }

  private assertSourceIdentity(
    frontmatter: Record<string, unknown>,
    source: IndexedObject,
    expectedType: 'system' | 'routine',
  ): void {
    if (String(frontmatter.id ?? '') !== source.id) {
      throw new Error('Execution source identity changed on disk.');
    }
    if (String(frontmatter.type ?? '') !== expectedType) {
      throw new Error('Execution source type changed on disk.');
    }
  }

  private validateExistingSummary(
    frontmatter: Record<string, unknown>,
    expected: SystemRunSummaryTask,
  ): void {
    const duration = Number(frontmatter.duration);
    if (
      String(frontmatter.id ?? '') !== expected.id
      || String(frontmatter.type ?? '') !== 'task'
      || String(frontmatter.linked_system ?? '') !== expected.linked_system
      || String(frontmatter.stage ?? '') !== expected.stage
      || String(frontmatter.created_at ?? '') !== expected.created_at
      || !Number.isFinite(duration)
      || duration !== expected.duration
    ) {
      throw new Error(`System run summary id collides with incompatible Task: ${expected.id}`);
    }
  }

  private async ensureSystemSummaryTask(
    task: SystemRunSummaryTask,
    index: VaultIndex,
    settings: QuartzoSharedSettings | null,
  ): Promise<string> {
    const indexed = index.objects.get(task.id);
    if (indexed) {
      this.validateExistingSummary(indexed.frontmatter, task);
      return indexed.path;
    }

    const folder = resolveCreationFolder(settings, 'task');
    if (!folder) {
      throw new Error(
        'No canonical Task creation folder is configured. Configure Object Identification in Quartzo first.',
      );
    }

    const signature = resolveTypeSignature(settings, 'task');
    const signed = applyTypeSignature({ ...task }, '', signature);
    const content = ObjectParser.serializeMarkdown(signed.frontmatter, signed.body);
    const baseStem = canonicalObjectSlug(task.title) || 'system-run';
    await this.ensureFolder(folder);

    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const stem = suffix === 1 ? baseStem : `${baseStem}-${suffix}`;
      const candidate = normalizePath(`${folder}/${stem}.md`);
      const existing = this.vault.getAbstractFileByPath(candidate);
      if (existing instanceof TFile) {
        try {
          const parsed = ObjectParser.parseMarkdown(await this.vault.read(existing));
          if (String(parsed.frontmatter.id ?? '') === task.id) {
            this.validateExistingSummary(parsed.frontmatter, task);
            return candidate;
          }
        } catch {
          // A malformed or unrelated existing path is a collision; try a suffix.
        }
        continue;
      }
      if (existing) continue;
      await this.vault.create(candidate, content);
      return candidate;
    }

    throw new Error('Could not allocate a safe path for the System run summary Task.');
  }

  private async ensureFolder(folder: string): Promise<void> {
    const normalized = normalizePath(folder);
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.vault.getAbstractFileByPath(current)) {
        await this.vault.createFolder(current);
      }
    }
  }
}
