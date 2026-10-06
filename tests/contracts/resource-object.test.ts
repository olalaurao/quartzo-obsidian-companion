import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ObjectParser } from '../../src/core/objects/parser';
import type { Resource } from '../../src/core/objects/types';

type ResourceFixture = {
  id: string;
  type: 'resource';
  markdown: string;
  expected: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadResourceFixture(): ResourceFixture {
  const fixturePath = path.resolve('contracts/quartzo/object_fixtures/fixtures.json');
  const raw: unknown = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Object fixtures must be an array');

  for (const item of raw) {
    if (
      isRecord(item) &&
      item.type === 'resource' &&
      typeof item.id === 'string' &&
      typeof item.markdown === 'string' &&
      isRecord(item.expected)
    ) {
      return {
        id: item.id,
        type: 'resource',
        markdown: item.markdown,
        expected: item.expected,
      };
    }
  }
  throw new Error('Canonical Resource fixture is missing');
}

const fixture = loadResourceFixture();

describe('Resource object contract', () => {
  it('parses the canonical Resource fixture', () => {
    const parsed = ObjectParser.parse(fixture.markdown);
    expect(parsed.object.type).toBe('resource');
    expect(parsed.object).toMatchObject(fixture.expected);
    expect(parsed.unknownFields).toEqual([]);
  });

  it('survives parse -> serialize -> parse without losing canonical fields', () => {
    const first = ObjectParser.parse(fixture.markdown);
    const serialized = ObjectParser.serialize(first.object);
    const second = ObjectParser.parse(serialized);
    expect(second.object).toMatchObject(fixture.expected);
  });

  it('persists supported Resource mutations including canonical links', () => {
    const parsed = ObjectParser.parse(fixture.markdown);
    if (parsed.object.type !== 'resource') throw new Error('Expected Resource fixture');

    const mutated: Resource = {
      ...parsed.object,
      status: 'completed',
      priority: 'low',
      rating: 5,
      links: ['[[resource/lord-of-the-rings]]', '[[resource/silmarillion]]'],
      categories: ['reading', 'fantasy'],
    };
    const reparsed = ObjectParser.parse(ObjectParser.serialize(mutated));
    expect(reparsed.object).toMatchObject({
      type: 'resource',
      status: 'completed',
      priority: 'low',
      rating: 5,
      links: ['[[resource/lord-of-the-rings]]', '[[resource/silmarillion]]'],
      categories: ['reading', 'fantasy'],
    });
  });

  it('roundtrips extensible media types used by Quartzo and Companion', () => {
    for (const mediaType of ['Sewing Pattern', 'Tool', 'Research Database']) {
      const markdown = `---
id: resource-${mediaType.toLowerCase().replace(/\s+/g, '-')}
type: resource
title: ${mediaType} Resource
media_type: ${mediaType}
status: toConsume
priority: high
source_url: https://example.com/${mediaType.toLowerCase().replace(/\s+/g, '-')}
categories:
  - Sewing
tags:
  - dress
links:
  - '[[projects/make-linen-wrap-dress]]'
---
Notes for ${mediaType}.
`;
      const parsed = ObjectParser.parse(markdown);
      const serialized = ObjectParser.serialize(parsed.object);
      const reparsed = ObjectParser.parse(serialized);
      expect(reparsed.object).toMatchObject({
        type: 'resource',
        media_type: mediaType,
        status: 'toConsume',
        priority: 'high',
        categories: ['Sewing'],
        tags: ['dress'],
        links: ['[[projects/make-linen-wrap-dress]]'],
        body: `Notes for ${mediaType}.`,
      });
    }
  });

  it('preserves future Resource frontmatter fields through roundtrip', () => {
    const withFutureField = fixture.markdown.replace(
      '\n---\nA hobbit goes on an unexpected journey.',
      '\nfuture_resource_field: preserve-me\n---\nA hobbit goes on an unexpected journey.',
    );
    const first = ObjectParser.parse(withFutureField);
    expect(first.unknownFields).toContain('future_resource_field');

    const unknown: Record<string, unknown> = {
      future_resource_field: first.object.future_resource_field,
    };
    const second = ObjectParser.parse(ObjectParser.serialize(first.object, unknown));
    expect(second.object.future_resource_field).toBe('preserve-me');
    expect(second.unknownFields).toContain('future_resource_field');
  });

  it('roundtrips Book, Movie and TV catalog Resources without reclassification or field loss', () => {
    const cases = [
      {
        id: 'book-catalog-fixture',
        mediaType: 'Book',
        title: 'The Left Hand of Darkness',
        aliases: ['A Mao Esquerda da Escuridao'],
        extraFields: `
author: Ursula K. Le Guin
year: 1969
pages: 304
isbn: "9780441478125"
google_books_id: google-book-123
title_original: The Left Hand of Darkness
title_pt_br: A Mao Esquerda da Escuridao`,
        expectedIds: {
          isbn: '9780441478125',
          google_books_id: 'google-book-123',
        },
      },
      {
        id: 'movie-catalog-fixture',
        mediaType: 'Movie',
        title: 'Cidade de Deus',
        aliases: ['City of God'],
        extraFields: `
year: 2002
imdb_id: tt0317248
title_original: Cidade de Deus`,
        expectedIds: {
          imdb_id: 'tt0317248',
        },
      },
      {
        id: 'tv-catalog-fixture',
        mediaType: 'TV',
        title: 'Severance',
        aliases: ['Ruptura'],
        extraFields: `
year: 2022
imdb_id: tt11280740
title_original: Severance
title_pt_br: Ruptura`,
        expectedIds: {
          imdb_id: 'tt11280740',
        },
      },
    ];

    for (const item of cases) {
      const markdown = `---
id: ${item.id}
type: resource
title: ${item.title}
media_type: ${item.mediaType}
cover_image: https://img.example/${item.id}.jpg
source_url: https://example.com/${item.id}
synopsis: Preserved catalog synopsis
aliases:
${item.aliases.map(alias => `  - ${alias}`).join('\n')}
status: toConsume
future_catalog_field: preserve-${item.mediaType}
${item.extraFields}
---
Catalog body for ${item.mediaType}.
`;

      const first = ObjectParser.parse(markdown);
      expect(first.object.type).toBe('resource');
      expect(first.object.media_type).toBe(item.mediaType);
      expect(first.object.aliases).toEqual(item.aliases);
      expect(first.object).toMatchObject(item.expectedIds);
      expect(first.unknownFields).toEqual(['synopsis', 'future_catalog_field']);

      if (first.object.type !== 'resource') throw new Error('Expected Resource');
      const edited: Resource = {
        ...first.object,
        status: 'completed',
        rating: 4,
      };
      const unknown: Record<string, unknown> = {};
      for (const field of first.unknownFields) {
        unknown[field] = first.object[field];
      }

      const reparsed = ObjectParser.parse(ObjectParser.serialize(edited, unknown));
      expect(reparsed.object).toMatchObject({
        id: item.id,
        type: 'resource',
        media_type: item.mediaType,
        title: item.title,
        aliases: item.aliases,
        status: 'completed',
        rating: 4,
        source_url: `https://example.com/${item.id}`,
        cover_image: `https://img.example/${item.id}.jpg`,
        synopsis: 'Preserved catalog synopsis',
        future_catalog_field: `preserve-${item.mediaType}`,
        ...item.expectedIds,
      });
      expect(reparsed.object.type).toBe('resource');
      expect(reparsed.object.media_type).toBe(item.mediaType);
      expect(reparsed.unknownFields).toEqual(['synopsis', 'future_catalog_field']);
    }
  });
});
