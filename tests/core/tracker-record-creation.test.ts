import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/core/object-creation';
import { ObjectParser } from '../../src/core/objects';
import type { QuartzoSharedSettings } from '../../src/core/shared-settings';

const settings: QuartzoSharedSettings = {
  schemaVersion: 1,
  typeSignatures: {},
  folderPaths: { tracker_record: 'tracking-records' },
  categoryColors: {},
  accentColor: '#F97316',
  plannerColorMode: 'category',
  plannerVisibleKinds: [],
  plannerShowAdaptiveTimeBlocks: true,
  startOfWeek: 1,
  dayStartHour: 0,
  showDayDialLegend: true,
};

describe('TrackingRecord Quick Add creation', () => {
  it('writes tracker_id, date, field_values and tracker_records category in the configured folder', () => {
    const created = buildQuickAddDocument(
      settings,
      'tracker_record',
      {
        title: '',
        body: '',
        record: {
          trackerId: 'energy',
          trackerTitle: 'Energy',
          date: '2026-09-17T00:00:00.000',
          fieldValues: { score: 4, note: 'focused', done: false },
        },
      },
      'record-1',
    );

    expect(created.path).toBe('tracking-records/record-1.md');
    expect(ObjectParser.parse(created.content).object).toMatchObject({
      id: 'record-1',
      type: 'tracker_record',
      title: 'Energy 2026-09-17T00:00:00.000',
      tracker_id: 'energy',
      date: '2026-09-17T00:00:00.000',
      field_values: { score: 4, note: 'focused', done: false },
      categories: ['[[tracker_records]]'],
    });
  });

  it('fails closed when Object Identification has no Record folder', () => {
    expect(() => buildQuickAddDocument(
      { ...settings, folderPaths: {} },
      'tracker_record',
      {
        title: '',
        body: '',
        record: {
          trackerId: 'energy',
          trackerTitle: 'Energy',
          date: '2026-09-17T00:00:00.000',
          fieldValues: {},
        },
      },
      'record-2',
    )).toThrow('No canonical creation folder is configured for tracker_record');
  });
});
