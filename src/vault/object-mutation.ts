import { TFile, type Vault } from 'obsidian';
import type { IndexedObject } from './index/types';
import {
  applySafeObjectMutation,
  type SafeObjectMutation,
} from '../core/object-mutation';

export class SafeObjectMutationRepository {
  constructor(private readonly vault: Vault) {}

  async mutate(object: IndexedObject, patch: SafeObjectMutation): Promise<string> {
    const file = this.vault.getAbstractFileByPath(object.path);
    if (!(file instanceof TFile)) {
      throw new Error(`Object file not found: ${object.path}`);
    }

    let updated = '';
    await this.vault.process(file, current => {
      updated = applySafeObjectMutation(current, {
        id: object.id,
        type: object.type,
      }, patch);
      return updated;
    });
    return updated;
  }
}
