import { ObjectParser } from '../objects';
import { generateOperationId } from './operation-id';

export interface CanonicalRetirementTombstoneInput {
  id: string;
  deletedAt: string;
  mergedInto?: string;
}

export function canonicalRetirementPath(objectId: string): string {
  const id = objectId.trim();
  if (!id) throw new Error('Canonical retirement requires a non-empty object ID.');
  if (/[\\/]/.test(id) || id === '.' || id === '..') {
    throw new Error(`Object ID cannot be used as a canonical tombstone path: ${objectId}`);
  }
  return `_deleted/${id}.md`;
}

/** Stable archive path for an extra physical copy that shares a logical object ID. */
export function duplicateRetirementPath(objectId: string, sourcePath: string): string {
  canonicalRetirementPath(objectId);
  const hash = generateOperationId('duplicate-retirement', {
    id: objectId.trim(),
    path: sourcePath.replace(/\\/g, '/'),
  }).split('-').pop() ?? 'copy';
  return `_deleted/${objectId.trim()}__duplicate-${hash}.md`;
}

export function buildCanonicalRetirementTombstone(
  input: CanonicalRetirementTombstoneInput,
): string {
  const id = input.id.trim();
  canonicalRetirementPath(id);

  const frontmatter: Record<string, unknown> = {
    id,
    type: '_deleted',
    deleted_at: input.deletedAt,
  };
  if (input.mergedInto) frontmatter.merged_into = input.mergedInto;

  return ObjectParser.serializeMarkdown(frontmatter, '');
}
