import { OccurrenceActionsEngine } from './engine';
import { OccurrenceActionInput, OccurrenceActionResult } from './types';
import { ObjectParser } from '../objects';
import { QuartzoObject } from '../objects/types';

export class OccurrenceActionService {
  private processedActionIds: Set<string> = new Set();
  private vaultAdapter: { read: (path: string) => Promise<string>; write: (path: string, content: string) => Promise<void>; list: (path: string) => Promise<string[]> };
  private syncQueue: Array<{ path: string; action: string }> = [];

  constructor(vaultAdapter: { read: (path: string) => Promise<string>; write: (path: string, content: string) => Promise<void>; list: (path: string) => Promise<string[]> }) {
    this.vaultAdapter = vaultAdapter;
  }

  async executeAction(input: OccurrenceActionInput): Promise<OccurrenceActionResult> {
    // Check for duplicate action replay (idempotent)
    const actionKey = `${input.action}:${input.occurrenceId}`;
    if (input.duplicateActionId && this.processedActionIds.has(actionKey)) {
      return { 
        outcome: 'idempotent_noop', 
        processedActionIds: Array.from(this.processedActionIds) 
      };
    }

    // Process the action through the engine
    const result = OccurrenceActionsEngine.process(input);
    
    if (result.processedActionIds) {
      result.processedActionIds.forEach(id => this.processedActionIds.add(id));
    }

    // If action was successful, persist the change to the vault
    if (result.outcome !== 'idempotent_noop' && result.outcome !== 'unknown') {
      await this.persistAction(input, result);
      
      // Add to sync queue
      if (input.objectPath) {
        this.syncQueue.push({
          path: input.objectPath,
          action: input.action
        });
      }
    }

    return result;
  }

  private async persistAction(input: OccurrenceActionInput, result: OccurrenceActionResult): Promise<void> {
    // In production, this would read the object file, apply the action, and write it back
    // For now, we'll use the ObjectParser to demonstrate the pattern
    
    try {
      // Find the object file by occurrenceId
      const objectPath = await this.findObjectPath(input.occurrenceId);
      if (!objectPath) {
        console.warn(`Object not found for occurrence: ${input.occurrenceId}`);
        return;
      }

      // Read the current content
      const content = await this.vaultAdapter.read(objectPath);
      
      // Parse the object
      const parseResult = ObjectParser.parse(content);
      
      // Apply the action to the object
      const updatedObject = this.applyActionToObject(parseResult.object, input, result);
      
      // Build unknown fields map
      const unknownFieldsMap: Record<string, unknown> = {};
      for (const field of parseResult.unknownFields) {
        unknownFieldsMap[field] = (parseResult.object as Record<string, unknown>)[field];
      }
      
      // Serialize back to markdown
      const updatedContent = ObjectParser.serialize(updatedObject as QuartzoObject, unknownFieldsMap);
      
      // Write back to vault
      await this.vaultAdapter.write(objectPath, updatedContent);
      
      console.log(`Persisted action ${input.action} for ${input.occurrenceId}`);
    } catch (error) {
      console.error(`Failed to persist action: ${error}`);
    }
  }

  private async findObjectPath(occurrenceId: string): Promise<string | null> {
    // In production, this would search the vault index
    // For now, return a mock path
    const files = await this.vaultAdapter.list('/');
    const targetFile = files.find((f: string) => f.includes(occurrenceId));
    return targetFile || null;
  }

  private applyActionToObject(object: Record<string, unknown>, input: OccurrenceActionInput, result: OccurrenceActionResult): Record<string, unknown> {
    // Apply the action result to the object
    const updated = { ...object };

    switch (input.action) {
      case 'done':
      case 'already_did':
        updated.completed_at = result.recordedAt || new Date().toISOString();
        updated.status = 'completed';
        break;
      case 'skip':
        updated.status = 'skipped';
        updated.skipped_at = new Date().toISOString();
        break;
      case 'clear':
        delete updated.completed_at;
        delete updated.status;
        delete updated.skipped_at;
        break;
      case 'snooze':
        updated.snoozed_until = result.snoozedUntil;
        break;
      case 'dismiss':
        updated.dismissed_at = result.dismissedAt;
        updated.status = 'dismissed';
        break;
    }

    return updated;
  }

  getProcessedActionIds(): string[] {
    return Array.from(this.processedActionIds);
  }

  clearProcessedActionIds(): void {
    this.processedActionIds.clear();
  }

  getSyncQueue(): Array<{ path: string; action: string }> {
    return [...this.syncQueue];
  }

  clearSyncQueue(): void {
    this.syncQueue = [];
  }
}
