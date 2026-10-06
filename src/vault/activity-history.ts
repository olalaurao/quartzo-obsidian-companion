import type { TFile, Vault } from 'obsidian';
import type { ActivityEvent, ActivityEventType, ActivityOriginKind } from '../core/activity-history';

export const ACTIVITY_HISTORY_ROOT = 'sessions/activity_history_v1/';

const EVENT_TYPES = new Set<ActivityEventType>([
  'object_created',
  'object_edited',
  'object_moved',
  'object_retired',
  'capture_created',
  'occurrence_completed',
  'occurrence_already_did',
  'occurrence_skipped',
  'occurrence_rescheduled',
  'tracking_record_created',
  'system_manually_run',
  'routine_manually_run',
  'focus_session_completed',
]);

const ORIGIN_KINDS = new Set<ActivityOriginKind>([
  'app',
  'companion',
  'import',
  'sync',
  'automation',
  'external_integration',
]);

export interface ActivityHistoryFile {
  path: string;
  content: string;
}

export interface ActivityHistoryParseDiagnostic {
  path: string;
  line: number;
  message: string;
}

export interface ActivityHistoryReadResult {
  events: ActivityEvent[];
  diagnostics: ActivityHistoryParseDiagnostic[];
}

export class ActivityHistoryRepository {
  constructor(private readonly vault: Vault) {}

  async load(): Promise<ActivityHistoryReadResult> {
    return this.loadMatchingFiles(isActivityHistoryPath);
  }

  async loadRange(rangeStart: string, rangeEnd: string): Promise<ActivityHistoryReadResult> {
    const months = activityPartitionMonthsForRange(rangeStart, rangeEnd);
    return this.loadMatchingFiles(filePath => {
      const month = activityPartitionMonthFromPath(filePath);
      return month !== null && months.has(month);
    });
  }

  private async loadMatchingFiles(matches: (path: string) => boolean): Promise<ActivityHistoryReadResult> {
    const files = this.vault.getFiles()
      .filter(file => matches(file.path))
      .sort((left, right) => left.path.localeCompare(right.path));
    const inputs: ActivityHistoryFile[] = [];
    for (const file of files) {
      inputs.push({ path: file.path, content: await this.vault.read(file) });
    }
    return parseActivityHistoryFiles(inputs);
  }
}

export class ActivityHistoryWriter {
  constructor(private readonly vault: Vault) {}

  async append(event: ActivityEvent): Promise<void> {
    const path = activityPartitionPath(event.occurredAt);
    await this.ensureParentFolders(path);
    const existing = this.vault.getAbstractFileByPath(path);
    const line = `${JSON.stringify(event)}\n`;
    if (isWritableFile(existing)) {
      await this.vault.process(existing, current => {
        const parsed = parseActivityHistoryFiles([{ path, content: current }]);
        if (parsed.events.some(item => item.eventId === event.eventId)) return current;
        return current.endsWith('\n') || current.length === 0 ? `${current}${line}` : `${current}\n${line}`;
      });
      return;
    }
    await this.vault.create(path, line);
  }

  private async ensureParentFolders(filePath: string): Promise<void> {
    const segments = filePath.split('/').slice(0, -1);
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.vault.getAbstractFileByPath(current)) {
        await this.vault.createFolder(current);
      }
    }
  }
}

function isWritableFile(value: unknown): value is TFile {
  return value != null &&
    typeof value === 'object' &&
    'path' in value &&
    'extension' in value;
}

export function isActivityHistoryPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  return activityPartitionMonthFromPath(normalized) !== null;
}

export function activityPartitionPath(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid Activity occurredAt timestamp: ${occurredAt}`);
  const year = date.getFullYear().toString().padStart(4, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${ACTIVITY_HISTORY_ROOT}${year}/${month}/activity_events_${year}_${month}.jsonl`;
}

