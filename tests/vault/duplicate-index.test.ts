import { describe, expect, it } from 'vitest';
import { VaultIndexEngine, type IndexedObject, type VaultFile } from '../../src/vault/index';
import { parseObjectWithSharedSettings } from '../../src/core/shared-settings';
import { projectOrganizationIssues } from '../../src/core/object-organization/issues-projection';
import { queryVaultObjects, reviewVaultIdentityCandidates } from '../../src/core/object-query';

const parse = (content: string, path: string) => parseObjectWithSharedSettings(content, path, null);
function file(path: string, id = 'shared'): VaultFile {
  const content = `---\nid: ${id}\ntype: resource\ntitle: ${path}\n---\nKeep [[tag]]\n`;
  return { path, content, modified: 1, size: content.length };
}
function object(input: VaultFile): IndexedObject {
  const result = parse(input.content, input.path);
  return { id: result.object.id, type: result.object.type, path: input.path,
    frontmatter: result.object, body: result.object.body ?? '', identification: result.identification };
}
function issues(index: ReturnType<typeof VaultIndexEngine.createInitialIndex>, ignoredFolderPaths: string[] = []) {
  return projectOrganizationIssues({ index, settings: null,
    allMarkdownPaths: new Set(index.files.keys()), ignoredFolderPaths });
}

describe('colliding identities in the canonical vault index', () => {
  const first = file('resources/first.md');
  const second = file('exports/second.md');

  it('keeps all files but never selects a Resource by input order', () => {
    for (const files of [[first, second], [second, first]]) {
      const before = JSON.stringify(files);
      const index = VaultIndexEngine.createInitialIndex(files, parse);
      expect(index.files.size).toBe(2);
      expect(index.objects.has('shared')).toBe(false);
      expect(queryVaultObjects(index)).toEqual([]);
      expect(VaultIndexEngine.getObject(index, 'shared')).toBeUndefined();
      expect(reviewVaultIdentityCandidates(index).map(o => o.path).sort()).toEqual([second.path, first.path]);
      const duplicate = issues(index).filter(issue => issue.category === 'duplicate');
      expect(duplicate).toHaveLength(1);
      expect(duplicate[0].why).toContain('2 files');
      expect(duplicate[0].why).toContain(first.path);
      expect(duplicate[0].why).toContain(second.path);
      expect(duplicate[0].subjectPath).toBe(second.path);
      expect(issues(index).some(issue => issue.category === 'unidentified')).toBe(false);
      expect(JSON.stringify(files)).toBe(before);
      expect([...index.files.values()].map(f => f.content)).toEqual(files.map(f => f.content));
    }
  });

  it('recovers the sole remaining identity after deletion without changing the earlier snapshot', () => {
    const index = VaultIndexEngine.createInitialIndex([first, second], parse);
    const updated = VaultIndexEngine.updateIndex(index, [{ type: 'deleted', path: second.path }]);
    expect(updated.objects.get('shared')?.path).toBe(first.path);
    expect(issues(updated)).toEqual([]);
    expect(index.objects.has('shared')).toBe(false);
    expect(index.files.size).toBe(2);
  });

  it('tracks added collisions and re-identification on the existing incremental path', () => {
    const initial = VaultIndexEngine.createInitialIndex([first], parse);
    const collided = VaultIndexEngine.updateIndex(initial, [{ type: 'added', path: second.path, object: object(second) }]);
    expect(collided.objects.has('shared')).toBe(false);
    const changed = VaultIndexEngine.updateIndex(collided, [{ type: 'modified', path: second.path,
      object: object(file(second.path, 'reviewed')) }]);
    expect(changed.objects.get('shared')?.path).toBe(first.path);
    expect(changed.objects.get('reviewed')?.path).toBe(second.path);
    expect(issues(changed)).toEqual([]);
    expect(initial.objects.get('shared')?.path).toBe(first.path);
    expect(collided.objects.has('shared')).toBe(false);
  });

  it('retains a conflict with three files and restores uniqueness only after the last collision is invalidated', () => {
    const third = file('resources/third.md');
    const initial = VaultIndexEngine.createInitialIndex([first, second, third], parse);
    const two = VaultIndexEngine.invalidateCache(initial, [second.path]);
    expect(two.objects.has('shared')).toBe(false);
    expect(issues(two).find(issue => issue.category === 'duplicate')?.why).toContain('2 files');
    const one = VaultIndexEngine.invalidateCache(two, [third.path]);
    expect(one.objects.get('shared')?.path).toBe(first.path);
    expect(initial.files.size).toBe(3);
  });

  it('keeps ignored and system copies out of Issues without declaring the identity unique', () => {
    const index = VaultIndexEngine.createInitialIndex([first, file('_trash/old.md'), file('app/copy.md')], parse);
    expect(index.objects.has('shared')).toBe(false);
    expect(queryVaultObjects(index)).toEqual([]);
    expect(issues(index, ['_trash'])).toEqual([]);
  });

  it('restores the remaining object when the other ID is removed and retains the unidentified file', () => {
    const initial = VaultIndexEngine.createInitialIndex([first, second], parse);
    const changed = VaultIndexEngine.updateIndex(initial, [{ type: 'modified', path: second.path,
      object: { ...object(second), id: '', frontmatter: { type: 'resource' } } }]);
    expect(changed.objects.get('shared')?.path).toBe(first.path);
    expect(changed.files.has(second.path)).toBe(true);
    expect(issues(changed).map(issue => [issue.category, issue.subjectPath])).toEqual([
      ['unidentified', second.path],
    ]);
  });

  it('does not let a cross-type collision choose either object or falsely break a path link', () => {
    const other = { ...second, content: second.content.replace('type: resource', 'type: note') };
    const linked = file('notes/linked.md', 'unique');
    linked.content = linked.content.replace('type: resource', 'type: note\nlinks: ["[[resources/first]]"]');
    const index = VaultIndexEngine.createInitialIndex([first, other, linked], parse);
    expect(queryVaultObjects(index).map(o => o.id)).toEqual(['unique']);
    expect(issues(index).map(issue => issue.category)).toEqual(['duplicate']);
    expect(reviewVaultIdentityCandidates(index).filter(o => o.id === 'shared').map(o => o.type).sort()).toEqual(['note', 'resource']);
  });
});
