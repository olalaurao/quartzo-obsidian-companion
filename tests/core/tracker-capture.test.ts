import { describe, expect, it } from 'vitest';
import {
  assertTrackerCaptureSupported,
  initialTrackerFieldValue,
  normalizeRecordedTrackerValues,
  projectTrackerForCapture,
} from '../../src/core/tracker-capture';
import type { TrackerDefinition } from '../../src/core/objects/types';

const tracker: TrackerDefinition = {
  id: 'energy',
  type: 'tracker_definition',
  title: 'Energy',
  sections: [
    {
      title: 'Daily',
      input_fields: [
        { id: 'score', title: 'Score', type: 'range', min: 1, max: 5 },
        { id: 'water', title: 'Water', type: 'quantity', default_value: 2 },
        { id: 'done', title: 'Done', type: 'checkbox' },
        { id: 'note', title: 'Note', type: 'text' },
        { id: 'mood', title: 'Mood', type: 'mood' },
        { id: 'tags', title: 'Tags', type: 'checklist', options: ['a', 'b'] },
      ],
    },
  ],
};

describe('tracker capture projection', () => {
  it('matches Flutter defaults for checkbox, range and quantity', () => {
    const projected = projectTrackerForCapture(tracker);
    const [score, water, done] = projected.sections[0].fields;
    expect(initialTrackerFieldValue(score)).toBe(1);
    expect(initialTrackerFieldValue(water)).toBe(2);
    expect(initialTrackerFieldValue(done)).toBe(false);
  });

  it('normalizes recorded values using the canonical CreateRecordForm semantics', () => {
    const projected = projectTrackerForCapture(tracker);
    expect(normalizeRecordedTrackerValues(projected, {
      score: '4',
      water: 3,
      done: false,
      note: ' focused ',
      mood: 3,
      tags: ['a', ' ', 'b'],
    })).toEqual({
      score: 4,
      water: 3,
      done: false,
      note: 'focused',
      mood: 3,
      tags: ['a', 'b'],
    });
  });

  it('fails closed for media and collection-backed options instead of rendering partial fields', () => {
    const media = projectTrackerForCapture({
      ...tracker,
      sections: [{ title: 'Media', input_fields: [{ id: 'photo', title: 'Photo', type: 'media' }] }],
    });
    expect(() => assertTrackerCaptureSupported(media)).toThrow('uses media');

    const collection = projectTrackerForCapture({
      ...tracker,
      sections: [{
        title: 'Collection',
        input_fields: [{
          id: 'choice',
          title: 'Choice',
          type: 'selection',
          options_source_collection_slug: 'people',
        }],
      }],
    });
    expect(() => assertTrackerCaptureSupported(collection)).toThrow('collection-backed options');
  });
});
