import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { VaultIndexEngine } from '../../src/vault/index/engine';
import {
  applyTypeSignature,
  identifyTypeFromSignatures,
  parseObjectWithSharedSettings,
  parseSharedSettings,
  resolveCreationFolder,
} from '../../src/core/shared-settings';

describe('shared Quartzo settings interoperability', () => {
  const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_priority: [task, note, entry]
type_aliases:
  tracker:
    - tracker_definition
  pomodoro:
    - pomodoro_session
  analysis:
    - combined_analysis
type_signatures:
  task:
    objectType: task
    markerType: property
    markerValue: "kind: task"
  note:
    objectType: note
    markerType: folder
    markerValue: knowledge/notes
  entry:
    objectType: entry
    markerType: tag
    markerValue: "#journal"
  idea:
    objectType: idea
    markerType: tag
    markerValue: ideia
folder_paths:
  task: work/tasks
  entry: journal
accent_color: "#123456"
planner:
  color_mode: type
  visible_kinds: [task, reminder]
calendar:
  start_of_week: 0
---
# Settings
`)!;

  it('parses canonical shared settings and resolves creation paths', () => {
    expect(settings.accentColor).toBe('#123456');
    expect(settings.startOfWeek).toBe(0);
    expect(resolveCreationFolder(settings, 'task')).toBe('work/tasks');
    expect(resolveCreationFolder(settings, 'note')).toBe('knowledge/notes');
    expect(resolveCreationFolder(settings, 'reminder')).toBeNull();
  });

  it('applies property and tag signatures without inventing a folder', () => {
    const task = applyTypeSignature({ id: 't1', type: 'task' }, 'Body', settings.typeSignatures.task);
    expect(task.frontmatter.kind).toBe('task');
    const entry = applyTypeSignature({ id: 'e1', type: 'entry' }, 'Text', settings.typeSignatures.entry);
    expect(entry.body).toContain('#journal');
  });

  it('identifies an object by exactly one canonical signature when type is absent', () => {
    expect(identifyTypeFromSignatures(settings, 'knowledge/notes/a.md', { id: 'n1' }, 'Body')).toBe('note');
    const parsed = parseObjectWithSharedSettings(`---\nid: n1\ntitle: Hello\n---\nBody`, 'knowledge/notes/a.md', settings);
    expect(parsed.object.type).toBe('note');
    expect(parsed.object.id).toBe('n1');
  });

  it('resolves conflicting signatures by priority while preserving conflict details', () => {
    const ambiguous = {
      ...settings,
      typePriority: ['note', 'task'],
      typeSignatures: {
        a: { objectType: 'task', markerType: 'folder' as const, markerValue: 'same' },
        b: { objectType: 'note', markerType: 'folder' as const, markerValue: 'same' },
      },
    };
    expect(identifyTypeFromSignatures(ambiguous, 'same/file.md', { id: 'x' }, '')).toBe('note');
    const parsed = parseObjectWithSharedSettings('---\nid: x\ntitle: X\n---\n', 'same/file.md', ambiguous);
    expect(parsed.object.type).toBe('note');
    expect(parsed.identification?.hasConflict).toBe(true);
    expect(parsed.identification?.conflictDetails?.candidates).toEqual(['task', 'note']);
    expect(parsed.identification?.conflictDetails?.reason).toContain('Note');
  });

  it('treats persisted aliases as the same product type instead of a conflict', () => {
    const trackerSettings = {
      ...settings,
      typePriority: ['tracker'],
      typeSignatures: {
        tracker: { objectType: 'tracker', markerType: 'property' as const, markerValue: 'type: tracker_definition' },
      },
    };
    const parsed = parseObjectWithSharedSettings(
      '---\nid: tracker-1\ntype: tracker_definition\ntitle: Energy\n---\n',
      'trackers/energy.md',
      trackerSettings,
    );
    expect(parsed.object.type).toBe('tracker_definition');
    expect(parsed.identification?.resolvedType).toBe('tracker');
    expect(parsed.identification?.hasConflict).toBe(false);
  });

  it('matches tag signatures in body and frontmatter with Quartzo-compatible syntax', () => {
    const taggedInBody = parseObjectWithSharedSettings(
      '---\nid: idea-body\ntitle: Body tag\n---\nA thing #ideia',
      'ideas/body.md',
      settings,
    );
    expect(taggedInBody.object.type).toBe('idea');

    const taggedInFrontmatter = parseObjectWithSharedSettings(
      '---\nid: idea-frontmatter\ntitle: Frontmatter tag\ntags:\n  - ideia\n---\nA thing',
      'ideas/frontmatter.md',
      settings,
    );
    expect(taggedInFrontmatter.object.type).toBe('idea');
  });

  it('consumes the canonical upstream shared-settings fixture byte-for-byte', () => {
    const fixturePath = path.join(process.cwd(), 'contracts', 'quartzo', 'shared_settings', 'v1.md');
    const fixture = fs.readFileSync(fixturePath, 'utf8');
    const canonical = parseSharedSettings(fixture);

    expect(canonical).not.toBeNull();
    expect(canonical!.schemaVersion).toBe(1);
    expect(canonical!.accentColor).toBe('#123456');
    expect(canonical!.plannerColorMode).toBe('type');
    expect(canonical!.plannerVisibleKinds).toEqual(['task', 'reminder', 'journalEntry']);
    expect(canonical!.plannerShowAdaptiveTimeBlocks).toBe(false);
    expect(canonical!.startOfWeek).toBe(0);
    expect(canonical!.dayStartHour).toBe(6);
    expect(canonical!.showDayDialLegend).toBe(false);
    expect(canonical!.folderPaths.note).toBe('knowledge/notes');
    expect(canonical!.categoryColors.home).toBe('#22C55E');
    expect(canonical!.typeAliases.tracker).toContain('tracker_definition');
    expect(canonical!.typePriority.length).toBeGreaterThan(20);
    expect(canonical!.typeSignatures.note).toMatchObject({
      objectType: 'note',
      markerType: 'folder',
      markerValue: 'knowledge/notes',
      iconName: 'description',
      colorHex: '#64748B',
    });
  });

  it('shared-settings reindex makes an untyped signature-matched file queryable', () => {
    const file = {
      path: 'knowledge/notes/tarot.md',
      content: '---\nid: n-tarot\ntitle: Tarot\n---\nBody',
      modified: 1,
      size: 42,
    };

    const withoutSettings = VaultIndexEngine.createInitialIndex(
      [file],
      (content, filePath) => parseObjectWithSharedSettings(content, filePath, null),
    );
    expect(withoutSettings.objects.size).toBe(0);

    const fixturePath = path.join(process.cwd(), 'contracts', 'quartzo', 'shared_settings', 'v1.md');
    const canonical = parseSharedSettings(fs.readFileSync(fixturePath, 'utf8'));
    const withSettings = VaultIndexEngine.createInitialIndex(
      [file],
      (content, filePath) => parseObjectWithSharedSettings(content, filePath, canonical),
    );

    expect(withSettings.objects.size).toBe(1);
    expect(withSettings.objects.get('n-tarot')).toMatchObject({
      id: 'n-tarot',
      type: 'note',
      path: 'knowledge/notes/tarot.md',
    });
  });

  it('covers every vault object type from the vendored object coverage contract', () => {
    const fixturePath = path.join(process.cwd(), 'contracts', 'quartzo', 'shared_settings', 'v1.md');
    const coveragePath = path.join(process.cwd(), 'contracts', 'quartzo', 'object_fixtures', 'coverage.json');
    const canonical = parseSharedSettings(fs.readFileSync(fixturePath, 'utf8'))!;
    const coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8')) as Array<{ type: string }>;
    const coveredTypes = coverage
      .map(row => row.type)
      .filter(type => type !== 'tracker_record');

    for (const type of coveredTypes) {
      expect(canonical.typeSignatures[type] ?? Object.entries(canonical.typeAliases)
        .find(([, aliases]) => aliases.includes(type))).toBeTruthy();
    }
  });

});
