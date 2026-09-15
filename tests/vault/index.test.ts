import { describe, it, expect } from 'vitest';
import { VaultIndexEngine } from '../../src/vault/index';
import { VaultFile, IndexChange } from '../../src/vault/index/types';

describe('Vault Index Engine', () => {
  it('should create initial index from files', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      },
      {
        path: 'notes/note.md',
        content: '---\nid: note-1\ntype: note\ntitle: Test Note\n---\nNote body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);

    expect(index.files.size).toBe(2);
    expect(index.objects.size).toBe(2);
    expect(index.objects.has('task-1')).toBe(true);
    expect(index.objects.has('note-1')).toBe(true);
  });

  it('should update index with changes', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);

    const changes: IndexChange[] = [
      {
        type: 'added',
        path: 'tasks/new-task.md',
        object: {
          id: 'task-2',
          type: 'task',
          path: 'tasks/new-task.md',
          frontmatter: { id: 'task-2', type: 'task', title: 'New Task' },
          body: 'New task body'
        }
      }
    ];

    const updatedIndex = VaultIndexEngine.updateIndex(index, changes);

    expect(updatedIndex.files.size).toBe(2);
    expect(updatedIndex.objects.size).toBe(2);
    expect(updatedIndex.objects.has('task-2')).toBe(true);
  });

  it('should handle deletion', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);

    const changes: IndexChange[] = [
      {
        type: 'deleted',
        path: 'tasks/task.md'
      }
    ];

    const updatedIndex = VaultIndexEngine.updateIndex(index, changes);

    expect(updatedIndex.files.size).toBe(0);
    expect(updatedIndex.objects.size).toBe(0);
  });

  it('should get object by id', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);
    const obj = VaultIndexEngine.getObject(index, 'task-1');

    expect(obj).toBeDefined();
    expect(obj?.id).toBe('task-1');
  });

  it('should get objects by type', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      },
      {
        path: 'notes/note.md',
        content: '---\nid: note-1\ntype: note\ntitle: Test Note\n---\nNote body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);
    const tasks = VaultIndexEngine.getObjectsByType(index, 'task');

    expect(tasks.length).toBe(1);
    expect(tasks[0].id).toBe('task-1');
  });

  it('should search objects', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);
    const results = VaultIndexEngine.searchObjects(index, 'test');

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('task-1');
  });

  it('should invalidate cache', () => {
    const files: VaultFile[] = [
      {
        path: 'tasks/task.md',
        content: '---\nid: task-1\ntype: task\ntitle: Test Task\n---\nTask body',
        modified: Date.now(),
        size: 50
      }
    ];

    const index = VaultIndexEngine.createInitialIndex(files);
    const updatedIndex = VaultIndexEngine.invalidateCache(index, ['tasks/task.md']);

    expect(updatedIndex.files.size).toBe(0);
    expect(updatedIndex.objects.size).toBe(0);
  });
});
