import { ObjectParser } from '../objects';
import type { ObjectIdentificationMatch } from '../objects/types';
import { parseObjectWithSharedSettings, type QuartzoSharedSettings } from '../shared-settings';

export interface TypeConflictMarkerRemoval {
  objectId: string;
  resolvedType: string;
  filePath: string;
  match: ObjectIdentificationMatch;
}

function propertyKey(markerValue: string): string {
  const separator = markerValue.indexOf(':');
  return (separator >= 0 ? markerValue.slice(0, separator) : markerValue).trim();
}

function removeTagFromBody(body: string, markerValue: string): string {
  const marker = markerValue.trim();
  const normalized = marker.replace(/^#/, '');
  return body
    .split(/(\s+)/)
    .filter(token => token !== marker && token !== `#${normalized}`)
    .join('')
    .trimEnd();
}

export function applyTypeConflictMarkerRemoval(
  currentMarkdown: string,
  request: TypeConflictMarkerRemoval,
  settings: QuartzoSharedSettings | null,
): string {
  if (request.match.markerType === 'folder') {
    throw new Error('Folder marker conflicts require a safe move policy and cannot be auto-fixed yet.');
  }

  const parsedBefore = parseObjectWithSharedSettings(currentMarkdown, request.filePath, settings);
  if (parsedBefore.object.id !== request.objectId) {
    throw new Error(`Object identity changed on disk: expected ${request.objectId}, found ${parsedBefore.object.id}.`);
  }
  if (parsedBefore.object.type !== request.resolvedType || parsedBefore.identification?.hasConflict !== true) {
    throw new Error('Type conflict changed on disk; refresh before applying a fix.');
  }

  const raw = ObjectParser.parseMarkdown(currentMarkdown);
  const frontmatter: Record<string, unknown> = { ...raw.frontmatter };
  let body = raw.body;

  if (request.match.markerType === 'property') {
    const key = propertyKey(request.match.markerValue);
    if (!key) throw new Error('Property marker has no key.');
    delete frontmatter[key];
  } else if (request.match.markerType === 'tag') {
    const marker = request.match.markerValue.trim();
    const normalized = marker.replace(/^#/, '');
    const tags = frontmatter.tags;
    if (Array.isArray(tags)) {
      const nextTags = tags.filter(tag => String(tag).replace(/^#/, '') !== normalized);
      if (nextTags.length > 0) frontmatter.tags = nextTags;
      else delete frontmatter.tags;
    }
    body = removeTagFromBody(body, marker);
  }

  const nextMarkdown = ObjectParser.serializeMarkdown(frontmatter, body);
  const parsedAfter = parseObjectWithSharedSettings(nextMarkdown, request.filePath, settings);
  if (parsedAfter.object.id !== request.objectId) {
    throw new Error('Conflict fix changed the object identity.');
  }
  if (parsedAfter.object.type !== request.resolvedType) {
    throw new Error('Conflict fix would change the resolved type; leaving the file unchanged.');
  }
  return nextMarkdown;
}
