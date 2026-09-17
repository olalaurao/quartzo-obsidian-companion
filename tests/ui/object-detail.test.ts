import { describe, expect, it } from 'vitest';
import { buildObjectDetailModel } from '../../src/ui/detail/object-detail';
import type { IndexedObject } from '../../src/vault/index/types';

function fixture(frontmatter: Record<string, unknown>, body = 'Body'): IndexedObject {
  return {
    id: String(frontmatter.id ?? 'object-1'),
    type: String(frontmatter.type ?? 'note'),
    path: 'notes/object-1.md',
    frontmatter,
    body,
  };
}

describe('Universal Object Detail model', () => {
  it('keeps unknown properties visible without treating them as editable schema', () => {
    const model = buildObjectDetailModel(fixture({
      id: 'object-1',
      type: 'note',
      title: 'Detail fixture',
      future_field: { nested: true },
    }));

    expect(model.title).toBe('Detail fixture');
    expect(model.properties).toContainEqual({
      key: 'future_field',
      label: 'Future Field',
      value: '{\n  "nested": true\n}',
    });
  });

  it('separates relationships, schedule and reminders from generic properties', () => {
    const model = buildObjectDetailModel(fixture({
      id: 'resource-1',
      type: 'resource',
      title: 'Book',
      links: ['[[resource/other]]'],
      categories: ['reading'],
      scheduler: { start_date: '2026-09-18' },
      reminders: [{ id: 'rem-1', minutes_before: 15 }],
      priority: 'high',
    }, 'Synopsis'));

    expect(model.relationships.map(property => property.key)).toEqual(['categories', 'links']);
    expect(model.schedule).toContain('start_date');
    expect(model.reminders).toContain('minutes_before');
    expect(model.properties).toContainEqual({ key: 'priority', label: 'Priority', value: 'high' });
    expect(model.body).toBe('Synopsis');
  });
});
