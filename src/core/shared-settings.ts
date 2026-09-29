import { ObjectParser } from './objects';
import type { ObjectIdentificationMatch, ObjectIdentificationResult, ObjectType, ParseResult } from './objects/types';

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
  typeAliases: Record<string, string[]>;
  typePriority: string[];
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

function stringListMap(value: unknown): Record<string, string[]> {
  const source = asRecord(value);
  const out: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(source)) {
    out[key] = Array.isArray(item) ? item.map(value => String(value)) : [];
  }
  return out;
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
    typeAliases: stringListMap(fm.type_aliases),
    typePriority: Array.isArray(fm.type_priority) ? fm.type_priority.map(value => String(value)) : Object.keys(typeSignatures),
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

function canonicalProductType(settings: QuartzoSharedSettings | null, type: string): string {
  if (!settings) return type;
  for (const [canonical, aliases] of Object.entries(settings.typeAliases)) {
    if (canonical === type || aliases.includes(type)) return canonical;
  }
  const signature = resolveTypeSignature(settings, type);
  return signature?.objectType ?? type;
}

function equivalentProductType(settings: QuartzoSharedSettings | null, left: string, right: string): boolean {
  return canonicalProductType(settings, left) === canonicalProductType(settings, right);
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

function signatureSource(markerType: MarkerType, markerValue: string): string {
  if (markerType === 'folder') return `Folder \`${markerValue}\``;
  if (markerType === 'tag') return `Tag \`${markerValue.startsWith('#') ? markerValue : `#${markerValue}`}\``;
  return `Property \`${markerValue}\``;
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
  const identification = identifyObjectFromSignatures(settings, filePath, frontmatter, body);
  return identification.resolvedType as ObjectType | null;
}

export function identifyObjectFromSignatures(
  settings: QuartzoSharedSettings | null,
  filePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): ObjectIdentificationResult {
  if (!settings) {
    return {
      resolvedType: null,
      matchedSignatures: [],
      hasConflict: false,
    };
  }
  const normalizedPath = normalizeSharedPath(filePath);
  const matchedSignatures: ObjectIdentificationMatch[] = [];

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
    if (matched) {
      matchedSignatures.push({
        objectType: canonicalProductType(settings, signature.objectType),
        markerType: signature.markerType,
        markerValue: signature.markerValue,
        source: signatureSource(signature.markerType, signature.markerValue),
      });
    }
  }

  const candidates = [...new Set(matchedSignatures.map(match => match.objectType))];
  if (candidates.length === 0) {
    return {
      resolvedType: null,
      matchedSignatures,
      hasConflict: false,
    };
  }

  const priority = settings.typePriority.length > 0 ? settings.typePriority : Object.keys(settings.typeSignatures);
  const canonicalPriority = priority.map(type => canonicalProductType(settings, type));
  const resolvedType = candidates
    .slice()
    .sort((left, right) => {
      const leftPriority = canonicalPriority.indexOf(left);
      const rightPriority = canonicalPriority.indexOf(right);
      const normalizedLeft = leftPriority < 0 ? Number.MAX_SAFE_INTEGER : leftPriority;
      const normalizedRight = rightPriority < 0 ? Number.MAX_SAFE_INTEGER : rightPriority;
      return normalizedLeft - normalizedRight || left.localeCompare(right);
    })[0];
  const hasConflict = candidates.some(candidate => !equivalentProductType(settings, candidate, resolvedType));
  const resolutionReason = hasConflict
    ? `${labelForType(resolvedType)} has higher Object Identification priority.`
    : `${labelForType(resolvedType)} is identified by Object Identification.`;

  return {
    resolvedType,
    matchedSignatures,
    hasConflict,
    resolutionReason,
    conflictDetails: hasConflict ? {
      winner: resolvedType,
      candidates,
      reason: resolutionReason,
      explanation: `${matchedSignatures.map(match => `${match.source} identifies this file as ${labelForType(match.objectType)}`).join('. ')}. Treated as ${labelForType(resolvedType)} because it has higher Object Identification priority.`,
    } : undefined,
  };
}

export function parseObjectWithSharedSettings(
  markdown: string,
  filePath: string,
  settings: QuartzoSharedSettings | null,
): ParseResult {
  const parsed = ObjectParser.parseMarkdown(markdown);
  const identification = identifyObjectFromSignatures(settings, filePath, parsed.frontmatter, parsed.body);
  const typeForParse = identification.resolvedType ?? parsed.frontmatter.type;
  const markdownForParse = typeForParse == null
    ? markdown
    : ObjectParser.serializeMarkdown({ ...parsed.frontmatter, type: typeForParse }, parsed.body);
  try {
    const result = ObjectParser.parse(markdownForParse);
    return { ...result, identification };
  } catch (originalError) {
    if (!identification.resolvedType) throw originalError;
    const result = ObjectParser.parse(ObjectParser.serializeMarkdown({ ...parsed.frontmatter, type: identification.resolvedType }, parsed.body));
    return { ...result, identification };
  }
}

function labelForType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}
