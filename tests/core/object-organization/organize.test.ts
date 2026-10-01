import { describe, expect, it } from 'vitest';
import { planOrganize } from '../../../src/core/object-organization/organize';
import { projectOrganizationIssues } from '../../../src/core/object-organization/issues-projection';
import type { ResolvedOrganizationScope } from '../../../src/core/object-organization/scope-resolver';
import { parseObjectWithSharedSettings, type QuartzoSharedSettings } from '../../../src/core/shared-settings';
import type { VaultIndex } from '../../../src/vault/index/types';

function settings(): QuartzoSharedSettings {
  return {
    schemaVersion: 1,
    objectIdentification: { revision: 7, transition: null },
    typeSignatures: {
      resource: {
        objectType: 'resource',
        markerType: 'property',
        markerValue: 'type: resource',
      },
    },
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

function scope(path: string): ResolvedOrganizationScope {
  return {
    files: [path],
    folders: [],
    includeSubfolders: false,
    eligibleMarkdownPaths: [path],
    indexedObjectIds: [],
    unidentifiedMarkdownPaths: [path],
    ignoredAttachments: [],
    ignoredBases: [],
    duplicatesRemoved: 0,
  };
}

describe('planOrganize issue resolution', () => {
  it('uses exact source bytes, assigns a canonical ID, and removes the unidentified Issue after reprojection', () => {
    const source = [
      '---',
      'title: Keep this title',
      'custom_field: keep-me',
      '---',
      '',
      'Body stays exactly meaningful.',
      '',
    ].join('\n');
    const sharedSettings = settings();

    const plan = planOrganize({
      scope: scope('inbox/example.md'),
      targetType: 'resource',
      settingsRevision: 7,
      settings: sharedSettings,
      objectIdsByPath: new Map([['inbox/example.md', '01KCANONICALTESTOBJECT000000']]),
      vaultState: {
        paths: new Set(['inbox/example.md']),
        readMarkdown: path => path === 'inbox/example.md' ? source : undefined,
      },
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].expectedMarkdown).toBe(source);
    expect(plan.actions[0].newMarkdown).toContain('id: 01KCANONICALTESTOBJECT000000');
    expect(plan.actions[0].newMarkdown).toContain('type: resource');
    expect(plan.actions[0].newMarkdown).toContain('custom_field: keep-me');
    expect(plan.actions[0].newMarkdown).toContain('Body stays exactly meaningful.');

    const parsed = parseObjectWithSharedSettings(
      plan.actions[0].newMarkdown,
      'inbox/example.md',
      sharedSettings,
    );
    const index: VaultIndex = {
      files: new Map(),
      objects: new Map([[
        parsed.object.id,
        {
          id: parsed.object.id,
          type: parsed.object.type,
          path: 'inbox/example.md',
          frontmatter: parsed.object as Record<string, unknown>,
          body: parsed.object.body || '',
          identification: parsed.identification,
        },
      ]]),
      lastModified: Date.now(),
    };
    const projected = projectOrganizationIssues({
      index,
      settings: sharedSettings,
      allMarkdownPaths: new Set(['inbox/example.md']),
      ignoredFolderPaths: [],
    });

    expect(projected.filter(issue => issue.subjectPath === 'inbox/example.md')).toEqual([]);
  });

  it('fails closed instead of writing an empty ID when no canonical identity is available', () => {
    const source = '# ordinary markdown\n';
    const plan = planOrganize({
      scope: scope('inbox/no-id.md'),
      targetType: 'resource',
      settingsRevision: 7,
      settings: settings(),
      vaultState: {
        paths: new Set(['inbox/no-id.md']),
        readMarkdown: () => source,
      },
    });

    expect(plan.actions).toHaveLength(0);
    expect(plan.blockers.some(blocker => blocker.message.includes('canonical object ID'))).toBe(true);
  });
});
