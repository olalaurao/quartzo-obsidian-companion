import { ObjectParser } from './objects';
import {
  normalizeSharedFolder,
  type TypeSignature,
} from './shared-settings';

export interface ObjectIdentificationCandidate {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  originalMarkdown?: string;
}

export interface ObjectIdentificationMigrationAction {
  sourcePath: string;
  destinationPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  markdown: string;
  originalMarkdown?: string;
  removeOldMarker: boolean;
  applyNewMarker: boolean;
  moves: boolean;
}

export interface ObjectIdentificationMigrationBlocker {
  code: 'destination_exists' | 'duplicate_destination' | 'invalid_destination';
  path: string;
  message: string;
}

export interface ObjectIdentificationMigrationPlan {
  objectType: string;
  oldSignature: TypeSignature;
  newSignature: TypeSignature;
  actions: ObjectIdentificationMigrationAction[];
  blockers: ObjectIdentificationMigrationBlocker[];
}

interface PropertyMarker {
  key: string;
  value: string | true;
}

export function planObjectIdentificationCandidate(
  oldSignature: TypeSignature,
  newSignature: TypeSignature,
  candidate: ObjectIdentificationCandidate,
): ObjectIdentificationMigrationAction | null {
  if (sameSignature(oldSignature, newSignature)) return null;
  if (!matchesSignature(candidate.frontmatter, candidate.body, candidate.path, oldSignature)) {
    return null;
  }

  const frontmatter = { ...candidate.frontmatter };
  let body = candidate.body;
  const removeOldMarker = oldSignature.markerType !== 'folder';
  const applyNewMarker = newSignature.markerType !== 'folder';

  if (removeOldMarker) {
    body = removeSignature(frontmatter, body, oldSignature);
  }
  if (applyNewMarker) {
    body = applySignature(frontmatter, body, newSignature);
  }

  const destinationPath = destinationFor(candidate.path, newSignature);
  return {
    sourcePath: normalizePath(candidate.path),
    destinationPath,
    frontmatter,
    body,
    markdown: ObjectParser.serializeMarkdown(frontmatter, body),
    originalMarkdown: candidate.originalMarkdown,
    removeOldMarker,
    applyNewMarker,
    moves: normalizePath(candidate.path) !== destinationPath,
  };
}

export function buildObjectIdentificationMigrationPlan(input: {
  objectType: string;
  oldSignature: TypeSignature;
  newSignature: TypeSignature;
  candidates: ObjectIdentificationCandidate[];
  existingPaths: string[];
}): ObjectIdentificationMigrationPlan {
  const actions: ObjectIdentificationMigrationAction[] = [];
  const blockers: ObjectIdentificationMigrationBlocker[] = [];
  const existing = new Set(input.existingPaths.map(path => normalizePath(path)).filter(Boolean));
  const destinations = new Map<string, string>();

  for (const candidate of input.candidates) {
    const action = planObjectIdentificationCandidate(input.oldSignature, input.newSignature, candidate);
    if (!action) continue;

    const destination = normalizePath(action.destinationPath);
    const source = normalizePath(action.sourcePath);
    if (!destination || destination.startsWith('../') || destination.includes('/../')) {
      blockers.push({
        code: 'invalid_destination',
        path: action.destinationPath,
        message: 'Destination path is outside the vault or invalid.',
      });
    }
    const previous = destinations.get(destination);
    if (previous && previous !== source) {
      blockers.push({
        code: 'duplicate_destination',
        path: action.destinationPath,
        message: 'Two migrated objects would write the same destination.',
      });
    }
    destinations.set(destination, source);
    if (destination !== source && existing.has(destination)) {
      blockers.push({
        code: 'destination_exists',
        path: action.destinationPath,
        message: 'Destination already exists.',
      });
    }
    actions.push(action);
  }

  return {
    objectType: input.objectType,
    oldSignature: input.oldSignature,
    newSignature: input.newSignature,
    actions,
    blockers,
  };
}

