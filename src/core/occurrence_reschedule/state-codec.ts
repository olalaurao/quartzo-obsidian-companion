import { ObjectParser } from '../objects';
import type { OccurrenceTimeOverride, OccurrenceOverrideScope } from './types';

const KNOWN_OVERRIDE_KEYS = new Set([
  'occurrence_id',
  'source_id',
  'scope',
  'start_at_override',
  'end_at_override',
  'updated_at',
]);

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must be a map.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid persisted \`${field}\` in shared planning state.`);
  }
  return value;
}

function optionalIso(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  const parsed = requiredString(value, field);
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new Error(`Invalid persisted date \`${field}\` in shared planning state.`);
  }
  return parsed;
}

function scope(value: unknown): OccurrenceOverrideScope {
  if (value === 'single' || value === 'series' || value === 'thisAndFuture') return value;
  throw new Error('Invalid persisted `scope` in shared planning state.');
}

export function parseOccurrenceTimeOverrides(markdown: string): Record<string, OccurrenceTimeOverride> {
  if (!markdown.trim()) return {};
  const parsed = ObjectParser.parseMarkdown(markdown);
  if (parsed.frontmatter.type !== 'shared_planning_state') {
    throw new Error('Shared planning state has an unexpected type.');
  }
  const rawOverrides = parsed.frontmatter.overrides;
  if (rawOverrides == null) return {};
  const source = asRecord(rawOverrides, 'overrides');
  const result: Record<string, OccurrenceTimeOverride> = {};

  for (const [mapKey, rawValue] of Object.entries(source)) {
    const raw = asRecord(rawValue, `overrides.${mapKey}`);
    const occurrenceId = requiredString(raw.occurrence_id, 'occurrence_id');
    if (occurrenceId !== mapKey) {
      throw new Error(`Occurrence override key mismatch for ${mapKey}.`);
    }
    const unknownFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!KNOWN_OVERRIDE_KEYS.has(key)) unknownFields[key] = value;
    }
    result[mapKey] = {
      occurrenceId,
      sourceId: requiredString(raw.source_id, 'source_id'),
      scope: scope(raw.scope ?? 'single'),
      startAtOverride: optionalIso(raw.start_at_override, 'start_at_override'),
      endAtOverride: optionalIso(raw.end_at_override, 'end_at_override'),
      updatedAt: requiredString(raw.updated_at, 'updated_at'),
      unknownFields: Object.keys(unknownFields).length > 0 ? unknownFields : undefined,
    };
  }
  return result;
}

export function upsertOccurrenceTimeOverrideInMarkdown(
  markdown: string,
  override: OccurrenceTimeOverride,
): string {
  const parsed = markdown.trim()
    ? ObjectParser.parseMarkdown(markdown)
    : { frontmatter: {}, body: '# Shared Planning State V1' };

  if (
    parsed.frontmatter.type != null &&
    parsed.frontmatter.type !== 'shared_planning_state'
  ) {
    throw new Error('Refusing to overwrite a non-planning-state file.');
  }

  const rawOverrides = parsed.frontmatter.overrides == null
    ? {}
    : asRecord(parsed.frontmatter.overrides, 'overrides');
  const existing = rawOverrides[override.occurrenceId] == null
    ? {}
    : asRecord(rawOverrides[override.occurrenceId], `overrides.${override.occurrenceId}`);

  const nextOverride: Record<string, unknown> = {
    ...existing,
    ...(override.unknownFields ?? {}),
    occurrence_id: override.occurrenceId,
    source_id: override.sourceId,
    scope: override.scope,
    ...(override.startAtOverride ? { start_at_override: override.startAtOverride } : {}),
    ...(override.endAtOverride ? { end_at_override: override.endAtOverride } : {}),
    updated_at: override.updatedAt,
  };

  const frontmatter: Record<string, unknown> = {
    ...parsed.frontmatter,
    schema_version: 1,
    type: 'shared_planning_state',
    updated_at: override.updatedAt,
    overrides: {
      ...rawOverrides,
      [override.occurrenceId]: nextOverride,
    },
  };
  const body = parsed.body.trim() || '# Shared Planning State V1';
  return ObjectParser.serializeMarkdown(frontmatter, body);
}
