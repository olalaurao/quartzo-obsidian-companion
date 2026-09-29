import { describe, expect, it } from 'vitest';
import { queryVaultObjects, searchVaultObjects } from '../../src/core/object-query';
import type { IndexedObject, VaultIndex } from '../../src/vault/index/types';

function object(
  id: string,
  type: string,
  title: string,
  extras: Record<string, unknown> = {},
  body = '',
): IndexedObject {
  return {
    id,
    type,
    path: `${type}/${id}.md`,
    frontmatter: { id, type, title, ...extras },
    body,
  };
}

function index(objects: IndexedObject[]): VaultIndex {
  return {
    files: new Map(),
    objects: new Map(objects.map(value => [value.id, value])),
    lastModified: 0,
  };
}

describe('canonical object query', () => {
  const vault = index([
    object('book-1', 'resource', 'The Hobbit', { author: 'Tolkien', categories: ['reading'] }),
    object('task-1', 'task', 'Read chapter', { priority: 'high' }, 'Hobbit notes'),
    {
      ...object('conflict-1', 'project', 'Mixed markers'),
      identification: {
        resolvedType: 'project',
        matchedSignatures: [],
        hasConflict: true,
      },
    },
    object('archived-1', 'resource', 'Old Hobbit', { archived: true }),
    object('deleted-1', 'resource', 'Deleted Hobbit', { deleted: true }),
    object('entry-1', 'entry', 'Morning log', { date: '2026-09-19' }),
  ]);

  it('searches title, identity, type, body and useful scalar/list metadata', () => {
    expect(searchVaultObjects(vault, 'hobbit').map(value => value.id)).toEqual(['book-1', 'task-1']);
    expect(searchVaultObjects(vault, 'tolkien').map(value => value.id)).toEqual(['book-1']);
    expect(searchVaultObjects(vault, 'task-1').map(value => value.id)).toEqual(['task-1']);
    expect(searchVaultObjects(vault, 'entry').map(value => value.id)).toEqual(['entry-1']);
  });

  it('filters types and archived objects without creating another index', () => {
    expect(queryVaultObjects(vault, { types: ['resource'] }).map(value => value.id)).toEqual(['book-1']);
    expect(queryVaultObjects(vault, { types: ['resource'], includeArchived: true }).map(value => value.id))
      .toEqual(['archived-1', 'book-1']);
    expect(queryVaultObjects(vault, { types: ['resource'], archiveFilter: 'archived_only' }).map(value => value.id))
      .toEqual(['archived-1']);
    expect(queryVaultObjects(vault, { types: ['resource'], archiveFilter: 'include_archived' }).map(value => value.id))
      .not.toContain('deleted-1');
  });

  it('supports picker exclusions and deterministic limits', () => {
    expect(queryVaultObjects(vault, { excludeIds: ['book-1'], limit: 2 }).map(value => value.id))
      .toEqual(['conflict-1', 'entry-1']);
  });

  it('filters type conflicts from the canonical index projection', () => {
    expect(queryVaultObjects(vault, { hasTypeConflict: true }).map(value => value.id))
      .toEqual(['conflict-1']);
    expect(queryVaultObjects(vault, { conflictFilter: 'clean' }).map(value => value.id))
      .toEqual(['entry-1', 'task-1', 'book-1']);
  });

  it('sorts with every Browse ordering option deterministically', () => {
    const sortable = index([
      object('b', 'task', 'Bravo', { created_at: '2026-09-20T10:00:00.000Z', updated_at: '2026-09-21T10:00:00.000Z' }),
      object('a', 'resource', 'Alpha', { created_at: '2026-09-18T10:00:00.000Z', updated_at: '2026-09-23T10:00:00.000Z' }),
      object('c', 'entry', 'Charlie', { created_at: '2026-09-19T10:00:00.000Z', updated_at: '2026-09-22T10:00:00.000Z' }),
    ]);

    expect(queryVaultObjects(sortable, { sort: 'title_asc' }).map(value => value.id)).toEqual(['a', 'b', 'c']);
    expect(queryVaultObjects(sortable, { sort: 'title_desc' }).map(value => value.id)).toEqual(['c', 'b', 'a']);
    expect(queryVaultObjects(sortable, { sort: 'type_asc' }).map(value => value.id)).toEqual(['c', 'a', 'b']);
    expect(queryVaultObjects(sortable, { sort: 'type_desc' }).map(value => value.id)).toEqual(['b', 'a', 'c']);
    expect(queryVaultObjects(sortable, { sort: 'updated_desc' }).map(value => value.id)).toEqual(['a', 'c', 'b']);
    expect(queryVaultObjects(sortable, { sort: 'updated_asc' }).map(value => value.id)).toEqual(['b', 'c', 'a']);
    expect(queryVaultObjects(sortable, { sort: 'created_desc' }).map(value => value.id)).toEqual(['b', 'c', 'a']);
    expect(queryVaultObjects(sortable, { sort: 'created_asc' }).map(value => value.id)).toEqual(['a', 'c', 'b']);
    expect(queryVaultObjects(sortable, { sort: 'path_asc' }).map(value => value.id)).toEqual(['c', 'a', 'b']);
    expect(queryVaultObjects(sortable, { sort: 'path_desc' }).map(value => value.id)).toEqual(['b', 'a', 'c']);
  });
});
