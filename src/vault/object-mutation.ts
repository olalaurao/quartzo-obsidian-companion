import { TFile, type Vault } from 'obsidian';
import type { IndexedObject } from './index/types';
import {
  applySafeObjectMutation,
  type SafeObjectMutation,
} from '../core/object-mutation';
import {
  applyTypeConflictMarkerRemoval,
  type TypeConflictMarkerRemoval,
} from '../core/object-mutation/type-conflict';
import type { QuartzoSharedSettings } from '../core/shared-settings';

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

  async removeTypeConflictMarker(
    object: IndexedObject,
    request: Omit<TypeConflictMarkerRemoval, 'objectId' | 'resolvedType' | 'filePath'>,
    settings: QuartzoSharedSettings | null,
  ): Promise<string> {
    const file = this.vault.getAbstractFileByPath(object.path);
    if (!(file instanceof TFile)) {
      throw new Error(`Object file not found: ${object.path}`);
    }

    let updated = '';
    await this.vault.process(file, current => {
      updated = applyTypeConflictMarkerRemoval(current, {
        objectId: object.id,
        resolvedType: object.type,
        filePath: object.path,
        ...request,
      }, settings);
      return updated;
    });
    return updated;
  }
}
