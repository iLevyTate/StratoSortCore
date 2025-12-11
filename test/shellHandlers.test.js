/**
 * Tests for Shell Handlers
 * Tests shell operations (open file, reveal in folder)
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

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: jest.fn((logger, handler) => handler)
}));

// Mock fs.promises for path validation
jest.mock('fs', () => ({
  promises: {
    access: jest.fn().mockResolvedValue(undefined),
    lstat: jest.fn().mockResolvedValue({ isSymbolicLink: () => false })
  }
}));

// Mock pathSanitization - allow paths through validation
jest.mock('../src/shared/pathSanitization', () => ({
  validateFileOperationPath: jest.fn().mockImplementation(async (filePath) => ({
    valid: true,
    normalizedPath: filePath
  })),
  sanitizePath: jest.fn((p) => p),
  isPathDangerous: jest.fn(() => false),
  checkSymlinkSafety: jest.fn().mockResolvedValue({ isSymlink: false, isSafe: true })
}));

describe('Shell Handlers', () => {
  let registerShellHandlers;
  let mockIpcMain;
  let mockShell;
  let handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    mockIpcMain = {
      handle: jest.fn()
    };

    mockShell = {
      openPath: jest.fn().mockResolvedValue(''),
      showItemInFolder: jest.fn()
    };

    handlers = {};

    // Capture registered handlers
    mockIpcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const module = require('../src/main/ipc/files/shellHandlers');
    registerShellHandlers = module.registerShellHandlers;
  });

  describe('registerShellHandlers', () => {
    test('registers all handlers', () => {
      registerShellHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            OPEN_FILE: 'files:open-file',
            REVEAL_FILE: 'files:reveal-file'
          }
        },
        shell: mockShell
      });

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(2);
    });
  });

  describe('openFile handler', () => {
    beforeEach(() => {
      registerShellHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            OPEN_FILE: 'files:open-file',
            REVEAL_FILE: 'files:reveal-file'
          }
        },
        shell: mockShell
      });
    });

    test('opens file successfully', async () => {
      const handler = handlers['files:open-file'];
      const result = await handler({}, '/path/to/file.pdf');

      expect(result.success).toBe(true);
      expect(mockShell.openPath).toHaveBeenCalledWith('/path/to/file.pdf');
    });

    test('handles open error', async () => {
      mockShell.openPath.mockRejectedValueOnce(new Error('Cannot open file'));

      const handler = handlers['files:open-file'];
      const result = await handler({}, '/path/to/file.pdf');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot open file');
    });

    test('handles different file types', async () => {
      const handler = handlers['files:open-file'];

      await handler({}, '/path/to/document.pdf');
      expect(mockShell.openPath).toHaveBeenCalledWith('/path/to/document.pdf');

      await handler({}, '/path/to/image.jpg');
      expect(mockShell.openPath).toHaveBeenCalledWith('/path/to/image.jpg');

      await handler({}, '/path/to/archive.zip');
      expect(mockShell.openPath).toHaveBeenCalledWith('/path/to/archive.zip');
    });
  });

  describe('revealFile handler', () => {
    beforeEach(() => {
      registerShellHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            OPEN_FILE: 'files:open-file',
            REVEAL_FILE: 'files:reveal-file'
          }
        },
        shell: mockShell
      });
    });

    test('reveals file in folder successfully', async () => {
      const handler = handlers['files:reveal-file'];
      const result = await handler({}, '/path/to/file.pdf');

      expect(result.success).toBe(true);
      expect(mockShell.showItemInFolder).toHaveBeenCalledWith('/path/to/file.pdf');
    });

    test('handles reveal error', async () => {
      mockShell.showItemInFolder.mockImplementationOnce(() => {
        throw new Error('Cannot reveal file');
      });

      const handler = handlers['files:reveal-file'];
      const result = await handler({}, '/path/to/file.pdf');

      expect(result.success).toBe(false);
      // Error message comes from shell operation failure
      expect(result.error).toBe('Cannot reveal file');
    });

    test('reveals files with special characters in path', async () => {
      const handler = handlers['files:reveal-file'];
      const result = await handler({}, '/path/to/file with spaces.pdf');

      expect(result.success).toBe(true);
      expect(mockShell.showItemInFolder).toHaveBeenCalledWith('/path/to/file with spaces.pdf');
    });
  });
});
