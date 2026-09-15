export interface VaultFile {
  path: string;
  content: string;
  modified: number;
  size: number;
}

export interface IndexedObject {
  id: string;
  type: string;
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export interface VaultIndex {
  files: Map<string, VaultFile>;
  objects: Map<string, IndexedObject>;
  lastModified: number;
}

export interface IndexChange {
  type: 'added' | 'modified' | 'deleted';
  path: string;
  object?: IndexedObject;
}
