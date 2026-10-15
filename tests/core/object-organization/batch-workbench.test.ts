import { describe, expect, it, vi } from 'vitest';
import {
  parseBatchCreateInput,
  batchDraftsFromNames,
  planBatchAnalysis,
  planBatchCreate,
} from '../../../src/core/object-organization/batch-workbench';
import { ObjectParser } from '../../../src/core/objects';
import type { OrganizationIssue } from '../../../src/core/object-organization/issues-projection';
import type { QuartzoSharedSettings } from '../../../src/core/shared-settings';
import type { VaultIndex } from '../../../src/vault/index/types';

function emptyIndex(): VaultIndex {
  return { objects: new Map(), files: new Map(), lastModified: Date.now() };
}

function settings(): QuartzoSharedSettings {
  return {
    schemaVersion: 1,
    objectIdentification: { revision: 0 },
    typeSignatures: {},
    typeAliases: {},
    typePriority: [],
    folderPaths: {
      note: 'notes',
      task: 'tasks',
      entry: 'entries',
      reminder: 'reminders',
      resource: 'resources',
      area: 'organizers/areas',
      project: 'organizers/projects',
    },
    categoryColors: {},
    accentColor: '#F97316',
    plannerColorMode: 'category',
    plannerVisibleKinds: [],
    plannerShowAdaptiveTimeBlocks: true,
    startOfWeek: 1,
    dayStartHour: 0,
    showDayDialLegend: true,
  };
}

function issue(category: OrganizationIssue['category'], path: string): OrganizationIssue {
  return {
    id: `${category}:${path}`,
    category,
    subjectPath: path,
    title: category,
    why: category,
    actionable: true,
  };
}

describe('batch workbench planning', () => {
  it('uses canonical local capture dates when UTC is already the next day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T02:30:00Z'));
    vi.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
    vi.spyOn(Date.prototype, 'getMonth').mockReturnValue(9);
    vi.spyOn(Date.prototype, 'getDate').mockReturnValue(14);
    try {
      const plan = planBatchCreate({ settings: settings(), drafts: [
        { type: 'entry', title: 'Journal' }, { type: 'reminder', title: 'Reminder' },
      ], existingPaths: new Set(), createId: (_, i) => `local-${i}` });
      expect(plan.blockers).toEqual([]);
      expect(ObjectParser.parse(plan.actions[0]!.content).object).toMatchObject({ date: '2026-10-14' });
      expect(ObjectParser.parse(plan.actions[1]!.content).object).toMatchObject({
        date: '2026-10-14', time: '09:00',
        reminders: [{ trigger_time: '2026-10-14T09:00:00.000' }],
      });
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('creates named movies with shared canonical properties and distinct IDs', () => {
    const drafts = batchDraftsFromNames('Arrival\r\n\nInterstellar', {
      type: 'resource', mediaType: 'Movie', tags: ['weekend'], categories: ['Cinema'],
      links: ['[[Watchlist]]'], resource: { status: 'toConsume', priority: 'high', author: 'Director' },
    });
    const plan = planBatchCreate({ settings: settings(), drafts, existingPaths: new Set(), createId: (_, i) => `movie-${i}` });
    expect(plan.blockers).toEqual([]);
    expect(plan.actions.map(action => ObjectParser.parse(action.content).object)).toMatchObject([
      { id: 'movie-0', title: 'Arrival', type: 'resource', media_type: 'Movie', status: 'toConsume', priority: 'high', author: 'Director', categories: ['Cinema'], tags: ['weekend'], links: ['[[Watchlist]]'] },
      { id: 'movie-1', title: 'Interstellar', type: 'resource', media_type: 'Movie', status: 'toConsume' },
    ]);
  });
  it('keeps common properties for notes and blocks duplicate names before writing', () => {
    const drafts = batchDraftsFromNames('Same\nSame', { type: 'note', tags: ['tag'], categories: ['category'], links: ['[[link]]'], body: 'shared body' });
    const plan = planBatchCreate({ settings: settings(), drafts, existingPaths: new Set(), createId: (_, i) => `note-${i}` });
    expect(plan.blockers.join(' ')).toContain('duplicated');
    expect(ObjectParser.parse(plan.actions[0]!.content).object).toMatchObject({ tags: ['tag'], categories: ['category'], links: ['[[link]]'], body: 'shared body' });
  });

  it('summarizes issues and duplicate groups without creating a second index', () => {
    const index = emptyIndex();
    index.objects.set('one', {
      id: 'dup',
      type: 'note',
      path: 'notes/b.md',
      frontmatter: { id: 'dup', type: 'note', title: 'B' },
      body: '',
    });
    index.objects.set('two', {
      id: 'dup',
      type: 'note',
      path: 'notes/a.md',
      frontmatter: { id: 'dup', type: 'note', title: 'A' },
      body: '',
    });

    const plan = planBatchAnalysis({
      index,
      issues: [issue('duplicate', 'notes/a.md'), issue('unidentified', 'loose.md')],
      selectedPaths: [],
      ignoredFolderPaths: [],
    });

    expect(plan.issueCount).toBe(2);
    expect(plan.categories).toEqual([
      { category: 'duplicate', count: 1 },
      { category: 'unidentified', count: 1 },
    ]);
    expect(plan.duplicateGroups).toEqual([{
      objectId: 'dup',
      paths: ['notes/a.md', 'notes/b.md'],
      survivorPath: 'notes/a.md',
    }]);
    expect(plan.availableActions.mergeDuplicates).toBe(true);
  });

  it('parses header-based batch create rows', () => {
    const drafts = parseBatchCreateInput([
      'type | title | folder | body | tags | links',
      'area | Health | organizers/areas | Area body | life;health | [[pillars/health]]',
      'project | Companion | organizers/projects | Project body | work | [[areas/work]]',
    ].join('\n'));

    expect(drafts).toMatchObject([
      {
        type: 'area',
        title: 'Health',
        folder: 'organizers/areas',
        body: 'Area body',
        tags: ['life', 'health'],
        links: ['[[pillars/health]]'],
      },
      {
        type: 'project',
        title: 'Companion',
        folder: 'organizers/projects',
        body: 'Project body',
        tags: ['work'],
        links: ['[[areas/work]]'],
      },
    ]);
  });

  it('plans minimal Area and Project documents with roundtrip-safe Markdown', () => {
    const drafts = parseBatchCreateInput([
      'area | Health | organizers/areas | Area body',
      'project | Companion | organizers/projects | Project body',
    ].join('\n'));
    const plan = planBatchCreate({
      settings: settings(),
      drafts,
      existingPaths: new Set(),
      createId: (_draft, index) => index === 0 ? 'area-health' : 'project-companion',
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.actions.map(action => action.path)).toEqual([
      'organizers/areas/Health.md',
      'organizers/projects/Companion.md',
    ]);
    expect(ObjectParser.parse(plan.actions[0]!.content).object).toMatchObject({
      id: 'area-health',
      type: 'area',
      organizer_type: 'area',
      title: 'Health',
    });
    expect(ObjectParser.parse(plan.actions[1]!.content).object).toMatchObject({
      id: 'project-companion',
      type: 'project',
      organizer_type: 'project',
      title: 'Companion',
      rotation_groups: [],
    });
  });

  it('blocks path collisions before creating anything', () => {
    const plan = planBatchCreate({
      settings: settings(),
      drafts: parseBatchCreateInput('area | Health | organizers/areas | Body'),
      existingPaths: new Set(['organizers/areas/Health.md']),
      createId: () => 'area-health',
    });

    expect(plan.actions).toEqual([]);
    expect(plan.blockers[0]).toContain('target already exists');
  });
});
