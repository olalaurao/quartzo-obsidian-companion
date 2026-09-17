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
});
