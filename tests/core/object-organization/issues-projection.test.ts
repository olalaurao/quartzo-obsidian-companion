import { describe, it, expect } from 'vitest';
import {
  projectOrganizationIssues,
  isPathInsideIssueIgnoredFolder,
  isSystemIssuePath,
  normalizeIssueFolderPath,
  normalizeIssueIgnoredFolders,
} from '../../../src/core/object-organization/issues-projection';
import type { QuartzoSharedSettings } from '../../../src/core/shared-settings';
import type { VaultIndex } from '../../../src/vault/index/types';

function emptyIndex(): VaultIndex {
  return { objects: new Map(), files: new Map(), lastModified: Date.now() };
}

function addObject(index: VaultIndex, input: {
  id: string;
  path: string;
  links?: string[];
  matchedTypes?: string[];
}): void {
  index.objects.set(input.id, {
    id: input.id,
    type: input.matchedTypes?.[0] ?? 'note',
    path: input.path,
    frontmatter: {
      id: input.id,
      type: input.matchedTypes?.[0] ?? 'note',
      ...(input.links ? { links: input.links } : {}),
    },
    body: '',
    identification: {
      resolvedType: input.matchedTypes?.[0] ?? 'note',
      matchedSignatures: (input.matchedTypes ?? []).map((objectType, index) => ({
        objectType,
        markerType: 'tag' as const,
        markerValue: `#type-${index}`,
        source: `Tag #type-${index}`,
      })),
      hasConflict: (input.matchedTypes?.length ?? 0) > 1,
    },
  });
}

