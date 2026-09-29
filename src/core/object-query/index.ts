import type { IndexedObject, VaultIndex } from '../../vault/index/types';

export type ObjectQueryArchiveFilter = 'active' | 'include_archived' | 'archived_only';
export type ObjectQueryConflictFilter = 'all' | 'conflicts' | 'clean';
export type ObjectQuerySort =
  | 'relevance'
  | 'title_asc'
  | 'title_desc'
  | 'type_asc'
  | 'type_desc'
  | 'updated_desc'
  | 'updated_asc'
  | 'created_desc'
  | 'created_asc'
  | 'path_asc'
  | 'path_desc';

export interface ObjectQueryOptions {
  query?: string;
  types?: string[];
  excludeIds?: string[];
  includeArchived?: boolean;
  archiveFilter?: ObjectQueryArchiveFilter;
  hasTypeConflict?: boolean;
  conflictFilter?: ObjectQueryConflictFilter;
  sort?: ObjectQuerySort;
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

function isArchived(object: IndexedObject): boolean {
  return object.frontmatter.archived === true;
}

function isDeleted(object: IndexedObject): boolean {
  const normalizedPath = object.path.replace(/\\/g, '/').replace(/^\/+/, '');
  return object.frontmatter.deleted === true ||
    object.frontmatter._deleted === true ||
    normalizedPath === '_deleted' ||
    normalizedPath.startsWith('_deleted/');
}

function frontmatterTime(object: IndexedObject, keys: string[]): number | null {
  for (const key of keys) {
    const value = object.frontmatter[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareTime(left: number | null, right: number | null, direction: 'asc' | 'desc'): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return direction === 'asc' ? left - right : right - left;
}

function compareObjects(
  left: { object: IndexedObject; score: number },
  right: { object: IndexedObject; score: number },
  sort: ObjectQuerySort,
): number {
  const leftObject = left.object;
  const rightObject = right.object;
  const fallback = titleForSort(leftObject).localeCompare(titleForSort(rightObject)) ||
    leftObject.id.localeCompare(rightObject.id);

  if (sort === 'relevance') return right.score - left.score || fallback;
  if (sort === 'title_asc') return fallback;
  if (sort === 'title_desc') return titleForSort(rightObject).localeCompare(titleForSort(leftObject)) ||
    rightObject.id.localeCompare(leftObject.id);
  if (sort === 'type_asc') return compareText(leftObject.type, rightObject.type) || fallback;
  if (sort === 'type_desc') return compareText(rightObject.type, leftObject.type) || fallback;
  if (sort === 'path_asc') return compareText(leftObject.path, rightObject.path) || fallback;
  if (sort === 'path_desc') return compareText(rightObject.path, leftObject.path) || fallback;

  const keys = sort.startsWith('updated')
    ? ['updated_at', 'updatedAt', 'modified_at', 'modifiedAt']
    : ['created_at', 'createdAt'];
  const direction = sort.endsWith('_asc') ? 'asc' : 'desc';
  return compareTime(frontmatterTime(leftObject, keys), frontmatterTime(rightObject, keys), direction) || fallback;
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
  const archiveFilter = options.archiveFilter ?? (options.includeArchived ? 'include_archived' : 'active');
  const conflictFilter = options.conflictFilter ?? (
    options.hasTypeConflict === true ? 'conflicts' :
      options.hasTypeConflict === false ? 'clean' :
        'all'
  );
  const sort = options.sort ?? 'relevance';

  const ranked: Array<{ object: IndexedObject; score: number }> = [];
  for (const object of index.objects.values()) {
    if (isDeleted(object)) continue;
    if (archiveFilter === 'active' && isArchived(object)) continue;
    if (archiveFilter === 'archived_only' && !isArchived(object)) continue;
    if (conflictFilter === 'conflicts' && object.identification?.hasConflict !== true) continue;
    if (conflictFilter === 'clean' && object.identification?.hasConflict === true) continue;
    if (types && !types.has(object.type)) continue;
    if (excluded.has(object.id)) continue;

    const score = searchScore(object, query);
    if (query && score === 0) continue;
    ranked.push({ object, score });
  }

  ranked.sort((left, right) => compareObjects(left, right, sort));

  return ranked.slice(0, limit).map(entry => entry.object);
}

export function searchVaultObjects(
  index: VaultIndex | null,
  query: string,
  options: Omit<ObjectQueryOptions, 'query'> = {},
): IndexedObject[] {
  return queryVaultObjects(index, { ...options, query });
}
