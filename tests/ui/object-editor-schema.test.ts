import { describe, expect, it } from 'vitest';
import type { IndexedObject } from '../../src/vault/index/types';
import {
  editorFieldsForObject,
  parseEditorFieldValue,
} from '../../src/ui/detail/editor-schema';

function object(type: string): IndexedObject {
  return {
    id: `${type}-1`,
    type,
    path: `${type}/one.md`,
    frontmatter: { id: `${type}-1`, type, title: 'One' },
    body: 'Body',
  };
}

describe('object editor schema', () => {
  it('only exposes structured editor fields for full-mutation object families', () => {
    expect(editorFieldsForObject(object('entry')).map(field => field.key)).toEqual(['date', 'time']);
    expect(editorFieldsForObject(object('resource')).some(field => field.key === 'media_type')).toBe(true);
    expect(editorFieldsForObject(object('goal'))).toEqual([]);
  });

  it('parses line lists without comma heuristics', () => {
    const field = { key: 'links', label: 'Links', kind: 'lines' as const };
    expect(parseEditorFieldValue(field, '[[one]]\n [[two]] \n')).toEqual({
      action: 'set',
      value: ['[[one]]', '[[two]]'],
    });
  });

  it('uses explicit unset for optional empty fields', () => {
    const field = { key: 'author', label: 'Author', kind: 'text' as const };
    expect(parseEditorFieldValue(field, '   ')).toEqual({ action: 'unset' });
  });

  it('rejects clearing required fields and invalid numbers', () => {
    const required = { key: 'date', label: 'Date', kind: 'date' as const, required: true };
    expect(() => parseEditorFieldValue(required, '')).toThrow(/required/);
    const number = { key: 'rating', label: 'Rating', kind: 'number' as const };
    expect(() => parseEditorFieldValue(number, 'abc')).toThrow(/number/);
  });

  it('preserves explicit false for checkbox edits', () => {
    const field = { key: 'archived', label: 'Archived', kind: 'checkbox' as const };
    expect(parseEditorFieldValue(field, false)).toEqual({ action: 'set', value: false });
  });
});
