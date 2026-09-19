import { TFile, Vault } from 'obsidian';
import {
  parseOccurrenceResponses,
  replaceOccurrenceResponsesInMarkdown,
  type OccurrenceResponseState,
  type OccurrenceResponseStore,
} from '../core/occurrence_actions';

export const SHARED_OCCURRENCE_STATE_PATH = 'sessions/shared_occurrence_state_v1.md';

export class SharedOccurrenceStateRepository implements OccurrenceResponseStore {
  constructor(private readonly vault: Vault) {}

  async loadResponses(): Promise<Record<string, OccurrenceResponseState>> {
    const file = this.vault.getAbstractFileByPath(SHARED_OCCURRENCE_STATE_PATH);
    if (file == null) return {};
    if (!(file instanceof TFile)) {
      throw new Error('Shared occurrence state path is not a file.');
    }
    return parseOccurrenceResponses(await this.vault.read(file));
  }

  async replaceResponses(
    responses: Record<string, OccurrenceResponseState>,
  ): Promise<void> {
    const file = this.vault.getAbstractFileByPath(SHARED_OCCURRENCE_STATE_PATH);
    if (file == null) {
      if (!this.vault.getAbstractFileByPath('sessions')) {
        await this.vault.createFolder('sessions');
      }
      await this.vault.create(
        SHARED_OCCURRENCE_STATE_PATH,
        replaceOccurrenceResponsesInMarkdown('', responses),
      );
      return;
    }
    if (!(file instanceof TFile)) {
      throw new Error('Shared occurrence state path is not a file.');
    }
    await this.vault.process(file, current =>
      replaceOccurrenceResponsesInMarkdown(current, responses),
    );
  }
}
