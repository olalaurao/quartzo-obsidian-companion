import { TFile, Vault } from 'obsidian';
import {
  SHARED_SETTINGS_PATH,
  parseSharedSettings,
  type QuartzoSharedSettings,
} from '../core/shared-settings';

export * from '../core/shared-settings';

export class SharedSettingsRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<QuartzoSharedSettings | null> {
    const file = this.vault.getAbstractFileByPath(SHARED_SETTINGS_PATH);
    if (!(file instanceof TFile)) return null;
    return parseSharedSettings(await this.vault.read(file));
  }
}
