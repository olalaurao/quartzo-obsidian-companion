import { describe, expect, it } from 'vitest';
import { applyTypeConflictMarkerRemoval } from '../../src/core/object-mutation/type-conflict';
import { parseObjectWithSharedSettings, parseSharedSettings } from '../../src/core/shared-settings';
import { ObjectParser } from '../../src/core/objects';

const settings = parseSharedSettings(`---
type: quartzo_shared_settings
schema_version: 1
type_priority: [project, habit, task]
type_signatures:
  project:
    objectType: project
    markerType: property
    markerValue: "type: project"
  habit:
    objectType: habit
    markerType: tag
    markerValue: "#habit"
  task:
    objectType: task
    markerType: property
    markerValue: "kind: task"
---
`)!;

describe('type conflict marker resolution', () => {
  it('removes a losing tag marker while preserving unknown frontmatter', () => {
    const markdown = `---
id: project-1
type: project
title: Project Alpha
tags:
  - habit
future_field_from_2030:
  nested: something
---
Body #habit`;
    const parsed = parseObjectWithSharedSettings(markdown, 'projects/alpha.md', settings);
    expect(parsed.object.type).toBe('project');
    expect(parsed.identification?.hasConflict).toBe(true);
    const losingTag = parsed.identification!.matchedSignatures.find(match => match.objectType === 'habit')!;

    const next = applyTypeConflictMarkerRemoval(markdown, {
      objectId: 'project-1',
      resolvedType: 'project',
      filePath: 'projects/alpha.md',
      match: losingTag,
    }, settings);

    const reparsed = parseObjectWithSharedSettings(next, 'projects/alpha.md', settings);
    expect(reparsed.object.type).toBe('project');
    expect(reparsed.identification?.hasConflict).toBe(false);
    const frontmatter = ObjectParser.parseMarkdown(next).frontmatter;
    expect(frontmatter.future_field_from_2030).toEqual({ nested: 'something' });
    expect(frontmatter.tags).toBeUndefined();
    expect(ObjectParser.parseMarkdown(next).body).toBe('Body');
  });

  it('removes a losing property marker without changing the winner', () => {
    const markdown = `---
id: project-2
type: project
kind: task
title: Project Beta
---
Body`;
    const parsed = parseObjectWithSharedSettings(markdown, 'projects/beta.md', settings);
    expect(parsed.identification?.hasConflict).toBe(true);
    const losingProperty = parsed.identification!.matchedSignatures.find(match => match.objectType === 'task')!;

    const next = applyTypeConflictMarkerRemoval(markdown, {
      objectId: 'project-2',
      resolvedType: 'project',
      filePath: 'projects/beta.md',
      match: losingProperty,
    }, settings);

    const frontmatter = ObjectParser.parseMarkdown(next).frontmatter;
    expect(frontmatter.kind).toBeUndefined();
    expect(parseObjectWithSharedSettings(next, 'projects/beta.md', settings).object.type).toBe('project');
  });
});
