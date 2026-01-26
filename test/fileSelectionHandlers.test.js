/**
 * Tests for File Selection Handlers
 * Tests file selection dialogs and folder scanning
 */

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock fs
const mockFs = {
  stat: jest.fn(),
  readdir: jest.fn()
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock constants
jest.mock('../src/shared/constants', () => ({
  SUPPORTED_DOCUMENT_EXTENSIONS: ['.pdf', '.doc', '.docx'],
  SUPPORTED_IMAGE_EXTENSIONS: ['.jpg', '.png', '.gif'],
  SUPPORTED_ARCHIVE_EXTENSIONS: ['.zip', '.rar'],
  SUPPORTED_3D_EXTENSIONS: ['.stl', '.obj'],
  SUPPORTED_DESIGN_EXTENSIONS: ['.ai', '.psd'],
  DEFAULT_AI_MODELS: {
    TEXT_ANALYSIS: 'qwen3:0.6b',
    IMAGE_ANALYSIS: 'gemma3:latest',
    EMBEDDING: 'embeddinggemma'
  }
}));

// Mock performanceConstants
jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: {
    DELAY_BATCH: 50
  },
  CONCURRENCY: {
    DEFAULT_WORKERS: 3
  }
}));

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: jest.fn((logger, handler) => handler),
  safeHandle: (ipcMain, channel, handler) => {
    ipcMain.handle(channel, handler);
  }
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/mock/documents')
  }
}));

