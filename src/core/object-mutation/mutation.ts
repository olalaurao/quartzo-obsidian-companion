import { ObjectParser } from '../objects';
import { hasFullObjectMutationSupport } from './capabilities';

export interface ObjectMutationIdentity {
  id: string;
  type: string;
}

export interface SafeObjectMutation {
  set?: Record<string, unknown>;
  unset?: string[];
  body?: string;
}

const PROTECTED_KEYS = new Set(['id', 'type']);

function validatePatch(patch: SafeObjectMutation): void {
  for (const key of Object.keys(patch.set ?? {})) {
    if (PROTECTED_KEYS.has(key)) {
      throw new Error(`Object mutation cannot change protected field: ${key}`);
    }
  }
  for (const key of patch.unset ?? []) {
    if (PROTECTED_KEYS.has(key)) {
      throw new Error(`Object mutation cannot clear protected field: ${key}`);
    }
  }
  const title = patch.set?.title;
  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    throw new Error('Object title cannot be empty.');
  }
}

/**
 * Applies a localized mutation to the current Markdown bytes.
 *
 * The current raw frontmatter is the source for the write. We never reconstruct
 * the file from a UI model, so unknown/future fields survive unrelated edits.
 */
export function applySafeObjectMutation(
  currentMarkdown: string,
  expected: ObjectMutationIdentity,
  patch: SafeObjectMutation,
): string {
  if (!hasFullObjectMutationSupport(expected.type)) {
    throw new Error(`Safe Companion editing is not supported for ${expected.type}.`);
  }
  validatePatch(patch);

  const parsed = ObjectParser.parse(currentMarkdown);
  if (parsed.object.id !== expected.id) {
    throw new Error(`Object identity changed on disk: expected ${expected.id}, found ${parsed.object.id}.`);
  }
  if (parsed.object.type !== expected.type) {
    throw new Error(`Object type changed on disk: expected ${expected.type}, found ${parsed.object.type}.`);
  }

  const raw = ObjectParser.parseMarkdown(currentMarkdown);
  const frontmatter: Record<string, unknown> = { ...raw.frontmatter };
  for (const [key, value] of Object.entries(patch.set ?? {})) {
    frontmatter[key] = value;
  }
  for (const key of patch.unset ?? []) {
    delete frontmatter[key];
  }

  const body = patch.body === undefined ? raw.body : patch.body;
  const nextMarkdown = ObjectParser.serializeMarkdown(frontmatter, body);
  const validated = ObjectParser.parse(nextMarkdown);
  if (validated.object.id !== expected.id || validated.object.type !== expected.type) {
    throw new Error('Mutation validation failed: object identity/type was not preserved.');
  }
  return nextMarkdown;
}
