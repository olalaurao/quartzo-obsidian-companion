import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyUserLinkSelection,
  mergePristineMetadata,
  normalizeLinkCaptureUrl,
  suggestLinkFromHtml,
  suggestLinkFromUrl,
  type LinkCaptureSuggestion,
} from '../../src/core/link-capture/policy';

type Vector = Record<string, unknown> & { id: string; kind: string };

function vectors(): Vector[] {
  const raw: unknown = JSON.parse(fs.readFileSync(path.resolve('contracts/quartzo/link_capture/vectors.json'), 'utf8'));
  if (!Array.isArray(raw)) throw new Error('Link Capture vectors must be an array');
  return raw.map(item => {
    if (!item || typeof item !== 'object' || typeof (item as Vector).id !== 'string' || typeof (item as Vector).kind !== 'string') {
      throw new Error('Invalid Link Capture vector');
    }
    return item as Vector;
  });
}

function expected(vector: Vector): Partial<LinkCaptureSuggestion> {
  return vector.expected as Partial<LinkCaptureSuggestion>;
}

describe('Link Capture contract', () => {
  const all = vectors();

  it('has unique vector IDs', () => {
    expect(new Set(all.map(vector => vector.id)).size).toBe(all.length);
  });

  for (const vector of all.filter(item => item.kind === 'detect_url')) {
    it(`matches URL vector ${vector.id}`, () => {
      expect(suggestLinkFromUrl(vector.url as string)).toMatchObject(expected(vector));
    });
  }

  for (const vector of all.filter(item => item.kind === 'detect_html')) {
    it(`matches structured HTML vector ${vector.id}`, () => {
      expect(suggestLinkFromHtml(vector.html as string, vector.url as string)).toMatchObject(expected(vector));
    });
  }

  for (const vector of all.filter(item => item.kind === 'override')) {
    it(`honors selected destination vector ${vector.id}`, () => {
      expect(applyUserLinkSelection(
        vector.suggested as LinkCaptureSuggestion,
        vector.selected as LinkCaptureSuggestion,
      )).toMatchObject(expected(vector));
    });
  }

  for (const vector of all.filter(item => item.kind === 'merge')) {
    it(`merges pristine metadata vector ${vector.id}`, () => {
      expect(mergePristineMetadata(
        vector.current as Record<string, string>,
        vector.incoming as Record<string, string>,
        new Set(vector.dirty as string[]),
      )).toEqual(vector.expected);
    });
  }

  for (const vector of all.filter(item => item.kind === 'normalize_url')) {
    it(`normalizes duplicate URL vector ${vector.id}`, () => {
      expect(normalizeLinkCaptureUrl(vector.left as string) === normalizeLinkCaptureUrl(vector.right as string)).toBe(vector.expectedEqual);
    });
  }
});
