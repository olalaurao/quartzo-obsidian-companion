import type { Vault } from 'obsidian';
import { ObjectParser } from '../core/objects';
import type { QuickAddType } from '../core/object-creation';
import type { ActivityEvent, ActivityEventType } from '../core/activity-history';
import { ActivityHistoryWriter } from './activity-history';

export interface ObjectCreationDocument {
  path: string;
  content: string;
}

export interface ObjectCreationResult {
  id: string;
  type: QuickAddType;
  path: string;
}

type CreationActivityEventType = Extract<
  ActivityEventType,
  'object_created' | 'capture_created' | 'tracking_record_created'
>;

export class ObjectCreationRepository {
  private readonly activityWriter: ActivityHistoryWriter;

  constructor(private readonly vault: Vault) {
    this.activityWriter = new ActivityHistoryWriter(vault);
  }

  async create(
    type: QuickAddType,
    document: ObjectCreationDocument,
    eventType: CreationActivityEventType = activityEventTypeForCreation(type),
  ): Promise<ObjectCreationResult> {
    await this.ensureParentFolders(document.path);
    if (this.vault.getAbstractFileByPath(document.path)) {
      throw new Error(`Target already exists: ${document.path}`);
    }
    await this.vault.create(document.path, document.content);

    const parsed = ObjectParser.parse(document.content).object;
    const occurredAt = new Date().toISOString();
    const activity: ActivityEvent = {
      eventId: `${eventType}:${parsed.id}`,
      occurredAt,
      eventType,
      sourceId: parsed.id,
      sourceType: parsed.type,
      sourcePath: document.path,
      originClient: 'obsidian_companion',
      originKind: 'companion',
      titleSnapshot: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title : parsed.id,
    };
    await this.activityWriter.append(activity);
    return { id: parsed.id, type, path: document.path };
  }

  private async ensureParentFolders(filePath: string): Promise<void> {
    const segments = filePath.replace(/\\/g, '/').split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.vault.getAbstractFileByPath(current)) {
        await this.vault.createFolder(current);
      }
    }
  }
}

function activityEventTypeForCreation(type: QuickAddType): CreationActivityEventType {
  return type === 'tracker_record' ? 'tracking_record_created' : 'object_created';
}
