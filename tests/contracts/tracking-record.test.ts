import { describe, expect, it } from 'vitest';
import { ObjectParser } from '../../src/core/objects/parser';

describe('TrackingRecord contract', () => {
  it('parses and roundtrips tracker_id, date and field_values as owned fields', () => {
    const markdown = `---\nid: record-1\ntype: tracker_record\ntitle: Energy 2026-09-17\ntracker_id: energy\ndate: 2026-09-17T10:30:00.000\nfield_values:\n  score: 4\n  note: focused\nfuture_field:\n  keep: true\n---\nRecorded from Quick Add`;

    const parsed = ObjectParser.parse(markdown);
    expect(parsed.object).toMatchObject({
      id: 'record-1',
      type: 'tracker_record',
      tracker_id: 'energy',
      date: '2026-09-17T10:30:00.000',
      field_values: { score: 4, note: 'focused' },
    });
    expect(parsed.unknownFields).toEqual(['future_field']);

    const roundtripped = ObjectParser.parse(ObjectParser.roundtrip(markdown));
    expect(roundtripped.object).toMatchObject({
      tracker_id: 'energy',
      date: '2026-09-17T10:30:00.000',
      field_values: { score: 4, note: 'focused' },
      future_field: { keep: true },
    });
  });
});