export function objectIdentificationPlanSummary(plan: ObjectIdentificationMigrationPlan): {
  markerUpdates: number;
  moves: number;
} {
  return {
    markerUpdates: plan.actions.filter(action => action.removeOldMarker || action.applyNewMarker).length,
    moves: plan.actions.filter(action => action.moves).length,
  };
}

export function matchesSignature(
  frontmatter: Record<string, unknown>,
  body: string,
  path: string,
  signature: TypeSignature,
): boolean {
  if (signature.markerType === 'folder') {
    const folder = normalizeSharedFolder(signature.markerValue);
    const normalizedPath = normalizePath(path);
    return normalizedPath === folder || normalizedPath.startsWith(`${folder}/`);
  }
  if (signature.markerType === 'property') {
    const marker = propertyMarker(signature.markerValue);
    if (!marker) return false;
    const actual = frontmatter[marker.key];
    if (marker.value === true) return actual === true || actual != null;
    if (Array.isArray(actual)) {
      return actual.some(item => normalizePropertyValue(item) === normalizePropertyValue(marker.value));
    }
    return normalizePropertyValue(actual) === normalizePropertyValue(marker.value);
  }
  const tag = canonicalTag(signature.markerValue).slice(1);
  const tags = frontmatter.tags;
  if (Array.isArray(tags) && tags.some(item => String(item).replace(/^#/, '') === tag)) {
    return true;
  }
  return body.split(/\s+/).includes(`#${tag}`);
}

function applySignature(
  frontmatter: Record<string, unknown>,
  body: string,
  signature: TypeSignature,
): string {
  if (signature.markerType === 'property') {
    const marker = propertyMarker(signature.markerValue);
    if (marker) frontmatter[marker.key] = marker.value;
    return body;
  }
  if (signature.markerType === 'tag') {
    const tag = canonicalTag(signature.markerValue);
    if (body.split(/\s+/).includes(tag)) return body;
    const trimmed = body.trimEnd();
    return trimmed ? `${trimmed}\n\n${tag}` : tag;
  }
  return body;
}

function removeSignature(
  frontmatter: Record<string, unknown>,
  body: string,
  signature: TypeSignature,
): string {
  if (signature.markerType === 'property') {
    const marker = propertyMarker(signature.markerValue);
    if (marker) delete frontmatter[marker.key];
    return body;
  }
  if (signature.markerType === 'tag') {
    const tag = canonicalTag(signature.markerValue).slice(1);
    const tags = frontmatter.tags;
    if (Array.isArray(tags)) {
      const kept = tags.filter(item => String(item).replace(/^#/, '') !== tag);
      if (kept.length > 0) frontmatter.tags = kept;
      else delete frontmatter.tags;
    }
    const regex = new RegExp(`(?<!\\S)#${escapeRegExp(tag)}(?!\\S)`, 'g');
    return body.replace(regex, '').trim();
  }
  return body;
}

function destinationFor(sourcePath: string, newSignature: TypeSignature): string {
  const normalized = normalizePath(sourcePath);
  if (newSignature.markerType !== 'folder') return normalized;
  const folder = normalizeSharedFolder(newSignature.markerValue);
  const fileName = normalized.split('/').at(-1) ?? '';
  return folder ? `${folder}/${fileName}` : fileName;
}

function sameSignature(left: TypeSignature, right: TypeSignature): boolean {
  return left.markerType === right.markerType && left.markerValue.trim() === right.markerValue.trim();
}

function propertyMarker(value: string): PropertyMarker | null {
  const separator = value.indexOf(':');
  if (separator < 0) {
    const key = value.trim();
    return key ? { key, value: true } : null;
  }
  const key = value.slice(0, separator).trim();
  const markerValue = value.slice(separator + 1).trim();
  return key ? { key, value: markerValue } : null;
}

function normalizePropertyValue(value: unknown): string {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '').toLowerCase();
}

function canonicalTag(value: string): string {
  const tag = value.trim().replace(/^#+/, '');
  return `#${tag}`;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
