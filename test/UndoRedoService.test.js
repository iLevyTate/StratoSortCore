/**
 * @jest-environment node
 */
/**
 * Tests for UndoRedoService
 * Tests undo/redo functionality, memory management, and file operations
 */

// Unmock fs to use real filesystem for these tests
// The global test-setup mocks fs with memfs, but this causes path resolution
// issues on Windows. These tests need the real filesystem.
jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('os');

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

// Mock electron with a getter that reads the dynamic value
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

describe('UndoRedoService', () => {
  let UndoRedoService;
  let service;
  let testDir;

  beforeEach(async () => {
    // Create temp directory for tests FIRST
    testDir = path.join(os.tmpdir(), `undo-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Update the mock to return our testDir
    const electron = require('electron');
    electron.app.getPath.mockReturnValue(testDir);

    // Clear module cache and re-require with updated mock
    jest.resetModules();

    // After reset, re-require electron and update mock again
    const electronAfterReset = require('electron');
    electronAfterReset.app.getPath.mockReturnValue(testDir);

    UndoRedoService = require('../src/main/services/UndoRedoService');
    service = new UndoRedoService({
      maxActions: 10,
      maxMemoryMB: 1,
      maxBatchSize: 100
    });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    test('initializes with default options', () => {
      const defaultService = new UndoRedoService();
      expect(defaultService.maxActions).toBe(50);
      expect(defaultService.maxMemoryMB).toBe(10);
      expect(defaultService.maxBatchSize).toBe(1000);
    });

    test('accepts custom options', () => {
      expect(service.maxActions).toBe(10);
      expect(service.maxMemoryMB).toBe(1);
      expect(service.maxBatchSize).toBe(100);
    });

    test('initializes with empty actions', () => {
      expect(service.actions).toEqual([]);
      expect(service.currentIndex).toBe(-1);
    });
  });

  describe('initialize', () => {
    test('sets initialized to true', async () => {
      await service.initialize();
      expect(service.initialized).toBe(true);
    });

    test('does not reinitialize', async () => {
      await service.initialize();
      const spy = jest.spyOn(service, 'loadActions');
      await service.initialize();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('canUndo/canRedo', () => {
    test('canUndo returns false when no actions', () => {
      expect(service.canUndo()).toBe(false);
    });

    test('canRedo returns false when no actions', () => {
      expect(service.canRedo()).toBe(false);
    });

    test('canUndo returns true after recording action', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });
      expect(service.canUndo()).toBe(true);
    });

    test('canRedo returns true after undo', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(dest, 'content');

      await service.recordAction('FILE_MOVE', {
        originalPath: source,
        newPath: dest
      });

      await service.undo();
      expect(service.canRedo()).toBe(true);
    });
  });

  describe('recordAction', () => {
    test('records action and increments index', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });

      expect(service.actions).toHaveLength(1);
      expect(service.currentIndex).toBe(0);
    });

    test('generates unique action ID', async () => {
      const id1 = await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });
      const id2 = await service.recordAction('FILE_MOVE', {
        originalPath: '/c',
        newPath: '/d'
      });

      expect(id1).not.toBe(id2);
    });

    test('truncates batch operations over max size', async () => {
      const operations = Array(200)
        .fill()
        .map((_, i) => ({
          type: 'move',
          originalPath: `/a${i}`,
          newPath: `/b${i}`
        }));

      await service.recordAction('BATCH_ORGANIZE', { operations });

      expect(service.actions[0].data.operations.length).toBe(100);
    });

    test('removes future actions when recording after undo', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });

      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(dest, 'content');
      await service.recordAction('FILE_MOVE', {
        originalPath: source,
        newPath: dest
      });

      await service.undo();

      await service.recordAction('FILE_RENAME', {
        originalPath: '/e',
        newPath: '/f'
      });

      expect(service.actions).toHaveLength(2);
      expect(service.actions[1].type).toBe('FILE_RENAME');
    });

    test('prunes old actions when max is exceeded', async () => {
      for (let i = 0; i < 15; i++) {
        await service.recordAction('FILE_MOVE', {
          originalPath: `/a${i}`,
          newPath: `/b${i}`
        });
      }

      expect(service.actions.length).toBeLessThanOrEqual(10);
    });
  });

  describe('getActionDescription', () => {
    test('describes FILE_MOVE', () => {
      const desc = service.getActionDescription('FILE_MOVE', {
        originalPath: '/home/test.txt',
        newPath: '/home/docs/test.txt'
      });
      expect(desc).toContain('Move');
      expect(desc).toContain('test.txt');
    });

    test('describes FILE_RENAME', () => {
      const desc = service.getActionDescription('FILE_RENAME', {
        originalPath: '/home/old.txt',
        newPath: '/home/new.txt'
      });
      expect(desc).toContain('Rename');
      expect(desc).toContain('old.txt');
      expect(desc).toContain('new.txt');
    });

    test('describes FILE_DELETE', () => {
      const desc = service.getActionDescription('FILE_DELETE', {
        originalPath: '/home/deleted.txt'
      });
      expect(desc).toContain('Delete');
      expect(desc).toContain('deleted.txt');
    });

    test('describes FOLDER_CREATE', () => {
      const desc = service.getActionDescription('FOLDER_CREATE', {
        folderPath: '/home/newfolder'
      });
      expect(desc).toContain('Create folder');
      expect(desc).toContain('newfolder');
    });

    test('describes BATCH_ORGANIZE', () => {
      const desc = service.getActionDescription('BATCH_ORGANIZE', {
        operations: [{}, {}, {}]
      });
      expect(desc).toContain('Organize');
      expect(desc).toContain('3');
    });
  });

  describe('generateId', () => {
    test('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(service.generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('getActionHistory', () => {
    test('returns empty array when no actions', () => {
      expect(service.getActionHistory()).toEqual([]);
    });

    test('returns action history', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });
      await service.recordAction('FILE_RENAME', {
        originalPath: '/c',
        newPath: '/d'
      });

      const history = service.getActionHistory();

      expect(history).toHaveLength(2);
      expect(history[0]).toHaveProperty('id');
      expect(history[0]).toHaveProperty('description');
      expect(history[0]).toHaveProperty('timestamp');
      expect(history[0]).toHaveProperty('type');
    });

    test('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await service.recordAction('FILE_MOVE', {
          originalPath: `/a${i}`,
          newPath: `/b${i}`
        });
      }

      const history = service.getActionHistory(2);
      expect(history).toHaveLength(2);
    });
  });

  describe('getRedoHistory', () => {
    test('returns empty array when nothing to redo', () => {
      expect(service.getRedoHistory()).toEqual([]);
    });
  });

  describe('clearHistory', () => {
    test('clears all actions', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });
      await service.recordAction('FILE_MOVE', {
        originalPath: '/c',
        newPath: '/d'
      });

      await service.clearHistory();

      expect(service.actions).toEqual([]);
      expect(service.currentIndex).toBe(-1);
      expect(service.currentMemoryEstimate).toBe(0);
    });
  });

  describe('getStats', () => {
    test('returns statistics', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });

      const stats = service.getStats();

      expect(stats).toHaveProperty('totalActions');
      expect(stats).toHaveProperty('currentIndex');
      expect(stats).toHaveProperty('canUndo');
      expect(stats).toHaveProperty('canRedo');
      expect(stats).toHaveProperty('memoryUsageMB');
      expect(stats).toHaveProperty('memoryLimitMB');
      expect(stats).toHaveProperty('actionLimit');
      expect(stats).toHaveProperty('batchSizeLimit');
    });

    test('totalActions reflects recorded actions', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });
      await service.recordAction('FILE_MOVE', {
        originalPath: '/c',
        newPath: '/d'
      });

      const stats = service.getStats();
      expect(stats.totalActions).toBe(2);
    });
  });

  describe('fileExists', () => {
    test('returns true for existing file', async () => {
      const filePath = path.join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'content');

      const result = await service.fileExists(filePath);
      expect(result).toBe(true);
    });

    test('returns false for non-existing file', async () => {
      const filePath = path.join(testDir, 'notexists.txt');
      const result = await service.fileExists(filePath);
      expect(result).toBe(false);
    });
  });

  describe('safeMove', () => {
    test('moves file to destination', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      await service.safeMove(source, dest);

      expect(await service.fileExists(source)).toBe(false);
      expect(await service.fileExists(dest)).toBe(true);
    });

    test('creates destination directory if needed', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'subdir', 'dest.txt');
      await fs.writeFile(source, 'content');

      await service.safeMove(source, dest);

      expect(await service.fileExists(dest)).toBe(true);
    });
  });

  describe('createBackup', () => {
    test('creates backup of file', async () => {
      const source = path.join(testDir, 'tobackup.txt');
      await fs.writeFile(source, 'backup content');

      const backupPath = await service.createBackup(source);

      expect(await service.fileExists(backupPath)).toBe(true);
    });

    test('backup has same content', async () => {
      const source = path.join(testDir, 'tobackup.txt');
      const content = 'original content';
      await fs.writeFile(source, content);

      const backupPath = await service.createBackup(source);
      const backupContent = await fs.readFile(backupPath, 'utf8');

      expect(backupContent).toBe(content);
    });

    test('throws for non-existent file', async () => {
      const source = path.join(testDir, 'notexists.txt');

      await expect(service.createBackup(source)).rejects.toThrow();
    });
  });

  describe('cleanupOldBackups', () => {
    test('returns cleanup result', async () => {
      const result = await service.cleanupOldBackups();
      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('errors');
    });
  });

  describe('memory management', () => {
    test('estimates action size', () => {
      const action = {
        id: 'test',
        type: 'FILE_MOVE',
        data: { originalPath: '/a', newPath: '/b' }
      };
      const size = service._estimateActionSize(action);
      expect(typeof size).toBe('number');
      expect(size).toBeGreaterThan(0);
    });

    test('recalculates memory estimate', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a',
        newPath: '/b'
      });
      const beforeRecalc = service.currentMemoryEstimate;

      service._recalculateMemoryEstimate();

      expect(service.currentMemoryEstimate).toBe(beforeRecalc);
    });
  });

  describe('undo', () => {
    test('throws when nothing to undo', async () => {
      await service.initialize();
      await expect(service.undo()).rejects.toThrow('No actions to undo');
    });
  });

  describe('redo', () => {
    test('throws when nothing to redo', async () => {
      await service.initialize();
      await expect(service.redo()).rejects.toThrow('No actions to redo');
    });
  });
});
