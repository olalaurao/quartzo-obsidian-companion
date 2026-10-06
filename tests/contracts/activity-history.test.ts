import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  availableActivityFilters,
  projectActivityHistory,
  shiftActivityPeriodAnchor,
  type ActivityEvent,
} from '../../src/core/activity-history';

interface Vector {
  id: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

function readVectors(): Vector[] {
  return JSON.parse(
    fs.readFileSync(path.resolve('contracts/quartzo/activity_history/vectors.json'), 'utf8'),
  ) as Vector[];
}

function baseEvent(overrides: Partial<ActivityEvent>): ActivityEvent {
  return {
    eventId: overrides.eventId ?? 'event',
    occurredAt: overrides.occurredAt ?? '2026-10-06T12:00:00Z',
    eventType: overrides.eventType ?? 'object_edited',
    sourceId: overrides.sourceId ?? 'source',
    sourceType: overrides.sourceType ?? 'note',
    sourcePath: overrides.sourcePath,
    originClient: overrides.originClient ?? 'obsidian_companion',
    originKind: overrides.originKind ?? 'companion',
    titleSnapshot: overrides.titleSnapshot ?? 'Title',
    summary: overrides.summary,
    excerpt: overrides.excerpt,
    previousPath: overrides.previousPath,
    changedFieldCount: overrides.changedFieldCount,
    operationId: overrides.operationId,
    occurrenceId: overrides.occurrenceId,
    scheduledFor: overrides.scheduledFor,
    folder: overrides.folder,
    provenance: overrides.provenance,
    metadata: overrides.metadata,
  };
}

function vector(id: string): Vector {
  const found = readVectors().find(item => item.id === id);
  if (!found) throw new Error(`Missing vector ${id}`);
  return found;
}

describe('Activity History contract', () => {
  it('is registered in the vendored contract manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve('contracts/quartzo/contract_manifest.json'), 'utf8'),
    ) as Record<string, string>;
    expect(manifest.activityHistoryContractVersion).toBe('1.0.0');
    expect(fs.existsSync(path.resolve('contracts/quartzo/activity_history/contract.json'))).toBe(true);
    expect(readVectors().map(item => item.id)).toContain('canvas_hidden_without_contract');
  });

  it('keeps Activity in primary shell navigation contract', () => {
    const uiSpec = fs.readFileSync(
      path.resolve('contracts/quartzo/QUARTZO_COMPANION_UI_SPEC_V1.md'),
      'utf8',
    );
    expect(uiSpec).toContain('Home\nPlanner\nJournal\nBrowse\nActivity');
    expect(uiSpec).toContain('Activity never invents data to match a mockup');
  });

  it('recalculates notes filter groups, totals and type counts from one projection', () => {
    const current = vector('notes_filter_recalculates_groups_and_total');
    const events = (current.input.events as Array<Record<string, unknown>>).map(raw => baseEvent(raw as Partial<ActivityEvent>));

    const projection = projectActivityHistory(events, {
      period: 'week',
      rangeStart: '2026-10-05',
      rangeEnd: '2026-10-11',
      categoryFilter: 'notes',
      folderFilter: null,
      privacyMode: false,
    });

    expect(projection.visibleEvents.map(event => event.eventId)).toEqual(current.expected.visibleEventIds);
    expect(projection.total).toBe(current.expected.total);
    expect(projection.groups.reduce((sum, group) => sum + group.count, 0)).toBe(projection.total);
    expect(projection.byType.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(projection.total);
  });

  it('recalculates folder filters across visible events, folders and heatmap buckets', () => {
    const current = vector('folder_filter_recalculates_all_aggregates');
    const events = (current.input.events as Array<Record<string, unknown>>).map(raw => baseEvent(raw as Partial<ActivityEvent>));

    const projection = projectActivityHistory(events, {
      period: 'month',
      rangeStart: '2026-10-01',
      rangeEnd: '2026-10-31',
      categoryFilter: 'all',
      folderFilter: 'Projects',
      privacyMode: false,
    });

    expect(projection.visibleEvents.map(event => event.eventId)).toEqual(current.expected.visibleEventIds);
    expect(projection.total).toBe(current.expected.total);
    expect(projection.folderBuckets).toEqual([{ id: 'Projects', label: 'Projects', count: 2 }]);
    expect(projection.heatmapBuckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
  });

  it('suppresses excerpts in privacy mode without hiding the event', () => {
    const current = vector('privacy_mode_suppresses_excerpt');
    const event = baseEvent(current.input.event as Partial<ActivityEvent>);
    const projection = projectActivityHistory([event], {
      period: 'day',
      rangeStart: '2026-10-06',
      rangeEnd: '2026-10-06',
      categoryFilter: 'all',
      folderFilter: null,
      privacyMode: true,
    });

    expect(projection.visibleEvents).toHaveLength(1);
    expect(projection.visibleEvents[0]?.renderExcerpt).toBeNull();
  });

  it('does not invent provider labels for unknown external captures', () => {
    const current = vector('unknown_provider_label_is_not_invented');
    const event = baseEvent(current.input.event as Partial<ActivityEvent>);
    const projection = projectActivityHistory([event], {
      period: 'day',
      rangeStart: '2026-10-06',
      rangeEnd: '2026-10-06',
      categoryFilter: 'all',
      folderFilter: null,
      privacyMode: false,
    });

    expect(projection.visibleEvents[0]?.providerLabel).toBe(current.expected.providerLabel);
    expect(projection.visibleEvents[0]?.renderedEyebrow).toBe(current.expected.renderedEyebrow);
  });

  it('hides Canvas filters unless the capability exists', () => {
    const current = vector('canvas_hidden_without_contract');
    expect(availableActivityFilters({ canvasActivity: false })).not.toContain(current.input.requestedFilter);
    expect(current.expected.fakeEventsAllowed).toBe(false);
  });

  it('uses real twelve-month year aggregation instead of a short fake heatmap', () => {
    const current = vector('year_uses_real_year_aggregation');
    const projection = projectActivityHistory([], {
      period: 'year',
      rangeStart: current.input.rangeStart as string,
      rangeEnd: current.input.rangeEnd as string,
      categoryFilter: 'all',
      folderFilter: null,
      privacyMode: false,
    });

    expect(projection.heatmapBuckets).toHaveLength(current.expected.minimumMonthlyBuckets as number);
  });

  it('navigates dates by the selected period', () => {
    expect(shiftActivityPeriodAnchor('2026-10-06', 'day', 1)).toBe('2026-10-07');
    expect(shiftActivityPeriodAnchor('2026-10-06', 'week', -1)).toBe('2026-09-29');
    expect(shiftActivityPeriodAnchor('2026-10-31', 'month', 1)).toBe('2026-11-30');
    expect(shiftActivityPeriodAnchor('2026-10-06', 'year', 1)).toBe('2027-10-06');
  });
});

