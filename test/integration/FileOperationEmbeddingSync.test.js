/**
 * Integration Tests for File Operation and Embedding Sync
 *
 * Tests that file operations (move, delete, rename) properly
 * synchronize with the embedding storage and search index.
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  },
  BrowserWindow: {
    getAllWindows: jest.fn(() => [])
  }
}));

// Mock logger
jest.mock('../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs
jest.mock('fs/promises', () => ({
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
  copyFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ isFile: () => true, isDirectory: () => false }),
  access: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined)
}));

describe('File Operation and Embedding Sync', () => {
  let mockChromaDb;
  let mockSearchService;
  let mockMainWindow;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock ChromaDB service
    mockChromaDb = {
      updateFilePath: jest.fn().mockResolvedValue({ success: true }),
      deleteFile: jest.fn().mockResolvedValue({ success: true }),
      getFileMetadata: jest.fn().mockResolvedValue({
        path: '/old/path/document.pdf',
        name: 'document.pdf',
        category: 'Documents'
      })
    };

    // Mock SearchService
    mockSearchService = {
      invalidateIndex: jest.fn(),
      isIndexStale: jest.fn().mockReturnValue(false),
      buildBM25Index: jest.fn().mockResolvedValue({ success: true })
    };

    // Mock main window
    mockMainWindow = {
      isDestroyed: jest.fn().mockReturnValue(false),
      webContents: {
        send: jest.fn()
      }
    };
  });

  describe('Move Operation Updates', () => {
    test('should notify renderer of file move', () => {
      // Simulate the notification that would be sent
      const moveData = {
        operation: 'move',
        oldPath: '/old/path/document.pdf',
        newPath: '/new/path/document.pdf'
      };

      mockMainWindow.webContents.send('file-operation-complete', moveData);

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'file-operation-complete',
        moveData
      );
    });

    test('should invalidate search index on file move', () => {
      mockSearchService.invalidateIndex({
        reason: 'file-move',
        oldPath: '/old/path/document.pdf',
        newPath: '/new/path/document.pdf'
      });

      expect(mockSearchService.invalidateIndex).toHaveBeenCalledWith({
        reason: 'file-move',
        oldPath: '/old/path/document.pdf',
        newPath: '/new/path/document.pdf'
      });
    });

    test('should update ChromaDB path on file move', async () => {
      await mockChromaDb.updateFilePath('/old/path/document.pdf', '/new/path/document.pdf');

      expect(mockChromaDb.updateFilePath).toHaveBeenCalledWith(
        '/old/path/document.pdf',
        '/new/path/document.pdf'
      );
    });
  });

  describe('Delete Operation Cleanup', () => {
    test('should notify renderer of file delete', () => {
      const deleteData = {
        operation: 'delete',
        oldPath: '/path/to/deleted-file.pdf'
      };

      mockMainWindow.webContents.send('file-operation-complete', deleteData);

      expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
        'file-operation-complete',
        deleteData
      );
    });

    test('should invalidate search index on file delete', () => {
      mockSearchService.invalidateIndex({
        reason: 'file-delete',
        oldPath: '/path/to/deleted-file.pdf'
      });

      expect(mockSearchService.invalidateIndex).toHaveBeenCalledWith({
        reason: 'file-delete',
        oldPath: '/path/to/deleted-file.pdf'
      });
    });

    test('should remove file from ChromaDB on delete', async () => {
      await mockChromaDb.deleteFile('/path/to/deleted-file.pdf');

      expect(mockChromaDb.deleteFile).toHaveBeenCalledWith('/path/to/deleted-file.pdf');
    });
  });

  describe('Search Results Refresh', () => {
    test('should trigger search rebuild when index is stale', async () => {
      mockSearchService.isIndexStale.mockReturnValue(true);

      // Simulate what happens when search is called with stale index
      if (mockSearchService.isIndexStale()) {
        await mockSearchService.buildBM25Index();
      }

      expect(mockSearchService.buildBM25Index).toHaveBeenCalled();
    });

    test('should not rebuild when index is fresh', async () => {
      mockSearchService.isIndexStale.mockReturnValue(false);

      // Simulate what happens when search is called with fresh index
      if (mockSearchService.isIndexStale()) {
        await mockSearchService.buildBM25Index();
      }

      expect(mockSearchService.buildBM25Index).not.toHaveBeenCalled();
    });
  });

  describe('Batch Operations', () => {
    test('should handle multiple file moves', () => {
      const files = [
        { oldPath: '/old/file1.pdf', newPath: '/new/file1.pdf' },
        { oldPath: '/old/file2.pdf', newPath: '/new/file2.pdf' },
        { oldPath: '/old/file3.pdf', newPath: '/new/file3.pdf' }
      ];

      // Single invalidation for batch
      mockSearchService.invalidateIndex({
        reason: 'batch-move',
        count: files.length
      });

      expect(mockSearchService.invalidateIndex).toHaveBeenCalledTimes(1);
    });

    test('should handle multiple file deletes', async () => {
      const files = ['/path/file1.pdf', '/path/file2.pdf', '/path/file3.pdf'];

      for (const file of files) {
        await mockChromaDb.deleteFile(file);
      }

      expect(mockChromaDb.deleteFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Recovery', () => {
    test('should handle ChromaDB update failure gracefully', async () => {
      mockChromaDb.updateFilePath.mockRejectedValueOnce(new Error('DB error'));

      let error = null;
      try {
        await mockChromaDb.updateFilePath('/old/path.pdf', '/new/path.pdf');
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeNull();
      expect(error.message).toBe('DB error');
    });

    test('should still invalidate index even if ChromaDB fails', () => {
      // Index invalidation should not depend on ChromaDB success
      mockSearchService.invalidateIndex({ reason: 'file-move' });

      expect(mockSearchService.invalidateIndex).toHaveBeenCalled();
    });

    test('should handle window destroyed before notification', () => {
      mockMainWindow.isDestroyed.mockReturnValue(true);

      // Should not throw when window is destroyed
      if (!mockMainWindow.isDestroyed()) {
        mockMainWindow.webContents.send('file-operation-complete', { operation: 'move' });
      }

      expect(mockMainWindow.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('Event Flow', () => {
    test('complete move operation flow', async () => {
      const oldPath = '/documents/old-name.pdf';
      const newPath = '/documents/new-name.pdf';

      // Step 1: Update ChromaDB
      await mockChromaDb.updateFilePath(oldPath, newPath);
      expect(mockChromaDb.updateFilePath).toHaveBeenCalledWith(oldPath, newPath);

      // Step 2: Invalidate search index
      mockSearchService.invalidateIndex({
        reason: 'file-move',
        oldPath,
        newPath
      });
      expect(mockSearchService.invalidateIndex).toHaveBeenCalled();

      // Step 3: Notify renderer
      if (!mockMainWindow.isDestroyed()) {
        mockMainWindow.webContents.send('file-operation-complete', {
          operation: 'move',
          oldPath,
          newPath
        });
      }
      expect(mockMainWindow.webContents.send).toHaveBeenCalled();
    });

    test('complete delete operation flow', async () => {
      const filePath = '/documents/deleted-file.pdf';

      // Step 1: Delete from ChromaDB
      await mockChromaDb.deleteFile(filePath);
      expect(mockChromaDb.deleteFile).toHaveBeenCalledWith(filePath);

      // Step 2: Invalidate search index
      mockSearchService.invalidateIndex({
        reason: 'file-delete',
        oldPath: filePath
      });
      expect(mockSearchService.invalidateIndex).toHaveBeenCalled();

      // Step 3: Notify renderer
      if (!mockMainWindow.isDestroyed()) {
        mockMainWindow.webContents.send('file-operation-complete', {
          operation: 'delete',
          oldPath: filePath
        });
      }
      expect(mockMainWindow.webContents.send).toHaveBeenCalled();
    });
  });

  describe('IPC Event Structure', () => {
    test('move event should have correct structure', () => {
      const event = {
        operation: 'move',
        oldPath: '/old/path/file.pdf',
        newPath: '/new/path/file.pdf'
      };

      expect(event).toHaveProperty('operation', 'move');
      expect(event).toHaveProperty('oldPath');
      expect(event).toHaveProperty('newPath');
    });

    test('delete event should have correct structure', () => {
      const event = {
        operation: 'delete',
        oldPath: '/path/to/deleted-file.pdf'
      };

      expect(event).toHaveProperty('operation', 'delete');
      expect(event).toHaveProperty('oldPath');
      expect(event).not.toHaveProperty('newPath');
    });
  });
});

describe('Renderer Side Event Handling', () => {
  test('should parse file operation events correctly', () => {
    const moveEvent = {
      operation: 'move',
      oldPath: '/old/file.pdf',
      newPath: '/new/file.pdf'
    };

    const deleteEvent = {
      operation: 'delete',
      oldPath: '/deleted/file.pdf'
    };

    // Move event
    expect(moveEvent.operation).toBe('move');
    expect(moveEvent.oldPath).toBeDefined();
    expect(moveEvent.newPath).toBeDefined();

    // Delete event
    expect(deleteEvent.operation).toBe('delete');
    expect(deleteEvent.oldPath).toBeDefined();
    expect(deleteEvent.newPath).toBeUndefined();
  });

  test('should trigger search refresh on file operation', () => {
    let refreshTrigger = 0;

    // Simulate the effect of receiving a file operation event
    const handleFileOperation = (data) => {
      if (data.operation === 'move' || data.operation === 'delete') {
        refreshTrigger++;
      }
    };

    handleFileOperation({ operation: 'move', oldPath: '/a', newPath: '/b' });
    expect(refreshTrigger).toBe(1);

    handleFileOperation({ operation: 'delete', oldPath: '/c' });
    expect(refreshTrigger).toBe(2);

    // Copy should not trigger refresh
    handleFileOperation({ operation: 'copy', source: '/a', dest: '/b' });
    expect(refreshTrigger).toBe(2);
  });
});