export function activityPartitionMonthsForRange(rangeStart: string, rangeEnd: string): Set<string> {
  const start = parseYearMonth(rangeStart);
  const end = parseYearMonth(rangeEnd);
  if (start.key > end.key) return new Set();
  const months = new Set<string>();
  let year = start.year;
  let month = start.month;
  while (year < end.year || (year === end.year && month <= end.month)) {
    months.add(`${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

export function parseActivityHistoryFiles(files: ActivityHistoryFile[]): ActivityHistoryReadResult {
  const byId = new Map<string, ActivityEvent>();
  const diagnostics: ActivityHistoryParseDiagnostic[] = [];

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const event = decodeActivityEvent(parsed);
        if (!byId.has(event.eventId)) byId.set(event.eventId, event);
      } catch (error) {
        diagnostics.push({
          path: file.path,
          line: index + 1,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    events: [...byId.values()].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)),
    diagnostics,
  };
}

function decodeActivityEvent(value: unknown): ActivityEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Activity event must be a JSON object.');
  }
  const raw = value as Record<string, unknown>;
  const eventType = requiredEnum(raw, 'eventType', EVENT_TYPES);
  const originKind = requiredEnum(raw, 'originKind', ORIGIN_KINDS);
  const occurredAt = requiredString(raw, 'occurredAt');
  if (Number.isNaN(Date.parse(occurredAt))) throw new Error('occurredAt must be an ISO-8601 timestamp.');
  const event: ActivityEvent = {
    eventId: requiredString(raw, 'eventId'),
    occurredAt,
    eventType,
    sourceId: requiredString(raw, 'sourceId'),
    sourceType: requiredString(raw, 'sourceType'),
    originClient: requiredString(raw, 'originClient'),
    originKind,
    titleSnapshot: requiredString(raw, 'titleSnapshot'),
    ...(optionalString(raw, 'sourcePath') !== undefined ? { sourcePath: optionalString(raw, 'sourcePath') } : {}),
    ...(optionalString(raw, 'summary') !== undefined ? { summary: optionalString(raw, 'summary') } : {}),
    ...(optionalString(raw, 'excerpt') !== undefined ? { excerpt: optionalString(raw, 'excerpt') } : {}),
    ...(optionalString(raw, 'previousPath') !== undefined ? { previousPath: optionalString(raw, 'previousPath') } : {}),
    ...(optionalNumber(raw, 'changedFieldCount') !== undefined ? { changedFieldCount: optionalNumber(raw, 'changedFieldCount') } : {}),
    ...(optionalString(raw, 'operationId') !== undefined ? { operationId: optionalString(raw, 'operationId') } : {}),
    ...(optionalString(raw, 'occurrenceId') !== undefined ? { occurrenceId: optionalString(raw, 'occurrenceId') } : {}),
    ...(optionalString(raw, 'scheduledFor') !== undefined ? { scheduledFor: optionalString(raw, 'scheduledFor') } : {}),
    ...(optionalString(raw, 'folder') !== undefined ? { folder: optionalString(raw, 'folder') } : {}),
    ...(decodeProvenance(raw.provenance) !== undefined ? { provenance: decodeProvenance(raw.provenance) } : {}),
    ...(decodeMetadata(raw.metadata) !== undefined ? { metadata: decodeMetadata(raw.metadata) } : {}),
  };
  return event;
}

function requiredString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${key} must be a non-empty string.`);
  return value;
}

function optionalString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string.`);
  return value;
}

function optionalNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
  return value;
}

function requiredEnum<T extends string>(raw: Record<string, unknown>, key: string, allowed: Set<T>): T {
  const value = requiredString(raw, key);
  if (!allowed.has(value as T)) throw new Error(`${key} is not supported: ${value}`);
  return value as T;
}

function decodeProvenance(value: unknown): ActivityEvent['provenance'] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('provenance must be an object.');
  const raw = value as Record<string, unknown>;
  return {
    ...(optionalString(raw, 'providerId') !== undefined ? { providerId: optionalString(raw, 'providerId') } : {}),
    ...(optionalString(raw, 'providerLabel') !== undefined ? { providerLabel: optionalString(raw, 'providerLabel') } : {}),
  };
}

function decodeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('metadata must be an object.');
  return value as Record<string, unknown>;
}

function activityPartitionMonthFromPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/');
  const match = /^sessions\/activity_history_v1\/(\d{4})\/(\d{2})\/activity_events_(\d{4})_(\d{2})\.jsonl$/.exec(normalized);
  if (!match) return null;
  const [, yearFolder, monthFolder, yearFile, monthFile] = match;
  if (yearFolder !== yearFile || monthFolder !== monthFile) return null;
  const month = Number(monthFolder);
  if (month < 1 || month > 12) return null;
  return `${yearFolder}-${monthFolder}`;
}

function parseYearMonth(value: string): { year: number; month: number; key: string } {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!match) throw new Error(`Invalid Activity range date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid Activity range date: ${value}`);
  return { year, month, key: `${match[1]}-${match[2]}` };
}
