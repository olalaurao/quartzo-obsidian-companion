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
    object('archived-1', 'resource', 'Old Hobbit', { archived: true }),
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
  });

  it('supports picker exclusions and deterministic limits', () => {
    expect(queryVaultObjects(vault, { excludeIds: ['book-1'], limit: 2 }).map(value => value.id))
      .toEqual(['entry-1', 'task-1']);
  });
});
