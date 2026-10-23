import { describe, expect, it } from 'vitest';
import { VaultIndexEngine, type VaultFile } from '../../src/vault/index';
import { parseObjectWithSharedSettings } from '../../src/core/shared-settings';
import { projectOrganizationIssues } from '../../src/core/object-organization/issues-projection';
import { resolveOrganizationScope } from '../../src/core/object-organization/scope-resolver';
import { queryVaultObjects } from '../../src/core/object-query';

function file(path: string, properties: string): VaultFile {
  const content = `---\n${properties}\ntype: resource\nfuture_field: keep\n---\nSynthetic highlight [[tag]]\n`;
  return { path, content, modified: 1, size: content.length };
}

const parse = (content: string, path: string) => parseObjectWithSharedSettings(content, path, null);

function issues(index: ReturnType<typeof VaultIndexEngine.createInitialIndex>) {
  return projectOrganizationIssues({
    index, settings: null, allMarkdownPaths: new Set(index.files.keys()), ignoredFolderPaths: [],
  });
}

describe('unidentified Markdown in the canonical vault index', () => {
  it('preserves every ID-less file for Issues without selecting an arbitrary Resource', () => {
    const files = [file('exports/one.md', 'title: One'), file('exports/two.md', 'title: Two')];
    const before = JSON.stringify(files);
    for (const ordered of [files, [...files].reverse()]) {
      const index = VaultIndexEngine.createInitialIndex(ordered, parse);
      expect([...index.files.values()]).toEqual(ordered);
      expect(index.objects.size).toBe(0);
      expect(queryVaultObjects(index)).toEqual([]);
      expect(issues(index).map(issue => issue.subjectPath).sort()).toEqual(files.map(f => f.path));
      expect(issues(index).every(issue => issue.category === 'unidentified' && !issue.subjectId)).toBe(true);
      const scope = resolveOrganizationScope({
        files: files.map(f => f.path), includeSubfolders: false,
        allVaultPaths: [...index.files.keys()],
        indexedObjectsByPath: new Map([...index.objects.values()].map(o => [o.path, o.id])),
      });
      expect(scope.indexedObjectIds).toEqual([]);
      expect(scope.unidentifiedMarkdownPaths).toEqual(files.map(f => f.path));
    }
    expect(JSON.stringify(files)).toBe(before);
  });

  it.each(['', 'id: null', 'id: "   "', 'id: 123', 'id: [one, two]'])(
    'does not treat invalid identity %s as a canonical object', properties => {
      const input = file('exports/unidentified.md', properties);
      const index = VaultIndexEngine.createInitialIndex([input], parse);
      expect(index.files.get(input.path)).toEqual(input);
      expect(index.objects.size).toBe(0);
      expect(issues(index)).toHaveLength(1);
    },
  );

  it('keeps valid identities usable alongside unidentified and malformed files', () => {
    const known = file('resources/known.md', 'id: known-resource\ntitle: Known');
    const legacy = file('exports/legacy.md', 'title: Legacy');
    const malformed = file('exports/broken.md', 'category: [[unquoted]]: broken');
    const index = VaultIndexEngine.createInitialIndex([known, legacy, malformed], parse);
    expect(index.files.size).toBe(3);
    expect(queryVaultObjects(index).map(object => object.id)).toEqual(['known-resource']);
    expect(issues(index).map(issue => issue.subjectPath).sort()).toEqual([malformed.path, legacy.path]);
    expect(index.files.get(malformed.path)?.content).toBe(malformed.content);
  });

  it('removes stale identity on modification and exposes the file for explicit classification', () => {
    const original = file('resources/item.md', 'id: original');
    const index = VaultIndexEngine.createInitialIndex([original], parse);
    const withoutId = parse(file(original.path, 'title: Legacy').content, original.path).object;
    const updated = VaultIndexEngine.updateIndex(index, [{
      type: 'modified', path: original.path,
      object: { id: withoutId.id, type: withoutId.type, path: original.path, frontmatter: withoutId, body: withoutId.body ?? '' },
    }]);
    expect(updated.objects.size).toBe(0);
    expect(issues(updated).map(issue => issue.subjectPath)).toEqual([original.path]);
    expect(index.objects.has('original')).toBe(true);
    const identified = { ...withoutId, id: 'reviewed' };
    const classified = VaultIndexEngine.updateIndex(updated, [{
      type: 'modified', path: original.path,
      object: { id: identified.id, type: identified.type, path: original.path, frontmatter: identified, body: identified.body ?? '' },
    }]);
    expect([...classified.objects.keys()]).toEqual(['reviewed']);
    expect(issues(classified)).toEqual([]);
    expect(VaultIndexEngine.updateIndex(classified, [{ type: 'deleted', path: original.path }]).files.size).toBe(0);
  });
});
