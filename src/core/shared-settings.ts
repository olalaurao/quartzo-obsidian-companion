import { ObjectParser } from './objects';
import type { ObjectType, ParseResult } from './objects/types';

export const SHARED_SETTINGS_PATH = 'app/quartzo_shared_settings.md';

export type MarkerType = 'tag' | 'property' | 'folder';

export interface TypeSignature {
  objectType: string;
  markerType: MarkerType;
  markerValue: string;
  emoji?: string;
  iconName?: string | null;
  colorHex?: string | null;
}

export interface QuartzoSharedSettings {
  schemaVersion: number;
  typeSignatures: Record<string, TypeSignature>;
  folderPaths: Record<string, string>;
  categoryColors: Record<string, string>;
  accentColor: string;
  plannerColorMode: string;
  plannerVisibleKinds: string[];
  plannerShowAdaptiveTimeBlocks: boolean;
  startOfWeek: number;
  dayStartHour: number;
  showDayDialLegend: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringMap(value: unknown): Record<string, string> {
  const source = asRecord(value);
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, String(item)]));
}

export function normalizeSharedFolder(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function normalizeSharedPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+/, '');
}

function parseSignature(value: unknown, key: string): TypeSignature | null {
  const raw = asRecord(value);
  const markerType = String(raw.markerType ?? '');
  const markerValue = String(raw.markerValue ?? '');
  if (!['tag', 'property', 'folder'].includes(markerType) || !markerValue.trim()) return null;
  return {
    objectType: String(raw.objectType ?? key),
    markerType: markerType as MarkerType,
    markerValue,
    emoji: raw.emoji == null ? undefined : String(raw.emoji),
    iconName: raw.iconName == null ? null : String(raw.iconName),
    colorHex: raw.colorHex == null ? null : String(raw.colorHex),
  };
}

export function parseSharedSettings(markdown: string): QuartzoSharedSettings | null {
  const parsed = ObjectParser.parseMarkdown(markdown);
  const fm = parsed.frontmatter;
  if (fm.type !== 'quartzo_shared_settings') return null;

  const rawSignatures = asRecord(fm.type_signatures);
  const typeSignatures: Record<string, TypeSignature> = {};
  for (const [key, value] of Object.entries(rawSignatures)) {
    const signature = parseSignature(value, key);
    if (signature) typeSignatures[key] = signature;
  }

  const planner = asRecord(fm.planner);
  const calendar = asRecord(fm.calendar);
  const day = asRecord(fm.day);
  const dayDial = asRecord(fm.day_dial);
  const visibleKinds = Array.isArray(planner.visible_kinds)
    ? planner.visible_kinds.map(value => String(value))
    : [];

  return {
    schemaVersion: Number(fm.schema_version ?? 1),
    typeSignatures,
    folderPaths: stringMap(fm.folder_paths),
    categoryColors: stringMap(fm.category_colors),
    accentColor: String(fm.accent_color ?? '#F97316'),
    plannerColorMode: String(planner.color_mode ?? 'category'),
    plannerVisibleKinds: visibleKinds,
    plannerShowAdaptiveTimeBlocks: planner.show_adaptive_time_blocks !== false,
    startOfWeek: Number(calendar.start_of_week ?? 1),
    dayStartHour: Number(day.start_hour ?? 0),
    showDayDialLegend: dayDial.show_legend !== false,
  };
}

export function resolveTypeSignature(
  settings: QuartzoSharedSettings | null,
  objectType: string,
): TypeSignature | null {
  if (!settings) return null;
  return settings.typeSignatures[objectType]
    ?? Object.values(settings.typeSignatures).find(signature => signature.objectType === objectType)
    ?? null;
}

export function resolveCreationFolder(
  settings: QuartzoSharedSettings | null,
  objectType: string,
): string | null {
  if (!settings) return null;
  const signature = resolveTypeSignature(settings, objectType);
  if (signature?.markerType === 'folder') {
    const folder = normalizeSharedFolder(signature.markerValue);
    return folder || null;
  }
  const configured = settings.folderPaths[objectType];
  if (!configured) return null;
  const folder = normalizeSharedFolder(configured);
  return folder || null;
}

export function applyTypeSignature(
  frontmatter: Record<string, unknown>,
  body: string,
  signature: TypeSignature | null,
): { frontmatter: Record<string, unknown>; body: string } {
  if (!signature) return { frontmatter: { ...frontmatter }, body };
  const next = { ...frontmatter };
  if (signature.markerType === 'property') {
    const separator = signature.markerValue.indexOf(':');
    if (separator >= 0) {
      const key = signature.markerValue.slice(0, separator).trim();
      const value = signature.markerValue.slice(separator + 1).trim();
      if (key) next[key] = value;
    } else {
      const key = signature.markerValue.trim();
      if (key) next[key] = true;
    }
  }
  if (signature.markerType === 'tag') {
    const marker = signature.markerValue.trim();
    if (marker && !body.split(/\s+/).includes(marker)) {
      body = body.trimEnd() + (body.trim() ? '\n\n' : '') + marker;
    }
  }
  return { frontmatter: next, body };
}

function propertySignatureMatches(frontmatter: Record<string, unknown>, markerValue: string): boolean {
  const separator = markerValue.indexOf(':');
  if (separator < 0) return frontmatter[markerValue.trim()] === true;
  const key = markerValue.slice(0, separator).trim();
  const expected = markerValue.slice(separator + 1).trim().toLowerCase();
  const actual = frontmatter[key];
  if (Array.isArray(actual)) return actual.some(item => String(item).trim().toLowerCase() === expected);
  return String(actual ?? '').trim().toLowerCase() === expected;
}

function tagSignatureMatches(frontmatter: Record<string, unknown>, body: string, markerValue: string): boolean {
  const marker = markerValue.trim();
  const normalized = marker.replace(/^#/, '');
  const tags = frontmatter.tags;
  if (Array.isArray(tags) && tags.some(tag => String(tag).replace(/^#/, '') === normalized)) return true;
  const token = marker.startsWith('#') ? marker : `#${marker}`;
  return body.split(/\s+/).includes(token) || body.split(/\s+/).includes(marker);
}

export function identifyTypeFromSignatures(
  settings: QuartzoSharedSettings | null,
  filePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): ObjectType | null {
  if (!settings) return null;
  const normalizedPath = normalizeSharedPath(filePath);
  const matches = new Set<string>();

  for (const signature of Object.values(settings.typeSignatures)) {
    let matched = false;
    if (signature.markerType === 'folder') {
      const folder = normalizeSharedFolder(signature.markerValue);
      matched = normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
    } else if (signature.markerType === 'property') {
      matched = propertySignatureMatches(frontmatter, signature.markerValue);
    } else if (signature.markerType === 'tag') {
      matched = tagSignatureMatches(frontmatter, body, signature.markerValue);
    }
    if (matched) matches.add(signature.objectType);
  }

  if (matches.size !== 1) return null;
  return [...matches][0] as ObjectType;
}

export function parseObjectWithSharedSettings(
  markdown: string,
  filePath: string,
  settings: QuartzoSharedSettings | null,
): ParseResult {
  try {
    return ObjectParser.parse(markdown);
  } catch (originalError) {
    const parsed = ObjectParser.parseMarkdown(markdown);
    const identified = identifyTypeFromSignatures(settings, filePath, parsed.frontmatter, parsed.body);
    if (!identified) throw originalError;
    return ObjectParser.parse(ObjectParser.serializeMarkdown({ ...parsed.frontmatter, type: identified }, parsed.body));
  }
}
