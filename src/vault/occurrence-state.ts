import { TFile, Vault } from 'obsidian';
import { ObjectParser } from '../core/objects';
import type {
  OccurrenceResponseState,
  OccurrenceResponseStore,
} from '../core/occurrence_actions';

export const SHARED_OCCURRENCE_STATE_PATH = 'sessions/shared_occurrence_state_v1.md';

const RESPONSE_KEYS = new Set([
  'occurrence_id',
  'source_id',
  'reminder_id',
  'slot_index',
  'due_at',
  'completed_at',
  'skipped_at',
  'recorded_at',
  'snoozed_until',
  'dismissed_at',
  'ignored_count',
  'processed_action_ids',
]);

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be a map.`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid persisted \`${field}\` in shared occurrence state.`);
  }
  return value;
}

function optionalIsoDate(value: unknown, field: string): string | undefined {
  const parsed = optionalString(value, field);
  if (parsed == null) return undefined;
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`Invalid persisted date \`${field}\` in shared occurrence state.`);
  }
  return parsed;
}

function optionalNonNegativeInt(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`Invalid persisted integer \`${field}\` in shared occurrence state.`);
  }
  return Number(value);
}

export function parseOccurrenceResponses(markdown: string): Record<string, OccurrenceResponseState> {
  if (!markdown.trim()) return {};
  const parsed = ObjectParser.parseMarkdown(markdown);
  if (parsed.frontmatter.type !== 'shared_occurrence_state') {
    throw new Error('Shared occurrence state has an unexpected type.');
  }
  const rawResponses = parsed.frontmatter.occurrence_responses;
  if (rawResponses == null) return {};
  const source = asRecord(rawResponses, 'occurrence_responses');
  const result: Record<string, OccurrenceResponseState> = {};

  for (const [mapKey, rawValue] of Object.entries(source)) {
    const raw = asRecord(rawValue, `occurrence_responses.${mapKey}`);
    const occurrenceId = optionalString(raw.occurrence_id, 'occurrence_id');
    if (!occurrenceId) throw new Error('Occurrence response is missing occurrence_id.');
    if (occurrenceId !== mapKey) {
      throw new Error(`Occurrence response key mismatch for ${mapKey}.`);
    }

    const processedRaw = raw.processed_action_ids;
    if (processedRaw != null && !Array.isArray(processedRaw)) {
      throw new Error('processed_action_ids must be a list.');
    }
    const processedActionIds = (processedRaw ?? []).map((value, index) => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invalid processed_action_ids[${index}] for ${occurrenceId}.`);
      }
      return value;
    });

    const unknownFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!RESPONSE_KEYS.has(key)) unknownFields[key] = value;
    }

    result[mapKey] = {
      occurrenceId,
      sourceId: optionalString(raw.source_id, 'source_id'),
      reminderId: optionalString(raw.reminder_id, 'reminder_id'),
      slotIndex: optionalNonNegativeInt(raw.slot_index, 'slot_index'),
      dueAt: optionalIsoDate(raw.due_at, 'due_at'),
      completedAt: optionalIsoDate(raw.completed_at, 'completed_at'),
      skippedAt: optionalIsoDate(raw.skipped_at, 'skipped_at'),
      recordedAt: optionalIsoDate(raw.recorded_at, 'recorded_at'),
      snoozedUntil: optionalIsoDate(raw.snoozed_until, 'snoozed_until'),
      dismissedAt: optionalIsoDate(raw.dismissed_at, 'dismissed_at'),
      ignoredCount: optionalNonNegativeInt(raw.ignored_count, 'ignored_count') ?? 0,
      processedActionIds: [...new Set(processedActionIds)],
      unknownFields: Object.keys(unknownFields).length > 0 ? unknownFields : undefined,
    };
  }

  return result;
}

function serializeResponse(response: OccurrenceResponseState): Record<string, unknown> {
  return {
    ...(response.unknownFields ?? {}),
    occurrence_id: response.occurrenceId,
    ...(response.sourceId ? { source_id: response.sourceId } : {}),
    ...(response.reminderId ? { reminder_id: response.reminderId } : {}),
    ...(response.slotIndex != null ? { slot_index: response.slotIndex } : {}),
    ...(response.dueAt ? { due_at: response.dueAt } : {}),
    ...(response.completedAt ? { completed_at: response.completedAt } : {}),
    ...(response.skippedAt ? { skipped_at: response.skippedAt } : {}),
    ...(response.recordedAt ? { recorded_at: response.recordedAt } : {}),
    ...(response.snoozedUntil ? { snoozed_until: response.snoozedUntil } : {}),
    ...(response.dismissedAt ? { dismissed_at: response.dismissedAt } : {}),
    ...(response.ignoredCount !== 0 ? { ignored_count: response.ignoredCount } : {}),
    ...(response.processedActionIds.length > 0
      ? { processed_action_ids: [...new Set(response.processedActionIds)].sort() }
      : {}),
  };
}

function replaceOccurrenceResponsesInMarkdown(
  markdown: string,
  responses: Record<string, OccurrenceResponseState>,
): string {
  const parsed = markdown.trim()
    ? ObjectParser.parseMarkdown(markdown)
    : { frontmatter: {}, body: '# Shared Occurrence State V1' };
  if (
    parsed.frontmatter.type != null &&
    parsed.frontmatter.type !== 'shared_occurrence_state'
  ) {
    throw new Error('Refusing to overwrite a non-occurrence-state file.');
  }

  const frontmatter: Record<string, unknown> = {
    ...parsed.frontmatter,
    schema_version: 1,
    type: 'shared_occurrence_state',
    updated_at: new Date().toISOString(),
    occurrence_responses: Object.fromEntries(
      Object.entries(responses)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, response]) => [key, serializeResponse(response)]),
    ),
  };
  const body = parsed.body.trim() || '# Shared Occurrence State V1';
  return ObjectParser.serializeMarkdown(frontmatter, body);
}

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
    let file = this.vault.getAbstractFileByPath(SHARED_OCCURRENCE_STATE_PATH);
    if (file == null) {
      if (!this.vault.getAbstractFileByPath('sessions')) {
        await this.vault.createFolder('sessions');
      }
      const initial = replaceOccurrenceResponsesInMarkdown('', responses);
      await this.vault.create(SHARED_OCCURRENCE_STATE_PATH, initial);
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