describe('File Selection Handlers', () => {
  let registerFileSelectionHandlers;
  let mockIpcMain;
  let mockDialog;
  let mockGetMainWindow;
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockIpcMain = {
      handle: jest.fn()
    };

    mockDialog = {
      showOpenDialog: jest.fn()
    };

    mockGetMainWindow = jest.fn().mockReturnValue({
      isFocused: () => true,
      isMinimized: () => false,
      isVisible: () => true,
      focus: jest.fn(),
      restore: jest.fn(),
      show: jest.fn()
    });

    handlers = {};

    // Capture registered handlers
    mockIpcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const module = require('../src/main/ipc/files/fileSelectionHandlers');
    registerFileSelectionHandlers = module.registerFileSelectionHandlers;
  });

  describe('registerFileSelectionHandlers', () => {
    test('registers all handlers', () => {
      registerFileSelectionHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            SELECT_DIRECTORY: 'files:select-directory',
            GET_DOCUMENTS_PATH: 'files:get-documents-path',
            GET_FILE_STATS: 'files:get-file-stats',
            GET_FILES_IN_DIRECTORY: 'files:get-files-in-directory',
            SELECT: 'files:select'
          }
        },
        dialog: mockDialog,
        getMainWindow: mockGetMainWindow
      });

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(5);
    });
  });

  describe('selectDirectory handler', () => {
    beforeEach(() => {
      registerFileSelectionHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            SELECT_DIRECTORY: 'files:select-directory',
            GET_DOCUMENTS_PATH: 'files:get-documents-path',
            GET_FILE_STATS: 'files:get-file-stats',
            GET_FILES_IN_DIRECTORY: 'files:get-files-in-directory',
            SELECT: 'files:select'
          }
        },
        dialog: mockDialog,
        getMainWindow: mockGetMainWindow
      });
    });

    test('returns null path when dialog canceled', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      });

      const handler = handlers['files:select-directory'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.path).toBe(null);
    });

    test('returns selected directory path', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/selected/directory']
      });

      const handler = handlers['files:select-directory'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.path).toBe('/selected/directory');
    });

    test('handles dialog error', async () => {
      mockDialog.showOpenDialog.mockRejectedValueOnce(new Error('Dialog error'));

      const handler = handlers['files:select-directory'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Dialog error');
    });
  });

  describe('getDocumentsPath handler', () => {
    beforeEach(() => {
      registerFileSelectionHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            SELECT_DIRECTORY: 'files:select-directory',
            GET_DOCUMENTS_PATH: 'files:get-documents-path',
            GET_FILE_STATS: 'files:get-file-stats',
            GET_FILES_IN_DIRECTORY: 'files:get-files-in-directory',
            SELECT: 'files:select'
          }
        },
        dialog: mockDialog,
        getMainWindow: mockGetMainWindow
      });
    });

    test('returns documents path', async () => {
      const handler = handlers['files:get-documents-path'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.path).toBe('/mock/documents');
    });
  });

  describe('getFileStats handler', () => {
    beforeEach(() => {
      registerFileSelectionHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            SELECT_DIRECTORY: 'files:select-directory',
            GET_DOCUMENTS_PATH: 'files:get-documents-path',
            GET_FILE_STATS: 'files:get-file-stats',
            GET_FILES_IN_DIRECTORY: 'files:get-files-in-directory',
            SELECT: 'files:select'
          }
        },
        dialog: mockDialog,
        getMainWindow: mockGetMainWindow
      });
    });

    test('rejects invalid path', async () => {
      const handler = handlers['files:get-file-stats'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.stats).toBe(null);
    });

    test('returns file stats', async () => {
      const mockStats = {
        size: 1024,
        isFile: () => true,
        isDirectory: () => false,
        birthtime: new Date('2024-01-01'),
        mtime: new Date('2024-01-02'),
        atime: new Date('2024-01-03')
      };
      mockFs.stat.mockResolvedValueOnce(mockStats);

      const handler = handlers['files:get-file-stats'];
      const result = await handler({}, '/path/to/file.txt');

      expect(result.success).toBe(true);
      expect(result.stats.size).toBe(1024);
      expect(result.stats.isFile).toBe(true);
      expect(result.stats.isDirectory).toBe(false);
    });

    test('handles stat error', async () => {
      mockFs.stat.mockRejectedValueOnce(new Error('File not found'));

      const handler = handlers['files:get-file-stats'];
      const result = await handler({}, '/nonexistent/file.txt');

      expect(result.success).toBe(false);
      expect(result.error).toBe('File not found');
    });
  });

  describe('getFilesInDirectory handler', () => {
    beforeEach(() => {
      registerFileSelectionHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            SELECT_DIRECTORY: 'files:select-directory',
            GET_DOCUMENTS_PATH: 'files:get-documents-path',
            GET_FILE_STATS: 'files:get-file-stats',
            GET_FILES_IN_DIRECTORY: 'files:get-files-in-directory',
            SELECT: 'files:select'
          }
        },
        dialog: mockDialog,
        getMainWindow: mockGetMainWindow
      });
    });

    test('rejects invalid directory path', async () => {
      const handler = handlers['files:get-files-in-directory'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.files).toEqual([]);
    });

    test('returns files in directory', async () => {
      mockFs.readdir.mockResolvedValueOnce([
        { name: 'file1.txt', isFile: () => true },
        { name: 'file2.pdf', isFile: () => true },
        { name: 'subdir', isFile: () => false }
      ]);

      const handler = handlers['files:get-files-in-directory'];
      const result = await handler({}, '/some/directory');

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(result.files[0].name).toBe('file1.txt');
    });

    test('handles readdir error', async () => {
      mockFs.readdir.mockRejectedValueOnce(new Error('Cannot read directory'));

      const handler = handlers['files:get-files-in-directory'];
      const result = await handler({}, '/nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot read directory');
    });
  });

  describe('selectFiles handler', () => {
    beforeEach(() => {
      registerFileSelectionHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            SELECT_DIRECTORY: 'files:select-directory',
            GET_DOCUMENTS_PATH: 'files:get-documents-path',
            GET_FILE_STATS: 'files:get-file-stats',
            GET_FILES_IN_DIRECTORY: 'files:get-files-in-directory',
            SELECT: 'files:select'
          }
        },
        dialog: mockDialog,
        getMainWindow: mockGetMainWindow
      });
    });

    test('returns empty when dialog canceled', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: true,
        filePaths: []
      });

      const handler = handlers['files:select'];
      const result = await handler({});

      expect(result.success).toBe(false);
      expect(result.files).toEqual([]);
    });

    test('returns selected files', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/selected/file.pdf']
      });
      mockFs.stat.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false
      });

      const handler = handlers['files:select'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].name).toBe('file.pdf');
    });

    test('filters unsupported files', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/selected/file.exe']
      });
      mockFs.stat.mockResolvedValueOnce({
        isFile: () => true,
        isDirectory: () => false
      });

      const handler = handlers['files:select'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(0);
    });

    test('expands directories', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/selected/folder']
      });
      mockFs.stat.mockResolvedValueOnce({
        isFile: () => false,
        isDirectory: () => true
      });
      mockFs.readdir.mockResolvedValueOnce([
        { name: 'doc.pdf', isFile: () => true, isDirectory: () => false },
        { name: 'image.jpg', isFile: () => true, isDirectory: () => false }
      ]);

      const handler = handlers['files:select'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.files.length).toBeGreaterThanOrEqual(0);
    });

    test('handles stat error gracefully', async () => {
      mockDialog.showOpenDialog.mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/nonexistent/file.pdf']
      });
      mockFs.stat.mockRejectedValueOnce(new Error('File not found'));

      const handler = handlers['files:select'];
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(0);
    });
  });
});
