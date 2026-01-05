const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const UndoRedoService = require('../src/main/services/UndoRedoService');
const { container, ServiceIds } = require('../src/main/services/ServiceContainer');

// Mock dependencies
jest.mock('fs', () => {
  const originalFs = jest.requireActual('fs');
  return {
    ...originalFs,
    promises: {
      readFile: jest.fn(),
      writeFile: jest.fn(),
      rename: jest.fn(),
      unlink: jest.fn(),
      mkdir: jest.fn(),
      stat: jest.fn(),
      access: jest.fn(),
      copyFile: jest.fn(),
      readdir: jest.fn(),
      rmdir: jest.fn()
    }
  };
});

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/user/data')
  }
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: jest.fn()
}));

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    tryResolve: jest.fn()
  },
  ServiceIds: {
    CHROMA_DB: 'CHROMA_DB'
  }
}));

describe('UndoRedoService Extended Tests', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UndoRedoService({
      maxActions: 10,
      maxMemoryMB: 1, // Small limit for testing
      maxBatchSize: 100
    });
  });

  describe('Initialization & Persistence', () => {
    test('loads actions from disk on initialization', async () => {
      const mockData = {
        actions: [{ id: '1', type: 'test' }],
        currentIndex: 0
      };
      fs.readFile.mockResolvedValue(JSON.stringify(mockData));

      await service.initialize();

      expect(service.actions.length).toBe(1);
      expect(service.currentIndex).toBe(0);
      expect(service.initialized).toBe(true);
    });

    test('handles corrupted actions file gracefully', async () => {
      fs.readFile.mockRejectedValue(new Error('Corrupted'));
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      await service.initialize();

      expect(service.actions.length).toBe(0);
      expect(service.currentIndex).toBe(-1);
      // Should attempt to save fresh state
      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('cleanupOldBackups removes orphaned files', async () => {
      const backupDir = path.join('/mock/user/data', 'undo-backups');
      fs.access.mockResolvedValue(); // Dir exists
      fs.readdir.mockResolvedValue(['orphan.bak', 'active.bak']);

      // Setup service with one active backup
      service.actions = [
        {
          data: { backupPath: path.join(backupDir, 'active.bak') }
        }
      ];

      await service.cleanupOldBackups();

      // Should remove orphan but keep active
      expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining('orphan.bak'));
      expect(fs.unlink).not.toHaveBeenCalledWith(expect.stringContaining('active.bak'));
    });
  });

  describe('Memory Management', () => {
    test('prunes old actions when maxActions limit exceeded', async () => {
      service = new UndoRedoService({ maxActions: 2 });
      fs.readFile.mockRejectedValue(new Error('New'));

      await service.recordAction('A1', {});
      await service.recordAction('A2', {});
      await service.recordAction('A3', {});

      expect(service.actions.length).toBe(2);
      expect(service.actions[0].type).toBe('A2'); // A1 removed
      expect(service.actions[1].type).toBe('A3');
    });

    test('prunes actions when memory limit exceeded', async () => {
      // Set small memory limit (~1KB)
      service = new UndoRedoService({ maxMemoryMB: 0.001 });
      fs.readFile.mockRejectedValue(new Error('New'));

      // Create large payload (but small enough to fit one)
      const largeData = { data: 'x'.repeat(400) }; // ~800 bytes + overhead

      await service.recordAction('A1', largeData);
      await service.recordAction('A2', largeData);

      // A1 should be removed to make room for A2
      expect(service.actions.length).toBe(1);
      expect(service.actions[0].type).toBe('A2');
    });

    test('truncates single oversized action to prevent infinite loop', async () => {
      service = new UndoRedoService({ maxMemoryMB: 0.001 }); // ~1KB
      fs.readFile.mockRejectedValue(new Error('New'));

      // Single action larger than total memory
      const hugeData = { data: 'x'.repeat(2000) }; // ~4KB -> too big

      await service.recordAction('HUGE', hugeData);

      // Should result in 1 action (truncated)
      // The truncated message is small enough to fit in 1KB
      expect(service.actions.length).toBe(1);
      expect(service.actions[0].data.truncated).toBe(true);
    });
  });

  describe('Batch Operations', () => {
    test('undo batch operation reverses all steps', async () => {
      const ops = [
        { type: 'move', originalPath: 'A', newPath: 'B' },
        { type: 'rename', originalPath: 'C', newPath: 'D' }
      ];

      const mockState = {
        actions: [
          {
            id: 'batch1',
            type: 'BATCH_OPERATION',
            data: { operations: ops },
            timestamp: new Date().toISOString()
          }
        ],
        currentIndex: 0
      };

      // Mock readFile so initialize() loads this state
      fs.readFile.mockResolvedValue(JSON.stringify(mockState));

      // We need to re-initialize or create new service to trigger load
      service = new UndoRedoService();

      fs.rename.mockResolvedValue(); // For safeMove
      fs.mkdir.mockResolvedValue();

      const result = await service.undo();

      expect(result.success).toBe(true);
      // Should reverse operations in reverse order (2 renames) + saveActions (1 rename)
      expect(fs.rename).toHaveBeenCalledTimes(3);
      expect(result.successCount).toBe(2);

      // Verify specific calls (paths are normalized to absolute)
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringContaining('D'),
        expect.stringContaining('C')
      );
      expect(fs.rename).toHaveBeenCalledWith(
        expect.stringContaining('B'),
        expect.stringContaining('A')
      );
    });

    test('handles partial failures in batch undo', async () => {
      const ops = [
        { type: 'move', originalPath: 'A', newPath: 'B' },
        { type: 'delete', originalPath: 'X', backupPath: 'missing.bak' }
      ];

      const mockState = {
        actions: [
          {
            id: 'batch1',
            type: 'BATCH_OPERATION',
            data: { operations: ops },
            timestamp: new Date().toISOString()
          }
        ],
        currentIndex: 0
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockState));
      service = new UndoRedoService();

      fs.rename.mockResolvedValue();
      // Mock file check failure for backup
      fs.access.mockRejectedValue(new Error('Not found'));

      const result = await service.undo();

      expect(result.success).toBe(true); // Overall undo call succeeds (doesn't throw)
      expect(result.successCount).toBe(1); // Move succeeded
      expect(result.failCount).toBe(1); // Delete restore failed
    });
  });

  describe('Backup Resilience', () => {
    test('createBackup persists state immediately', async () => {
      const filePath = '/docs/file.txt';
      const backupDir = '/mock/user/data/undo-backups';

      fs.access.mockResolvedValue(); // File exists
      fs.copyFile.mockResolvedValue();
      fs.stat.mockResolvedValue({ size: 100 });
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue(); // Save state

      const backupPath = await service.createBackup(filePath);

      expect(fs.copyFile).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled(); // Ensure state saved
      expect(backupPath).toContain('undo-backups');
    });

    test('undo fails explicitly if backup missing', async () => {
      const mockState = {
        actions: [
          {
            type: 'FILE_DELETE',
            data: { originalPath: 'A', backupPath: 'A.bak' }
          }
        ],
        currentIndex: 0
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockState));
      service = new UndoRedoService();

      fs.access.mockRejectedValue(new Error('ENOENT'));

      await expect(service.undo()).rejects.toThrow('backup not found');
    });
  });

  describe('Atomic Persistence', () => {
    test('saveActions uses atomic write pattern', async () => {
      service.actions = [{ id: '1' }];
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();

      await service.saveActions();

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp.'),
        expect.any(String)
      );
      expect(fs.rename).toHaveBeenCalled();
    });

    test('saveActions retries on EPERM', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const eperm = new Error('Locked');
      eperm.code = 'EPERM';

      fs.rename.mockRejectedValueOnce(eperm).mockResolvedValueOnce(undefined); // Success on retry

      await service.saveActions();

      expect(fs.rename).toHaveBeenCalledTimes(2);
    });
  });
});
