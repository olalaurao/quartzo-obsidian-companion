import { TFile, Vault } from 'obsidian';
import {
  parseOccurrenceTimeOverrides,
  upsertOccurrenceTimeOverrideInMarkdown,
  type OccurrenceTimeOverride,
} from '../core/occurrence_reschedule';

export const SHARED_PLANNING_STATE_PATH = 'sessions/shared_planning_state_v1.md';

export class SharedPlanningStateRepository {
  constructor(private readonly vault: Vault) {}

  async loadOverrides(): Promise<Record<string, OccurrenceTimeOverride>> {
    const file = this.vault.getAbstractFileByPath(SHARED_PLANNING_STATE_PATH);
    if (file == null) return {};
    if (!(file instanceof TFile)) {
      throw new Error('Shared planning state path is not a file.');
    }
    return parseOccurrenceTimeOverrides(await this.vault.read(file));
  }

  async upsertTimeOverride(override: OccurrenceTimeOverride): Promise<void> {
    const file = this.vault.getAbstractFileByPath(SHARED_PLANNING_STATE_PATH);
    if (file == null) {
      if (!this.vault.getAbstractFileByPath('sessions')) {
        await this.vault.createFolder('sessions');
      }
      await this.vault.create(
        SHARED_PLANNING_STATE_PATH,
        upsertOccurrenceTimeOverrideInMarkdown('', override),
      );
      return;
    }
    if (!(file instanceof TFile)) {
      throw new Error('Shared planning state path is not a file.');
    }
    await this.vault.process(file, current =>
      upsertOccurrenceTimeOverrideInMarkdown(current, override),
    );
  }
}
