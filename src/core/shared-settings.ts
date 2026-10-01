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

/**
 * Phase of an in-progress structural Object Identification migration.
 * §10 — Transition protocol.
 * - planning: plan created, no mutations yet (not persisted remotely)
 * - applying: local mutations in progress
 * - awaiting_transport: local done, waiting for content transport to other clients
 * - committing: transport confirmed, writing final revision
 * - failed: migration failed, transition must be reviewed
 */
export type ObjectIdentificationTransitionPhase =
  | 'planning'
  | 'applying'
  | 'awaiting_transport'
  | 'committing'
  | 'failed';

/**
 * Transition state present during a structural Object Identification migration (§10).
 * While this is present:
 *  - old and new signatures are both recognized as the same object type (§11)
 *  - conflicting structural TypeSignature edits are disabled
 *  - another client cannot start an incompatible migration
 */
export interface ObjectIdentificationTransition {
  operationId: string;
  objectType: string;
  baseRevision: number;
  targetRevision: number;
  oldSignature: TypeSignature;
  newSignature: TypeSignature;
  phase: ObjectIdentificationTransitionPhase;
  /** Optional: device/client identity for observability — never used for ownership or last-writer-wins. */
  initiatedBy?: string;
}

/**
 * Revision state for Object Identification (§9).
 * revision: monotonic integer, not clock-based.
 * transition: present only during structural migration.
 */
export interface ObjectIdentificationState {
  revision: number;
  transition?: ObjectIdentificationTransition | null;
}

export interface QuartzoSharedSettings {
  schemaVersion: number;
  objectIdentification: ObjectIdentificationState;
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

function parseTransition(value: unknown, typeSignatures: Record<string, TypeSignature>): ObjectIdentificationTransition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const operationId = String(raw.operation_id ?? '').trim();
  const objectType = String(raw.object_type ?? '').trim();
  const phase = String(raw.phase ?? '') as ObjectIdentificationTransitionPhase;
  const validPhases: ObjectIdentificationTransitionPhase[] = ['planning', 'applying', 'awaiting_transport', 'committing', 'failed'];
  if (!operationId || !objectType || !validPhases.includes(phase)) return null;
  const baseRevision = Number(raw.base_revision);
  const targetRevision = Number(raw.target_revision);
  if (!Number.isInteger(baseRevision) || !Number.isInteger(targetRevision)) return null;
  const oldSignature = parseSignature(raw.old_signature, objectType);
  const newSignature = parseSignature(raw.new_signature, objectType);
  if (!oldSignature || !newSignature) return null;
  return {
    operationId,
    objectType,
    baseRevision,
    targetRevision,
    oldSignature,
    newSignature,
    phase,
    initiatedBy: raw.initiated_by != null ? String(raw.initiated_by) : undefined,
  };
  void typeSignatures; // available for future validation
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

  // §9: parse monotonic revision for Object Identification
  const rawOI = asRecord(fm.object_identification);
  const revision = Number.isInteger(Number(rawOI.revision)) ? Number(rawOI.revision) : 0;
  const transition = rawOI.transition != null ? parseTransition(rawOI.transition, typeSignatures) : null;
  const objectIdentification: ObjectIdentificationState = { revision, transition: transition ?? undefined };

  const planner = asRecord(fm.planner);
  const calendar = asRecord(fm.calendar);
  const day = asRecord(fm.day);
  const dayDial = asRecord(fm.day_dial);
  const visibleKinds = Array.isArray(planner.visible_kinds)
    ? planner.visible_kinds.map(value => String(value))
    : [];

  return {
    schemaVersion: Number(fm.schema_version ?? 1),
    objectIdentification,
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

  // §11: During a structural migration, both old and new signatures are recognized as
  // equivalent representations of the same object type — no false conflict between them.
  const transition = settings.objectIdentification?.transition;
  const activeTransition = transition && transition.phase !== 'planning' && transition.phase !== 'failed'
    ? transition
    : null;

  // Build effective signature list: primary signatures + transition equivalents
  const signaturesWithSource: Array<{ key: string; signature: TypeSignature; isTransitionEquivalent: boolean }> = [
    ...Object.entries(settings.typeSignatures).map(([key, sig]) => ({ key, signature: sig, isTransitionEquivalent: false })),
  ];
  if (activeTransition) {
    // Add old signature as an equivalent entry for the transitioning type
    signaturesWithSource.push({
      key: `__transition_old_${activeTransition.objectType}`,
      signature: { ...activeTransition.oldSignature, objectType: activeTransition.objectType },
      isTransitionEquivalent: true,
    });
    // Add new signature as an equivalent entry for the transitioning type
    signaturesWithSource.push({
      key: `__transition_new_${activeTransition.objectType}`,
      signature: { ...activeTransition.newSignature, objectType: activeTransition.objectType },
      isTransitionEquivalent: true,
    });
  }

  const matchedSignatures: ObjectIdentificationMatch[] = [];
  const seenMatchKeys = new Set<string>();

  for (const { signature } of signaturesWithSource) {
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
      const canonicalType = canonicalProductType(settings, signature.objectType);
      const matchKey = `${canonicalType}|${signature.markerType}|${signature.markerValue}`;
      if (!seenMatchKeys.has(matchKey)) {
        seenMatchKeys.add(matchKey);
        matchedSignatures.push({
          objectType: canonicalType,
          markerType: signature.markerType,
          markerValue: signature.markerValue,
          source: signatureSource(signature.markerType, signature.markerValue),
        });
      }
    }
  }

  // Deduplicate by object type
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

  // §11: During transition, matches from both old/new signatures of the same type
  // are NOT a conflict — they are equivalent representations of the same type.
  const transitionCanonical = activeTransition
    ? canonicalProductType(settings, activeTransition.objectType)
    : null;
  const hasConflict = candidates.some(candidate => {
    if (equivalentProductType(settings, candidate, resolvedType)) return false;
    // If both candidate and resolved are the transition type, no conflict
    if (
      transitionCanonical &&
      canonicalProductType(settings, candidate) === transitionCanonical &&
      canonicalProductType(settings, resolvedType) === transitionCanonical
    ) {
      return false;
    }
    return true;
  });

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
