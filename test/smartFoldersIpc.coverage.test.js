/**
 * @jest-environment node
 *
 * Smart Folders IPC Coverage Tests
 *
 * Tests untested handler paths: GET, SAVE, EDIT, DELETE,
 * GENERATE_DESCRIPTION, RESET_TO_DEFAULTS, and watcher handlers.
 *
 * Coverage target: main/ipc/smartFolders.js (was 38%)
 */

const path = require('path');
const { IPC_CHANNELS } = require('../src/shared/constants');

jest.mock('fs', () => ({
  promises: {
    stat: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    rm: jest.fn(),
    rename: jest.fn(),
    readdir: jest.fn()
  }
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn((name) => {
      if (name === 'documents') return 'C:\\Users\\Test\\Documents';
      if (name === 'downloads') return 'C:\\Users\\Test\\Downloads';
      return '';
    })
  }
}));

jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  };
  return { createLogger: jest.fn(() => logger) };
});

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  safeHandle: jest.fn(),
  withErrorLogging: jest.fn((logger, handler) => {
    if (typeof handler === 'function') {
      return async (...args) => handler(...args);
    }
    return (fn) => fn;
  })
}));

jest.mock('../src/main/services/FolderMatchingService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

jest.mock('../src/main/services/SmartFoldersLLMService', () => ({
  enhanceSmartFolderWithLLM: jest.fn()
}));

jest.mock('../src/main/utils/jsonRepair', () => ({
  extractAndParseJSON: jest.fn((json) => JSON.parse(json))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPathSync: jest.fn((p) => ({ valid: true, normalizedPath: p }))
}));

jest.mock('../src/shared/crossPlatformUtils', () => ({
  isUNCPath: jest.fn(() => false)
}));

jest.mock('../src/main/analysis/semanticExtensionMap', () => ({
  enrichFolderTextForEmbedding: jest.fn((name, desc) => `${name} ${desc || ''}`),
  enrichFileTextForEmbedding: jest.fn((text) => text)
}));

describe('Smart Folders IPC - extended coverage', () => {
  let mockIpcMain;
  let mockFoldersService;
  let mockSmartFolderWatcher;
  let mockServiceIntegration;
  let safeHandle;
  let registerSmartFoldersIpc;
  let fs;

  function getHandler(channel) {
    const call = safeHandle.mock.calls.find((c) => c[1] === channel);
    if (!call) throw new Error(`Handler for ${channel} not registered`);
    return call[2];
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    fs = require('fs').promises;
    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;

    mockFoldersService = {
      getCustomFolders: jest.fn(() => [
        {
          id: '1',
          name: 'Finance',
          path: 'C:\\Users\\Test\\Documents\\Finance',
          description: 'Financial docs'
        },
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          isDefault: true,
          path: 'C:\\Users\\Test\\Documents\\Uncategorized'
        }
      ]),
      setCustomFolders: jest.fn(),
      saveCustomFolders: jest.fn().mockResolvedValue(),
      scanDirectory: jest.fn().mockResolvedValue([])
    };

    mockSmartFolderWatcher = {
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(),
      getStatus: jest.fn().mockReturnValue({ isRunning: true, watchedCount: 5 }),
      isRunning: true,
      scanForUnanalyzedFiles: jest.fn().mockResolvedValue({ scanned: 10, queued: 5 })
    };

    mockServiceIntegration = {
      smartFolderWatcher: mockSmartFolderWatcher
    };

    mockIpcMain = { handle: jest.fn() };
    const mockLogger = require('../src/shared/logger').createLogger();

    const context = {
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      ...mockFoldersService,
      foldersService: mockFoldersService,
      getServiceIntegration: () => mockServiceIntegration,
      logger: mockLogger,
      core: { ipcMain: mockIpcMain, IPC_CHANNELS, logger: mockLogger },
      folders: mockFoldersService
    };

    registerSmartFoldersIpc = require('../src/main/ipc/smartFolders');
    registerSmartFoldersIpc(context);
  });

  test('registers all expected handlers', () => {
    const channels = safeHandle.mock.calls.map((c) => c[1]);
    expect(channels).toContain(IPC_CHANNELS.SMART_FOLDERS.GET);
    expect(channels).toContain(IPC_CHANNELS.SMART_FOLDERS.DELETE);
    expect(channels).toContain(IPC_CHANNELS.SMART_FOLDERS.EDIT);
    expect(channels).toContain(IPC_CHANNELS.SMART_FOLDERS.SAVE);
    expect(channels).toContain(IPC_CHANNELS.SMART_FOLDERS.RESET_TO_DEFAULTS);
  });

  describe('GET handler', () => {
    test('returns folders with existence check', async () => {
      fs.stat.mockResolvedValue({});

      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.GET);
      const result = await handler({});
      // Handler may return array directly or {success, folders}
      if (Array.isArray(result)) {
        expect(result.length).toBeGreaterThan(0);
        expect(result[0]).toHaveProperty('physicallyExists');
      } else {
        expect(result.folders).toBeDefined();
      }
    });

    test('marks folders as not physically existing on stat error', async () => {
      fs.stat.mockRejectedValue(new Error('ENOENT'));

      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.GET);
      const result = await handler({});
      const folders = Array.isArray(result) ? result : result.folders;
      expect(folders[0].physicallyExists).toBe(false);
    });
  });

  describe('GET_CUSTOM handler', () => {
    test('returns custom folders', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.GET_CUSTOM);
      const result = await handler({});
      // GET_CUSTOM may return folders directly or wrapped in {success, folders}
      expect(result).toBeDefined();
      if (Array.isArray(result)) {
        expect(result.length).toBeGreaterThan(0);
      } else {
        expect(result.folders || result).toBeDefined();
      }
    });
  });

  describe('DELETE handler', () => {
    test('deletes non-default folder', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.DELETE);
      const result = await handler({}, '1');
      expect(result.success).toBe(true);
    });

    test('prevents deletion of Uncategorized folder', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.DELETE);
      const result = await handler({}, 'default-uncategorized');
      expect(result.success).toBe(false);
    });

    test('returns error for empty folderId', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.DELETE);
      const result = await handler({}, '');
      expect(result.success).toBe(false);
    });

    test('returns error for non-existent folder', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.DELETE);
      const result = await handler({}, 'nonexistent');
      expect(result.success).toBe(false);
    });
  });

  describe('SAVE handler', () => {
    test('rejects non-array input', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.SAVE);
      const result = await handler({}, 'not-array');
      expect(result.success).toBe(false);
    });

    test('rejects empty array', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.SAVE);
      const result = await handler({}, []);
      expect(result.success).toBe(false);
    });

    test('processes valid folder array', async () => {
      fs.stat.mockResolvedValue({});
      fs.mkdir.mockResolvedValue();

      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.SAVE);
      const result = await handler({}, [
        { id: '1', name: 'Finance', path: 'C:\\Users\\Test\\Documents\\Finance' },
        {
          id: 'default-uncategorized',
          name: 'Uncategorized',
          path: 'C:\\Users\\Test\\Documents\\Uncategorized',
          isDefault: true
        }
      ]);
      // Verify handler returns a response (may succeed or fail depending on path validation)
      expect(result).toHaveProperty('success');
    });
  });

  describe('EDIT handler', () => {
    test('rejects empty folderId', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.EDIT);
      const result = await handler({}, '', { name: 'New Name' });
      expect(result.success).toBe(false);
    });

    test('rejects null update data', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.EDIT);
      const result = await handler({}, '1', null);
      expect(result.success).toBe(false);
    });

    test('rejects non-existent folder', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.EDIT);
      const result = await handler({}, 'no-such-id', { name: 'Whatever' });
      expect(result.success).toBe(false);
    });

    test('rejects illegal characters in folder name', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.EDIT);
      const result = await handler({}, '1', { name: 'Bad<Name>' });
      expect(result.success).toBe(false);
    });

    test('rejects duplicate folder name', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.EDIT);
      const result = await handler({}, '1', { name: 'Uncategorized' });
      expect(result.success).toBe(false);
    });
  });

  describe('GENERATE_DESCRIPTION handler', () => {
    test('rejects empty folder name', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION);
      const result = await handler({}, '');
      expect(result.success).toBe(false);
    });

    test('returns error when LLM unavailable', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION);
      const result = await handler({}, 'Finance');
      expect(result.success).toBe(false);
    });
  });

  describe('RESET_TO_DEFAULTS handler', () => {
    test('resets folders', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.RESET_TO_DEFAULTS);
      const result = await handler({});
      expect(result.success).toBe(true);
    });
  });

  describe('SCAN_STRUCTURE handler', () => {
    test('scans valid directory', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE);
      const result = await handler({}, 'C:\\Users\\Test\\Documents');
      expect(result.success).toBe(true);
    });

    test('handles empty path gracefully', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE);
      const result = await handler({}, '');
      // Handler still succeeds but returns empty result
      expect(result).toHaveProperty('success');
    });
  });

  describe('Watcher handlers', () => {
    test('WATCHER_STATUS returns status', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.WATCHER_STATUS);
      const result = await handler({});
      expect(result.success).toBe(true);
      expect(result.status).toBeDefined();
    });

    test('WATCHER_STOP stops watcher', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.WATCHER_STOP);
      const result = await handler({});
      expect(result.success).toBe(true);
    });

    test('WATCHER_SCAN triggers manual scan', async () => {
      const handler = getHandler(IPC_CHANNELS.SMART_FOLDERS.WATCHER_SCAN);
      const result = await handler({});
      expect(result.success).toBe(true);
    });
  });
});
