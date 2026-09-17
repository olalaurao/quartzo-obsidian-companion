import { ObjectParser } from '../../core/objects';
import { VaultFile, IndexedObject, VaultIndex, IndexChange } from './types';
import type { ParseResult } from '../../core/objects/types';

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

  static createInitialIndex(
    files: VaultFile[],
    parseFile: (content: string, path: string) => ParseResult = (content) => ObjectParser.parse(content),
  ): VaultIndex {
    const index: VaultIndex = {
      files: new Map(),
      objects: new Map(),
      lastModified: Date.now()
    };

    for (const file of files) {
      index.files.set(file.path, file);
      
      // Try to parse as object
      try {
        const result = parseFile(file.content, file.path);
        const indexedObject: IndexedObject = {
          id: result.object.id,
          type: result.object.type,
          path: file.path,
          frontmatter: result.object as Record<string, unknown>,
          body: result.object.body || ''
        };
        index.objects.set(result.object.id, indexedObject);
      } catch {
        // Not a valid object, skip
      }
    }

    return index;
  }

  static updateIndex(index: VaultIndex, changes: IndexChange[]): VaultIndex {
    const newIndex: VaultIndex = {
      files: new Map(index.files),
      objects: new Map(index.objects),
      lastModified: Date.now()
    };

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
            newIndex.objects.set(change.object.id, change.object);
          }
          break;
        case 'deleted':
          const file = newIndex.files.get(change.path);
          if (file) {
            newIndex.files.delete(change.path);
            // Find and remove associated object
            for (const [objId, obj] of newIndex.objects.entries()) {
              if (obj.path === change.path) {
                newIndex.objects.delete(objId);
                break;
              }
            }
          }
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
    const lowerQuery = query.toLowerCase();
    return Array.from(index.objects.values()).filter(obj => {
      const title = (obj.frontmatter.title as string) || '';
      const body = obj.body || '';
      return title.toLowerCase().includes(lowerQuery) || body.toLowerCase().includes(lowerQuery);
    });
  }

  static invalidateCache(index: VaultIndex, paths: string[]): VaultIndex {
    const newIndex: VaultIndex = {
      files: new Map(index.files),
      objects: new Map(index.objects),
      lastModified: Date.now()
    };

    for (const path of paths) {
      const file = newIndex.files.get(path);
      if (file) {
        // Remove file and associated object
        newIndex.files.delete(path);
        for (const [objId, obj] of newIndex.objects.entries()) {
          if (obj.path === path) {
            newIndex.objects.delete(objId);
            break;
          }
        }
      }
    }

    return newIndex;
  }
}
