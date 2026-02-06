/**
 * @jest-environment node
 *
 * UndoRedoService Extended Tests
 *
 * Covers complex undo/redo chains, memory limits, batch operations,
 * mutex serialization, and edge cases not tested in the basic suite.
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/test/userData')
  }
}));

jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    mkdir: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
    access: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn().mockResolvedValue([]),
    rm: jest.fn().mockResolvedValue()
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

jest.mock('../src/shared/performanceConstants', () => ({
  RETRY: {
    ATOMIC_BACKOFF_STEP_MS: 10
  }
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn().mockResolvedValue()
}));

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    tryResolve: jest.fn(() => null),
    has: jest.fn(() => false),
    resolve: jest.fn(() => null)
  },
  ServiceIds: {
    ORAMA_VECTOR: 'ORAMA_VECTOR',
    FILE_PATH_COORDINATOR: 'FILE_PATH_COORDINATOR'
  }
}));

const fs = require('fs').promises;
const UndoRedoService = require('../src/main/services/UndoRedoService');

describe('UndoRedoService - Extended Tests', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default: no existing actions file
    const enoent = new Error('ENOENT');
    enoent.code = 'ENOENT';
    fs.readFile.mockRejectedValue(enoent);
    fs.access.mockRejectedValue(enoent); // For cleanupOldBackups

    service = new UndoRedoService({
      maxActions: 5,
      maxMemoryMB: 1,
      maxBatchSize: 10
    });
  });

  describe('Complex undo/redo chains', () => {
    test('record, undo, redo produces consistent state', async () => {
      // Spy on safeMove to prevent actual file operations
      service.safeMove = jest.fn().mockResolvedValue();

      const id = await service.recordAction('FILE_MOVE', {
        originalPath: '/a/file.txt',
        newPath: '/b/file.txt'
      });

      expect(id).toBeDefined();
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);

      const undoResult = await service.undo();
      expect(undoResult.success).toBe(true);
      expect(service.canUndo()).toBe(false);
      expect(service.canRedo()).toBe(true);

      const redoResult = await service.redo();
      expect(redoResult.success).toBe(true);
      expect(service.canUndo()).toBe(true);
      expect(service.canRedo()).toBe(false);
    });

    test('recording new action after undo discards redo stack', async () => {
      service.safeMove = jest.fn().mockResolvedValue();

      await service.recordAction('FILE_MOVE', {
        originalPath: '/a.txt',
        newPath: '/b.txt'
      });
      await service.recordAction('FILE_MOVE', {
        originalPath: '/c.txt',
        newPath: '/d.txt'
      });

      expect(service.actions.length).toBe(2);

      // Undo last action
      await service.undo();
      expect(service.canRedo()).toBe(true);

      // Record new action - should discard redo
      await service.recordAction('FILE_RENAME', {
        originalPath: '/e.txt',
        newPath: '/f.txt'
      });

      expect(service.canRedo()).toBe(false);
      expect(service.actions.length).toBe(2); // 1st action + new action
    });

    test('undo with no actions throws', async () => {
      await service.initialize();

      await expect(service.undo()).rejects.toThrow('No actions to undo');
    });

    test('redo with no undone actions throws', async () => {
      await service.initialize();

      await expect(service.redo()).rejects.toThrow('No actions to redo');
    });
  });

  describe('Memory limits', () => {
    test('prunes old actions when maxActions exceeded', async () => {
      for (let i = 0; i < 7; i++) {
        await service.recordAction('FILE_RENAME', {
          originalPath: `/old${i}.txt`,
          newPath: `/new${i}.txt`
        });
      }

      // maxActions is 5, so oldest actions should be pruned
      expect(service.actions.length).toBeLessThanOrEqual(5);
    });

    test('tracks memory estimate correctly', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a.txt',
        newPath: '/b.txt'
      });

      expect(service.currentMemoryEstimate).toBeGreaterThan(0);
    });

    test('_estimateActionSize handles circular references gracefully', () => {
      const circular = {};
      circular.self = circular;

      const size = service._estimateActionSize(circular);
      // Fallback to 1024 on circular reference
      expect(size).toBe(1024);
    });

    test('_recalculateMemoryEstimate sums all action sizes', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a.txt',
        newPath: '/b.txt'
      });
      await service.recordAction('FILE_MOVE', {
        originalPath: '/c.txt',
        newPath: '/d.txt'
      });

      const expected = service.actions.reduce((sum, a) => sum + service._estimateActionSize(a), 0);
      service._recalculateMemoryEstimate();
      expect(service.currentMemoryEstimate).toBe(expected);
    });
  });

  describe('Batch operations', () => {
    test('limits batch operation size to maxBatchSize', async () => {
      const ops = Array.from({ length: 20 }, (_, i) => ({
        originalPath: `/source/file${i}.txt`,
        newPath: `/dest/file${i}.txt`
      }));

      await service.recordAction('BATCH_ORGANIZE', { operations: ops });

      // The recorded action should have at most maxBatchSize (10) operations
      const action = service.actions[service.actions.length - 1];
      expect(action.data.operations.length).toBeLessThanOrEqual(10);
    });

    test('small batch operations are not truncated', async () => {
      const ops = Array.from({ length: 3 }, (_, i) => ({
        originalPath: `/source/file${i}.txt`,
        newPath: `/dest/file${i}.txt`
      }));

      await service.recordAction('BATCH_ORGANIZE', { operations: ops });

      const action = service.actions[service.actions.length - 1];
      expect(action.data.operations.length).toBe(3);
    });
  });

  describe('Action descriptions', () => {
    test('generates description for FILE_MOVE', () => {
      const desc = service.getActionDescription('FILE_MOVE', {
        originalPath: '/downloads/report.pdf',
        newPath: '/docs/Finance/report.pdf'
      });

      expect(desc).toContain('report.pdf');
    });

    test('generates description for FILE_RENAME', () => {
      const desc = service.getActionDescription('FILE_RENAME', {
        originalPath: '/docs/old-name.txt',
        newPath: '/docs/new-name.txt'
      });

      expect(desc).toContain('old-name.txt');
      expect(desc).toContain('new-name.txt');
    });
  });

  describe('History management', () => {
    test('getActionHistory returns limited results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.recordAction('FILE_RENAME', {
          originalPath: `/file${i}.txt`,
          newPath: `/renamed${i}.txt`
        });
      }

      const history = service.getActionHistory(3);
      expect(history.length).toBeLessThanOrEqual(3);
    });

    test('clearHistory resets everything', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a.txt',
        newPath: '/b.txt'
      });

      await service.clearHistory();

      expect(service.actions).toEqual([]);
      expect(service.currentIndex).toBe(-1);
      expect(service.currentMemoryEstimate).toBe(0);
    });

    test('getStats returns full state', async () => {
      await service.initialize();

      const stats = service.getStats();

      expect(stats).toHaveProperty('canUndo');
      expect(stats).toHaveProperty('canRedo');
      expect(stats).toHaveProperty('memoryUsageMB');
      expect(stats).toHaveProperty('memoryLimitMB');
      expect(stats).toHaveProperty('actionLimit');
      expect(stats).toHaveProperty('batchSizeLimit');
    });
  });

  describe('Persistence', () => {
    test('saveActions uses atomic write (temp + rename)', async () => {
      await service.recordAction('FILE_MOVE', {
        originalPath: '/a.txt',
        newPath: '/b.txt'
      });

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.any(String)
      );
      expect(fs.rename).toHaveBeenCalled();
    });

    test('loadActions restores state from disk', async () => {
      const saved = {
        actions: [
          {
            id: '1',
            type: 'FILE_MOVE',
            data: { originalPath: '/a', newPath: '/b' },
            timestamp: new Date().toISOString(),
            description: 'test'
          }
        ],
        currentIndex: 0
      };
      fs.readFile.mockResolvedValueOnce(JSON.stringify(saved));

      await service.loadActions();

      expect(service.actions).toHaveLength(1);
      expect(service.currentIndex).toBe(0);
    });

    test('loadActions handles corrupted JSON gracefully', async () => {
      fs.readFile.mockResolvedValueOnce('not-json{{{');

      await service.loadActions();

      expect(service.actions).toEqual([]);
      expect(service.currentIndex).toBe(-1);
    });
  });

  describe('Mutex serialization', () => {
    test('concurrent recordAction calls are serialized', async () => {
      const order = [];

      // Override saveActions to track call order
      const origSave = service.saveActions.bind(service);
      service.saveActions = async () => {
        order.push('save-start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('save-end');
      };

      await Promise.all([
        service.recordAction('FILE_MOVE', { originalPath: '/a', newPath: '/b' }),
        service.recordAction('FILE_MOVE', { originalPath: '/c', newPath: '/d' })
      ]);

      // Saves should be serialized (start-end-start-end, not interleaved)
      const firstEnd = order.indexOf('save-end');
      const secondStart = order.lastIndexOf('save-start');
      expect(firstEnd).toBeLessThan(secondStart);
    });
  });

  describe('Constructor configuration', () => {
    test('defaults for maxActions, maxMemoryMB, maxBatchSize', () => {
      const defaultService = new UndoRedoService();

      expect(defaultService.maxActions).toBe(50);
      expect(defaultService.maxMemoryMB).toBe(10);
      expect(defaultService.maxBatchSize).toBe(1000);
    });

    test('custom values are respected', () => {
      expect(service.maxActions).toBe(5);
      expect(service.maxMemoryMB).toBe(1);
      expect(service.maxBatchSize).toBe(10);
    });
  });

  describe('Initialize', () => {
    test('initialize sets initialized flag', async () => {
      await service.initialize();

      expect(service.initialized).toBe(true);
    });

    test('double initialize is a no-op', async () => {
      await service.initialize();
      await service.initialize();

      // Should only read file once (first init)
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    test('initialize recovers from loadActions failure', async () => {
      fs.readFile.mockRejectedValueOnce(new Error('Disk error'));

      await service.initialize();

      expect(service.initialized).toBe(true);
      expect(service.actions).toEqual([]);
    });
  });
});
