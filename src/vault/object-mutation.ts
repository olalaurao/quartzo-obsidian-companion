import { TFile, type Vault } from 'obsidian';
import type { IndexedObject } from './index/types';
import { ObjectParser } from '../core/objects';
import { ActivityHistoryWriter } from './activity-history';
import type { ActivityEvent } from '../core/activity-history';
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
  private readonly activityWriter: ActivityHistoryWriter;

  constructor(private readonly vault: Vault) {
    this.activityWriter = new ActivityHistoryWriter(vault);
  }

  async mutate(
    object: IndexedObject,
    patch: SafeObjectMutation,
    operationId: string,
    emitActivity = true,
  ): Promise<string> {
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
    if (emitActivity) {
      const parsed = ObjectParser.parse(updated).object;
      const activity: ActivityEvent = {
        eventId: `object_edited:${operationId}`,
        occurredAt: new Date().toISOString(),
        eventType: 'object_edited',
        sourceId: object.id,
        sourceType: object.type,
        sourcePath: object.path,
        originClient: 'obsidian_companion',
        originKind: 'companion',
        titleSnapshot: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : object.id,
        operationId,
        changedFieldCount: mutationChangeCount(patch),
      };
      await this.activityWriter.append(activity);
    }
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

function mutationChangeCount(patch: SafeObjectMutation): number {
  return Object.keys(patch.set ?? {}).length +
    (patch.unset?.length ?? 0) +
    (patch.body === undefined ? 0 : 1);
}
