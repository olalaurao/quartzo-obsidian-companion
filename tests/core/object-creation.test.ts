import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/core/object-creation';
import { ObjectParser } from '../../src/core/objects';
import type { QuartzoSharedSettings } from '../../src/core/shared-settings';

const settings: QuartzoSharedSettings = {
  schemaVersion: 1,
  typeSignatures: {},
  folderPaths: {
    resource: 'resources',
    entry: 'journal/entries',
  },
  categoryColors: {},
  accentColor: '#F97316',
  plannerColorMode: 'category',
  plannerVisibleKinds: [],
  plannerShowAdaptiveTimeBlocks: true,
  startOfWeek: 1,
  dayStartHour: 0,
  showDayDialLegend: true,
};

describe('buildQuickAddDocument', () => {
  it('creates a Resource in the canonical configured folder with links and categories', () => {
    const created = buildQuickAddDocument(
      settings,
      'resource',
      {
        title: 'The Hobbit',
        body: 'A hobbit goes on an unexpected journey.',
        resource: {
          mediaType: 'Book',
          sourceUrl: 'https://openlibrary.org/works/OL262758W',
          status: 'inProgress',
          priority: 'high',
          categories: ['reading', 'fantasy'],
          links: ['[[resources/lord-of-the-rings]]'],
          author: 'J.R.R. Tolkien',
          year: 1937,
          pages: 310,
          isbn: '9780547928227',
        },
      },
      'resource-hobbit',
    );

    expect(created.path).toBe('resources/resource-hobbit.md');
    const parsed = ObjectParser.parse(created.content);
    expect(parsed.object).toMatchObject({
      id: 'resource-hobbit',
      type: 'resource',
      title: 'The Hobbit',
      media_type: 'Book',
      source_url: 'https://openlibrary.org/works/OL262758W',
      status: 'inProgress',
      rating: 0,
      priority: 'high',
      categories: ['reading', 'fantasy'],
      links: ['[[resources/lord-of-the-rings]]'],
      author: 'J.R.R. Tolkien',
      year: 1937,
      pages: 310,
      isbn: '9780547928227',
      body: 'A hobbit goes on an unexpected journey.',
    });
  });

  it('requires a Resource title and media type instead of inventing identity', () => {
    expect(() => buildQuickAddDocument(
      settings,
      'resource',
      { title: '   ', body: '', resource: { mediaType: 'Book' } },
      'resource-no-title',
    )).toThrow('Resource title is required.');

    expect(() => buildQuickAddDocument(
      settings,
      'resource',
      { title: 'Untyped', body: '', resource: { mediaType: '   ' } },
      'resource-no-type',
    )).toThrow('Resource type is required.');
  });

  it('fails closed when no canonical Resource creation folder is configured', () => {
    expect(() => buildQuickAddDocument(
      { ...settings, folderPaths: {} },
      'resource',
      { title: 'No Folder', body: '', resource: { mediaType: 'Book' } },
      'resource-no-folder',
    )).toThrow('No canonical creation folder is configured for resource');
  });
});
