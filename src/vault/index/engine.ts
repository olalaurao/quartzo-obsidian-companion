import { ObjectParser } from '../../core/objects';
import { VaultFile, IndexedObject, VaultIndex, IndexChange } from './types';
import type { ParseResult } from '../../core/objects/types';
import { searchVaultObjects } from '../../core/object-query';

function hasObjectIdentity(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

function removeObjectAtPath(index: VaultIndex, path: string): void {
  for (const [id, object] of index.objects) {
    if (object.path === path) index.objects.delete(id);
  }
  for (const [id, candidates] of index.identityConflicts ?? []) {
    const remaining = candidates.filter(object => object.path !== path);
    if (remaining.length === candidates.length) continue;
    if (remaining.length > 1) index.identityConflicts!.set(id, remaining);
    else {
      index.identityConflicts!.delete(id);
      if (remaining.length === 1) index.objects.set(id, remaining[0]!);
    }
  }
}

function addObject(index: VaultIndex, object: IndexedObject): void {
  if (!hasObjectIdentity(object.id)) return;
  const conflicts = index.identityConflicts ??= new Map();
  const prior = index.objects.get(object.id);
  const candidates = conflicts.get(object.id);
  if (candidates) conflicts.set(object.id, [...candidates, object]);
  else if (prior) {
    index.objects.delete(object.id);
    conflicts.set(object.id, [prior, object]);
  } else index.objects.set(object.id, object);
}

function copyIndex(index: VaultIndex): VaultIndex {
  return {
    files: new Map(index.files), objects: new Map(index.objects),
    identityConflicts: new Map(index.identityConflicts),
    lastModified: Date.now(),
  };
}

export class VaultIndexEngine {
  private index: VaultIndex | null = null;

  constructor() {
    this.index = null;
  }

  getIndex(): VaultIndex | null {
    return this.index;
  }

  setIndex(index: VaultIndex): void {
    this.index = index;
  }

  /** Apply completed incremental work to the current snapshot, without an await. */
  applyChanges(changes: IndexChange[]): VaultIndex | null {
    if (!this.index) return null;
    this.index = VaultIndexEngine.updateIndex(this.index, changes);
    return this.index;
  }

  static createInitialIndex(
    files: VaultFile[],
    parseFile: (content: string, path: string) => ParseResult = (content) => ObjectParser.parse(content),
  ): VaultIndex {
    const index: VaultIndex = {
      files: new Map(),
      objects: new Map(),
      identityConflicts: new Map(),
      lastModified: Date.now()
    };

    for (const file of files) {
      if (index.files.has(file.path)) removeObjectAtPath(index, file.path);
      index.files.set(file.path, file);
      
      // Try to parse as object
      try {
        const result = parseFile(file.content, file.path);
        const indexedObject: IndexedObject = {
          id: result.object.id,
          type: result.object.type,
          path: file.path,
          frontmatter: result.object as Record<string, unknown>,
          body: result.object.body || '',
          identification: result.identification,
        };
        // Keep unidentified Markdown in files for the existing Issues projection.
        // An empty/invalid ID is not a shared identity for unrelated files.
        addObject(index, indexedObject);
      } catch {
        // Not a valid object, skip
      }
    }

    return index;
  }

  static updateIndex(index: VaultIndex, changes: IndexChange[]): VaultIndex {
    const newIndex = copyIndex(index);

    for (const change of changes) {
      switch (change.type) {
        case 'added':
        case 'modified':
          if (change.object) {
            const file: VaultFile = {
              path: change.object.path,
              content: `---\n${JSON.stringify(change.object.frontmatter)}\n---\n${change.object.body}`,
              modified: Date.now(),
              size: change.object.body.length
            };
            newIndex.files.set(change.object.path, file);
            removeObjectAtPath(newIndex, change.path);
            if (change.object.path !== change.path) removeObjectAtPath(newIndex, change.object.path);
            addObject(newIndex, change.object);
          }
          break;
        case 'deleted':
          newIndex.files.delete(change.path);
          removeObjectAtPath(newIndex, change.path);
          break;
      }
    }

    return newIndex;
  }

  static getObject(index: VaultIndex, id: string): IndexedObject | undefined {
    return index.objects.get(id);
  }

  static getObjectsByType(index: VaultIndex, type: string): IndexedObject[] {
    return Array.from(index.objects.values()).filter(obj => obj.type === type);
  }

  static searchObjects(index: VaultIndex, query: string): IndexedObject[] {
    return searchVaultObjects(index, query);
  }

  static invalidateCache(index: VaultIndex, paths: string[]): VaultIndex {
    const newIndex = copyIndex(index);

    for (const path of paths) {
      const file = newIndex.files.get(path);
      if (file) {
        // Remove file and associated object
        newIndex.files.delete(path);
        removeObjectAtPath(newIndex, path);
      }
    }

    return newIndex;
  }
}