function settingsWithTransition(): QuartzoSharedSettings {
  const signature = { objectType: 'resource', markerType: 'tag' as const, markerValue: '#resource' };
  return {
    schemaVersion: 1,
    objectIdentification: {
      revision: 1,
      transition: {
        operationId: 'migration-1',
        objectType: 'resource',
        baseRevision: 1,
        targetRevision: 2,
        oldSignature: signature,
        newSignature: { ...signature, markerValue: '#resources' },
        phase: 'applying',
      },
    },
    typeSignatures: { resource: signature },
    typeAliases: {},
    typePriority: ['resource'],
    folderPaths: {},
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

describe('issues-projection path-ignore logic', () => {
  it('normalizes and deduplicates folder paths case-insensitively', () => {
    expect(normalizeIssueFolderPath(' ')).toBe('');
    expect(normalizeIssueFolderPath('_trash')).toBe('_trash');
    expect(normalizeIssueFolderPath('/_trash/')).toBe('_trash');
    expect(normalizeIssueFolderPath('\\_trash\\')).toBe('_trash');
    expect(normalizeIssueFolderPath(' SOME/folder ')).toBe('some/folder');
    expect(normalizeIssueIgnoredFolders([' _TRASH/ ', '_trash', '', 'Projects/Archive'])).toEqual([
      '_trash',
      'projects/archive',
    ]);
  });

  it('matches only the configured folder segment and its descendants', () => {
    const folders = ['_trash', 'hidden/stuff'];

    expect(isPathInsideIssueIgnoredFolder('foo.md', folders)).toBe(false);
    expect(isPathInsideIssueIgnoredFolder('_trash/foo.md', folders)).toBe(true);
    expect(isPathInsideIssueIgnoredFolder('_TRASH/sub/foo.md', folders)).toBe(true);
    expect(isPathInsideIssueIgnoredFolder('hidden/stuff/foo.md', folders)).toBe(true);
    expect(isPathInsideIssueIgnoredFolder('hidden/stuff2/foo.md', folders)).toBe(false);
    expect(isPathInsideIssueIgnoredFolder('_trash_other/foo.md', folders)).toBe(false);
  });

  it('always treats app/** as system scope, case-insensitively', () => {
    expect(isSystemIssuePath('app/quartzo_shared_settings.md')).toBe(true);
    expect(isSystemIssuePath('APP/diagnostics.md')).toBe(true);
    expect(isSystemIssuePath('application/note.md')).toBe(false);
  });

  it('ignores unidentified Markdown under user ignored folders and app/**', () => {
    const issues = projectOrganizationIssues({
      index: emptyIndex(),
      settings: null,
      allMarkdownPaths: new Set([
        'unidentified.md',
        '_diagnostics/log.md',
        '_trash/deleted.md',
        'APP/system.md',
        '_trash-old/keep.md',
      ]),
      ignoredFolderPaths: ['_diagnostics', '_trash'],
    });

    expect(issues.map(issue => issue.subjectPath).sort()).toEqual([
      '_trash-old/keep.md',
      'unidentified.md',
    ]);
  });

  it('allows an explicitly empty user ignored-folder list', () => {
    const issues = projectOrganizationIssues({
      index: emptyIndex(),
      settings: null,
      allMarkdownPaths: new Set(['_trash/deleted.md', '_diagnostics/log.md']),
      ignoredFolderPaths: [],
    });

    expect(issues.map(issue => issue.subjectPath).sort()).toEqual([
      '_diagnostics/log.md',
      '_trash/deleted.md',
    ]);
  });

  it('does not create ambiguous or broken-link issues for ignored/system subjects', () => {
    const index = emptyIndex();
    addObject(index, { id: 'trash', path: '_trash/ambiguous.md', matchedTypes: ['resource', 'note'], links: ['[[missing]]'] });
    addObject(index, { id: 'app', path: 'app/ambiguous.md', matchedTypes: ['resource', 'note'], links: ['[[missing]]'] });
    addObject(index, { id: 'active', path: 'notes/active.md', matchedTypes: ['resource', 'note'], links: ['[[missing]]'] });

    const issues = projectOrganizationIssues({
      index,
      settings: null,
      allMarkdownPaths: new Set(index.objects.values().map(object => object.path)),
      ignoredFolderPaths: ['_trash'],
    });

    expect(issues.some(issue => issue.subjectPath === '_trash/ambiguous.md')).toBe(false);
    expect(issues.some(issue => issue.subjectPath === 'app/ambiguous.md')).toBe(false);
    expect(issues.filter(issue => issue.subjectPath === 'notes/active.md').map(issue => issue.category).sort()).toEqual([
      'ambiguous',
      'broken_relationship',
    ]);
  });

  it('does not report a duplicate ID when the only second copy is ignored or system-owned', () => {
    const index = emptyIndex();
    addObject(index, { id: 'same', path: 'notes/live.md' });
    index.objects.set('trash-map-key', {
      ...index.objects.get('same')!,
      path: '_trash/old.md',
    });
    index.objects.set('app-map-key', {
      ...index.objects.get('same')!,
      path: 'app/system-copy.md',
    });

    const issues = projectOrganizationIssues({
      index,
      settings: null,
      allMarkdownPaths: new Set(['notes/live.md', '_trash/old.md', 'app/system-copy.md']),
      ignoredFolderPaths: ['_trash'],
    });

    expect(issues.some(issue => issue.category === 'duplicate')).toBe(false);
  });

  it('still reports duplicate IDs when two eligible active objects share an ID', () => {
    const index = emptyIndex();
    addObject(index, { id: 'same', path: 'notes/one.md' });
    index.objects.set('second-map-key', {
      ...index.objects.get('same')!,
      path: 'notes/two.md',
    });

    const issues = projectOrganizationIssues({
      index,
      settings: null,
      allMarkdownPaths: new Set(['notes/one.md', 'notes/two.md']),
      ignoredFolderPaths: ['_trash'],
    });

    const duplicate = issues.find(issue => issue.category === 'duplicate');
    expect(duplicate?.subjectId).toBe('same');
    expect(duplicate?.why).toContain('2 files');
  });

  it('keeps interrupted migration as a system issue under app/**', () => {
    const issues = projectOrganizationIssues({
      index: emptyIndex(),
      settings: settingsWithTransition(),
      allMarkdownPaths: new Set(['app/quartzo_shared_settings.md']),
      ignoredFolderPaths: ['_trash', '_diagnostics'],
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        category: 'interrupted',
        subjectPath: 'app/quartzo_shared_settings.md',
        actionable: false,
      }),
    ]));
  });
});
