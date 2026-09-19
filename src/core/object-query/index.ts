import type { IndexedObject, VaultIndex } from '../../vault/index/types';

export interface ObjectQueryOptions {
  query?: string;
  types?: string[];
  excludeIds?: string[];
  includeArchived?: boolean;
  limit?: number;
}

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function searchableMetadata(object: IndexedObject): string {
  const values: string[] = [];
  for (const [key, value] of Object.entries(object.frontmatter)) {
    if (key === 'body') continue;
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      values.push(String(value));
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          values.push(String(item));
        }
      }
    }
  }
  return normalized(values.join(' '));
}

function searchScore(object: IndexedObject, query: string): number {
  if (!query) return 1;
  const title = normalized(object.frontmatter.title);
  const id = normalized(object.id);
  const type = normalized(object.type);
  const body = normalized(object.body);
  const metadata = searchableMetadata(object);

  let score = 0;
  if (title === query) score = Math.max(score, 100);
  else if (title.startsWith(query)) score = Math.max(score, 80);
  else if (title.includes(query)) score = Math.max(score, 60);

  if (id === query) score = Math.max(score, 90);
  else if (id.includes(query)) score = Math.max(score, 45);

  if (type === query) score = Math.max(score, 50);
  else if (type.includes(query)) score = Math.max(score, 25);

  if (metadata.includes(query)) score = Math.max(score, 20);
  if (body.includes(query)) score = Math.max(score, 10);
  return score;
}

function titleForSort(object: IndexedObject): string {
  return String(object.frontmatter.title ?? object.id).toLocaleLowerCase();
}

/**
 * Canonical read-only query projection over the existing VaultIndex.
 * No second index/cache is created here.
 */
export function queryVaultObjects(
  index: VaultIndex | null,
  options: ObjectQueryOptions = {},
): IndexedObject[] {
  if (!index) return [];

  const query = normalized(options.query);
  const types = options.types && options.types.length > 0 ? new Set(options.types) : null;
  const excluded = new Set(options.excludeIds ?? []);
  const limit = options.limit == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.trunc(options.limit));

  const ranked: Array<{ object: IndexedObject; score: number }> = [];
  for (const object of index.objects.values()) {
    if (!options.includeArchived && (object.frontmatter.archived === true || object.frontmatter.deleted === true || object.frontmatter._deleted === true)) {
      continue;
    }
    if (types && !types.has(object.type)) continue;
    if (excluded.has(object.id)) continue;

    const score = searchScore(object, query);
    if (query && score === 0) continue;
    ranked.push({ object, score });
  }

  ranked.sort((left, right) =>
    right.score - left.score ||
    titleForSort(left.object).localeCompare(titleForSort(right.object)) ||
    left.object.id.localeCompare(right.object.id)
  );

  return ranked.slice(0, limit).map(entry => entry.object);
}

export function searchVaultObjects(
  index: VaultIndex | null,
  query: string,
  options: Omit<ObjectQueryOptions, 'query'> = {},
): IndexedObject[] {
  return queryVaultObjects(index, { ...options, query });
}
