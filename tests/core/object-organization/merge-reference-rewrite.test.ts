import { describe, expect, it } from 'vitest';
import { planMerge, suggestMergeAliases } from '../../../src/core/object-organization/merge';
import {
  mergeReferenceKeys,
  rewriteMergeWikiLinks,
} from '../../../src/core/object-organization/reference-rewrite';
import type { QuartzoSharedSettings } from '../../../src/core/shared-settings';

function settings(): QuartzoSharedSettings {
  return {
    schemaVersion: 1,
    objectIdentification: { revision: 7, transition: null },
    typeSignatures: {
      note: { objectType: 'note', markerType: 'property', markerValue: 'type: note' },
    },
    typeAliases: {},
    typePriority: ['note'],
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

describe('merge reference repair', () => {
  it('rewrites exact path, title, alias and typed WikiLinks while preserving anchors and labels', () => {
    const loser = {
      id: 'old-id',
      path: 'Notes/old-note.md',
      markdown: [
        '---',
        'id: old-id',
        'type: note',
        'title: Old note',
        'slug: old-note',
        'aliases:',
        '  - Former name',
        '---',
      ].join('\n'),
    };
    const keys = mergeReferenceKeys(loser);
    const source = [
      '---',
      'related: [[old-id#^block|Old ID]]',
      '---',
      '[[Notes/old-note#section|Old note]] [[note/old-note]] [[other-note]]',
    ].join('\n');

    expect(rewriteMergeWikiLinks(source, keys, 'Notes/survivor.md')).toBe([
      '---',
      'related: [[Notes/survivor#^block|Old ID]]',
      '---',
      '[[Notes/survivor#section|Old note]] [[Notes/survivor]] [[other-note]]',
    ].join('\n'));
  });

  it('suggests former titles, filenames and aliases, dedupes them and omits the final title', () => {
    const aliases = suggestMergeAliases([
      {
        path: 'Notes/Current.md',
        markdown: '---\ntitle: Final\naliases:\n  - Existing\n---\n',
      },
      {
        path: 'Notes/Old.md',
        markdown: '---\ntitle: Old title\naliases:\n  - Existing\n  - Legacy\n---\n',
      },
    ], 'Final');

    expect(aliases).toEqual(['Current', 'Existing', 'Old title', 'Old', 'Legacy']);
  });

  it('adds only selected aliases to the survivor and keeps existing aliases', () => {
    const plan = planMerge({
      survivorId: 'survivor',
      survivorPath: 'Notes/survivor.md',
      survivorMarkdown: '---\nid: survivor\ntype: note\ntitle: Final\naliases: [Keep]\n---\nbody',
      targetType: 'note',
      losers: [{
        id: 'loser',
        path: 'Notes/loser.md',
        markdown: '---\nid: loser\ntype: note\ntitle: Old title\n---\nold body',
      }],
      propertyResolutions: [],
      aliasesToAdd: ['Old title', 'Custom', 'Keep'],
      bodyResolution: 'keep_survivor',
      settingsRevision: 7,
      settings: settings(),
    });

    expect(plan.action.newSurvivorMarkdown).toContain('aliases:');
    expect(plan.action.newSurvivorMarkdown).toContain('Keep');
    expect(plan.action.newSurvivorMarkdown).toContain('Old title');
    expect(plan.action.newSurvivorMarkdown).toContain('Custom');
    expect(plan.action.newSurvivorMarkdown.match(/Keep/g)).toHaveLength(1);
    expect(plan.action.newSurvivorMarkdown).not.toContain('\n  - Final');
  });

  it('retires an extra physical copy with the same ID to a stable unique tombstone path', () => {
    const plan = planMerge({
      survivorId: 'same-id',
      survivorPath: 'Notes/canonical.md',
      survivorMarkdown: '---\nid: same-id\ntype: note\ntitle: Canonical\n---\nbody',
      targetType: 'note',
      losers: [{
        id: 'same-id',
        path: 'Archive/duplicate.md',
        markdown: '---\nid: same-id\ntype: note\ntitle: Previous\n---\nduplicate body',
      }],
      propertyResolutions: [],
      bodyResolution: 'combine',
      settingsRevision: 7,
      settings: settings(),
    });

    expect(plan.blockers).toEqual([]);
    expect(plan.action.losersToRetire[0]?.tombstonePath).toMatch(
      /^_deleted\/same-id__duplicate-[a-f0-9]+\.md$/,
    );
    expect(plan.action.newSurvivorMarkdown).toContain('duplicate body');
  });
});
