import { describe, expect, it } from 'vitest';
import { planOrganize } from '../../../src/core/object-organization/organize';
import type { QuartzoSharedSettings } from '../../../src/core/shared-settings';

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

describe('planOrganize issue resolution', () => {
  it('uses the exact source bytes and assigns the caller-provided canonical ID to unidentified Markdown', () => {
    const source = [
      '---',
      'title: Keep this title',
      'custom_field: keep-me',
      '---',
      '',
      'Body stays exactly meaningful.',
      '',
    ].join('\n');

    const plan = planOrganize({
      scope: {
        requestedFiles: ['inbox/example.md'],
        requestedFolders: [],
        includeSubfolders: false,
        eligibleMarkdownPaths: ['inbox/example.md'],
        objectIds: [],
        unidentifiedMarkdownPaths: ['inbox/example.md'],
        excludedPaths: [],
      },
      targetType: 'resource',
      settingsRevision: 7,
      settings: settings(),
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
  });

  it('fails closed instead of writing an empty ID when no canonical identity is available', () => {
    const source = '# ordinary markdown\n';
    const plan = planOrganize({
      scope: {
        requestedFiles: ['inbox/no-id.md'],
        requestedFolders: [],
        includeSubfolders: false,
        eligibleMarkdownPaths: ['inbox/no-id.md'],
        objectIds: [],
        unidentifiedMarkdownPaths: ['inbox/no-id.md'],
        excludedPaths: [],
      },
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
