import { describe, expect, it } from 'vitest';
import { buildQuickAddDocument } from '../../src/core/object-creation';
import { parseSharedSettings } from '../../src/core/shared-settings';
import { ObjectParser } from '../../src/core/objects';
import fs from 'fs';
import path from 'path';

describe('Companion V1 shell contract', () => {
  const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_signatures:
  task:
    objectType: task
    markerType: property
    markerValue: "kind: task"
  entry:
    objectType: entry
    markerType: tag
    markerValue: "#journal"
  note:
    objectType: note
    markerType: folder
    markerValue: notes/custom
  reminder:
    objectType: reminder
    markerType: property
    markerValue: "kind: reminder"
folder_paths:
  task: tasks/custom
  entry: journal/custom
  reminder: reminders/custom
---
`)!;

  it.each([
    ['task', { title: 'Prepare campaign', body: 'Draft' }],
    ['entry', { title: 'Reflection', body: 'Text', date: '2026-09-16', time: '20:00' }],
    ['note', { title: 'Idea', body: 'Text' }],
    ['reminder', { title: 'Call', body: '', date: '2026-09-17', time: '09:45' }],
  ] as const)('creates %s through canonical settings and roundtrips', (type, input) => {
    const built = buildQuickAddDocument(settings, type, input, `${type}-fixture`);
    const parsed = ObjectParser.parse(built.content);
    expect(parsed.object.type).toBe(type);
    expect(parsed.object.id).toBe(`${type}-fixture`);
  });

  it('uses configured/folder-signature paths rather than hardcoded plural folders', () => {
    expect(buildQuickAddDocument(settings, 'task', { title: 'T', body: '' }, 't1').path).toBe('tasks/custom/t1.md');
    expect(buildQuickAddDocument(settings, 'note', { title: 'N', body: '' }, 'n1').path).toBe('notes/custom/n1.md');
  });

  it('registers one primary workspace view and no legacy top-level clones', () => {
    const main = fs.readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');
    expect((main.match(/registerView\(/g) ?? []).length).toBe(1);
    expect(main).toContain('QUARTZO_VIEW_TYPE');
    expect(main).not.toContain("registerView(HOME_VIEW_TYPE");
    expect(main).not.toContain("registerView(QUICK_ADD_VIEW_TYPE");
  });
});
