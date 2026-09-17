import { describe, expect, it } from 'vitest';
import { ObjectParser } from '../../src/core/objects/parser';

describe('TrackerDefinition current persisted shape', () => {
  it('preserves canonical title + input_fields sections used by Flutter', () => {
    const markdown = `---\nid: energy\ntype: tracker_definition\ntitle: Energy\nsections:\n  - title: Daily\n    input_fields:\n      - id: score\n        title: Score\n        type: range\n        min: 1\n        max: 5\n      - id: note\n        title: Note\n        type: text\n---\nTracker body`;

    const parsed = ObjectParser.parse(markdown);
    expect(parsed.object).toMatchObject({
      id: 'energy',
      type: 'tracker_definition',
      sections: [{
        title: 'Daily',
        input_fields: [
          { id: 'score', title: 'Score', type: 'range', min: 1, max: 5 },
          { id: 'note', title: 'Note', type: 'text' },
        ],
      }],
      section_count: 1,
      field_count: 2,
    });
  });
});
