import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectResourceMetadataSource,
  findResourceDuplicates,
  normalizeResourceMediaType,
  resourceMediaTypeSuggestions,
  resourceStatusLabel,
  type ResourceDuplicateCandidate,
  type ResourceIdentity,
  type ResourceMetadataSource,
  type ResourceStatus,
} from '../../src/core/resource-capture/policy';

type SourceVector = {
  id: string;
  kind: 'source_detection';
  url: string;
  expectedSource: ResourceMetadataSource;
};

type DuplicateVector = {
  id: string;
  kind: 'duplicate_detection';
  candidate: ResourceIdentity;
  existing: ResourceIdentity[];
  expected: ResourceDuplicateCandidate[];
};

type MediaTypeSuggestionsVector = {
  id: string;
  kind: 'media_type_suggestions';
  configured: string[];
  existing: string[];
  current?: string;
  expectedContains: string[];
  expectedNotContains: string[];
};

type MediaTypeNormalizationVector = {
  id: string;
  kind: 'media_type_normalization';
  input: string;
  expected: string;
};

type StatusLabelsVector = {
  id: string;
  kind: 'status_labels';
  mediaType: string;
  expected: Record<ResourceStatus, string>;
};

type ResourceCaptureVector =
  | SourceVector
  | DuplicateVector
  | MediaTypeSuggestionsVector
  | MediaTypeNormalizationVector
  | StatusLabelsVector;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIdentity(value: unknown): ResourceIdentity {
  if (!isRecord(value) || typeof value.title !== 'string') {
    throw new Error('Invalid Resource identity fixture');
  }
  const identity: ResourceIdentity = { title: value.title };
  for (const key of [
    'id', 'mediaType', 'media_type', 'sourceUrl', 'source_url', 'isbn',
    'googleBooksId', 'google_books_id', 'imdbId', 'imdb_id',
  ] as const) {
    const field = value[key];
    if (typeof field === 'string') identity[key] = field;
  }
  if (typeof value.archived === 'boolean') identity.archived = value.archived;
  return identity;
}

function readExpectedDuplicates(value: unknown): ResourceDuplicateCandidate[] {
  if (!Array.isArray(value)) throw new Error('Invalid duplicate expectation fixture');
  return value.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.reasons)) {
      throw new Error('Invalid duplicate expectation item');
    }
    const reasons = item.reasons.map(reason => {
      if (
        reason !== 'sourceUrl' && reason !== 'isbn' && reason !== 'googleBooksId' &&
        reason !== 'imdbId' && reason !== 'title'
      ) {
        throw new Error(`Invalid duplicate reason: ${String(reason)}`);
      }
      return reason;
    });
    return { id: item.id, reasons };
  });
}

function readVectors(): ResourceCaptureVector[] {
  const fixturePath = path.resolve('contracts/quartzo/resource_capture/vectors.json');
  const raw: unknown = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Resource capture vectors must be an array');

  return raw.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.kind !== 'string') {
      throw new Error('Invalid Resource capture vector');
    }
    if (item.kind === 'source_detection') {
      if (typeof item.url !== 'string' || typeof item.expectedSource !== 'string') {
        throw new Error(`Invalid source vector: ${item.id}`);
      }
      const source = item.expectedSource;
      if (
        source !== 'openLibrary' && source !== 'googleBooks' && source !== 'imdb' &&
        source !== 'amazon' && source !== 'goodreads' && source !== 'unknown'
      ) {
        throw new Error(`Invalid expected source: ${source}`);
      }
      return { id: item.id, kind: 'source_detection', url: item.url, expectedSource: source };
    }
    if (item.kind === 'duplicate_detection') {
      if (!Array.isArray(item.existing)) throw new Error(`Invalid duplicate vector: ${item.id}`);
      return {
        id: item.id,
        kind: 'duplicate_detection',
        candidate: readIdentity(item.candidate),
        existing: item.existing.map(readIdentity),
        expected: readExpectedDuplicates(item.expected),
      };
    }
    if (item.kind === 'media_type_suggestions') {
      if (!Array.isArray(item.configured) || !Array.isArray(item.existing) || !Array.isArray(item.expectedContains) || !Array.isArray(item.expectedNotContains)) {
        throw new Error(`Invalid media type suggestions vector: ${item.id}`);
      }
      return {
        id: item.id,
        kind: 'media_type_suggestions',
        configured: item.configured.map(String),
        existing: item.existing.map(String),
        current: typeof item.current === 'string' ? item.current : undefined,
        expectedContains: item.expectedContains.map(String),
        expectedNotContains: item.expectedNotContains.map(String),
      };
    }
    if (item.kind === 'media_type_normalization') {
      if (typeof item.input !== 'string' || typeof item.expected !== 'string') {
        throw new Error(`Invalid media type normalization vector: ${item.id}`);
      }
      return { id: item.id, kind: 'media_type_normalization', input: item.input, expected: item.expected };
    }
    if (item.kind === 'status_labels') {
      if (typeof item.mediaType !== 'string' || !isRecord(item.expected)) {
        throw new Error(`Invalid status labels vector: ${item.id}`);
      }
      return {
        id: item.id,
        kind: 'status_labels',
        mediaType: item.mediaType,
        expected: item.expected as Record<ResourceStatus, string>,
      };
    }
    throw new Error(`Unknown Resource capture vector kind: ${item.kind}`);
  });
}

const vectors = readVectors();

describe('Resource capture contract', () => {
  for (const vector of vectors) {
    if (vector.kind === 'source_detection') {
      it(`matches source detection vector ${vector.id}`, () => {
        expect(detectResourceMetadataSource(vector.url)).toBe(vector.expectedSource);
      });
    } else if (vector.kind === 'duplicate_detection') {
      it(`matches duplicate detection vector ${vector.id}`, () => {
        expect(findResourceDuplicates(vector.candidate, vector.existing)).toEqual(vector.expected);
      });
    } else if (vector.kind === 'media_type_suggestions') {
      it(`matches media type suggestion vector ${vector.id}`, () => {
        const actual = resourceMediaTypeSuggestions({
          configured: vector.configured,
          existing: vector.existing,
          current: vector.current,
        });
        for (const expected of vector.expectedContains) expect(actual).toContain(expected);
        for (const forbidden of vector.expectedNotContains) expect(actual).not.toContain(forbidden);
        expect(new Set(actual.map(value => value.toLowerCase())).size).toBe(actual.length);
      });
    } else if (vector.kind === 'media_type_normalization') {
      it(`matches media type normalization vector ${vector.id}`, () => {
        expect(normalizeResourceMediaType(vector.input)).toBe(vector.expected);
      });
    } else {
      it(`matches status label vector ${vector.id}`, () => {
        for (const status of ['toConsume', 'inProgress', 'completed', 'dropped'] as ResourceStatus[]) {
          expect(resourceStatusLabel(status, vector.mediaType)).toBe(vector.expected[status]);
        }
      });
    }
  }

  it('never treats an arbitrary HTTPS URL as fetchable metadata', () => {
    expect(detectResourceMetadataSource('https://example.com/video-essay')).toBe('unknown');
  });
});
