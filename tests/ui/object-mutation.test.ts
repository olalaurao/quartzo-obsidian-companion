import { describe, expect, it } from 'vitest';
import {
  applySafeObjectMutation,
  fullMutationObjectTypes,
  hasFullObjectMutationSupport,
} from '../../src/core/object-mutation';
import { ObjectParser } from '../../src/core/objects';

describe('safe object mutation', () => {
  it('derives full mutation support from vendored contract coverage', () => {
    expect(hasFullObjectMutationSupport('task')).toBe(true);
    expect(hasFullObjectMutationSupport('habit')).toBe(true);
    expect(hasFullObjectMutationSupport('tracker_definition')).toBe(true);
    expect(hasFullObjectMutationSupport('tracker_record')).toBe(true);
    expect(hasFullObjectMutationSupport('entry')).toBe(true);
    expect(hasFullObjectMutationSupport('note')).toBe(true);
    expect(hasFullObjectMutationSupport('reminder')).toBe(true);
    expect(hasFullObjectMutationSupport('resource')).toBe(true);
    expect(hasFullObjectMutationSupport('goal')).toBe(false);
    expect(hasFullObjectMutationSupport('daily_note')).toBe(false);
    expect(fullMutationObjectTypes()).toContain('tracker');
  });

  it('changes only requested fields and preserves unknown frontmatter', () => {
    const current = [
      '---',
      'id: task-1',
      'type: task',
      'title: Before',
      'archived: false',
      'future_task_field:',
      '  nested: keep-me',
      '---',
      'Original body',
    ].join('\n');

    const next = applySafeObjectMutation(current, { id: 'task-1', type: 'task' }, {
      set: { title: 'After' },
    });
    const raw = ObjectParser.parseMarkdown(next);
    expect(raw.frontmatter.title).toBe('After');
    expect(raw.frontmatter.archived).toBe(false);
    expect(raw.frontmatter.future_task_field).toEqual({ nested: 'keep-me' });
    expect(raw.body).toBe('Original body');
  });

  it('supports explicit clear without clearing unrelated fields', () => {
    const current = [
      '---',
      'id: note-1',
      'type: note',
      'title: Note',
      'note_subtype: text',
      'links:',
      '  - "[[one]]"',
      'future_note_field: preserve',
      '---',
      'Body',
    ].join('\n');

    const next = applySafeObjectMutation(current, { id: 'note-1', type: 'note' }, {
      unset: ['note_subtype'],
      body: '',
    });
    const raw = ObjectParser.parseMarkdown(next);
    expect(raw.frontmatter.note_subtype).toBeUndefined();
    expect(raw.frontmatter.links).toEqual(['[[one]]']);
    expect(raw.frontmatter.future_note_field).toBe('preserve');
    expect(raw.body).toBe('');
  });

  it('fails closed for unsupported types and identity drift', () => {
    const goal = ['---','id: goal-1','type: goal','title: Goal','---',''].join('\n');
    expect(() => applySafeObjectMutation(goal, { id: 'goal-1', type: 'goal' }, { set: { title: 'X' } }))
      .toThrow(/not supported/);

    const task = ['---','id: task-1','type: task','title: Task','---',''].join('\n');
    expect(() => applySafeObjectMutation(task, { id: 'different', type: 'task' }, { set: { title: 'X' } }))
      .toThrow(/identity changed/);
  });

  it('protects id/type and rejects empty titles', () => {
    const current = ['---','id: task-1','type: task','title: Task','---',''].join('\n');
    expect(() => applySafeObjectMutation(current, { id: 'task-1', type: 'task' }, { set: { id: 'new-id' } }))
      .toThrow(/protected field/);
    expect(() => applySafeObjectMutation(current, { id: 'task-1', type: 'task' }, { set: { title: '   ' } }))
      .toThrow(/cannot be empty/);
  });
});
