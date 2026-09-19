import { TFile, Vault } from 'obsidian';
import {
  clearOccurrenceDomainMarkdown,
  completeOccurrenceDomainMarkdown,
  type OccurrenceActionTarget,
} from '../core/occurrence_actions';

export class OccurrenceDomainMutationRepository {
  constructor(private readonly vault: Vault) {}

  async complete(
    filePath: string,
    target: OccurrenceActionTarget,
    completedAt: Date,
    recordedAt: Date,
    actionId: string,
  ): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Occurrence source file not found: ${filePath}`);
    }
    await this.vault.process(file, current =>
      completeOccurrenceDomainMarkdown(
        current,
        target,
        completedAt,
        recordedAt,
        actionId,
      ),
    );
  }

  async clear(filePath: string, target: OccurrenceActionTarget): Promise<void> {
    const file = this.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`Occurrence source file not found: ${filePath}`);
    }
    await this.vault.process(file, current =>
      clearOccurrenceDomainMarkdown(current, target),
    );
  }
}
