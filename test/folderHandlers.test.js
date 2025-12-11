/**
 * Tests for Folder Handlers
 * Tests folder create, open, delete operations
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
  mkdir: jest.fn().mockResolvedValue(undefined),
  rmdir: jest.fn().mockResolvedValue(undefined),
  readdir: jest.fn().mockResolvedValue([])
};
jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock ipcWrappers
jest.mock('../src/main/ipc/ipcWrappers', () => ({
  withErrorLogging: jest.fn((logger, handler) => handler)
}));

describe('Folder Handlers', () => {
  let registerFolderHandlers;
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
      openPath: jest.fn().mockResolvedValue('')
    };

    handlers = {};

    // Capture registered handlers
    mockIpcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    const module = require('../src/main/ipc/files/folderHandlers');
    registerFolderHandlers = module.registerFolderHandlers;
  });

  describe('registerFolderHandlers', () => {
    test('registers all handlers', () => {
      registerFolderHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            CREATE_FOLDER_DIRECT: 'files:create-folder-direct',
            OPEN_FOLDER: 'files:open-folder',
            DELETE_FOLDER: 'files:delete-folder'
          }
        },
        shell: mockShell
      });

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(3);
    });
  });

  describe('createFolderDirect handler', () => {
    beforeEach(() => {
      registerFolderHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            CREATE_FOLDER_DIRECT: 'files:create-folder-direct',
            OPEN_FOLDER: 'files:open-folder',
            DELETE_FOLDER: 'files:delete-folder'
          }
        },
        shell: mockShell
      });
    });

    test('rejects null path', async () => {
      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    test('rejects non-string path', async () => {
      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, 123);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    test('returns success if folder already exists', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });

      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, '/existing/folder');

      expect(result.success).toBe(true);
      expect(result.alreadyExisted).toBe(true);
    });

    test('returns error if file exists at path', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, '/existing/file.txt');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FILE_EXISTS');
    });

    test('creates folder successfully', async () => {
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' });

      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, '/new/folder');

      expect(result.success).toBe(true);
      expect(result.alreadyExisted).toBe(false);
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringContaining('folder'), {
        recursive: true
      });
    });

    test('handles permission denied error', async () => {
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
      mockFs.mkdir.mockRejectedValueOnce({
        code: 'EACCES',
        message: 'Permission denied'
      });

      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, '/protected/folder');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('PERMISSION_DENIED');
    });

    test('handles no space error', async () => {
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
      mockFs.mkdir.mockRejectedValueOnce({
        code: 'ENOSPC',
        message: 'No space'
      });

      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, '/new/folder');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NO_SPACE');
    });

    test('handles name too long error', async () => {
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' });
      mockFs.mkdir.mockRejectedValueOnce({
        code: 'ENAMETOOLONG',
        message: 'Name too long'
      });

      const handler = handlers['files:create-folder-direct'];
      const result = await handler({}, '/very/long/path/name');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NAME_TOO_LONG');
    });
  });

  describe('openFolder handler', () => {
    beforeEach(() => {
      registerFolderHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            CREATE_FOLDER_DIRECT: 'files:create-folder-direct',
            OPEN_FOLDER: 'files:open-folder',
            DELETE_FOLDER: 'files:delete-folder'
          }
        },
        shell: mockShell
      });
    });

    test('rejects null path', async () => {
      const handler = handlers['files:open-folder'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    test('rejects if path is not a directory', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      const handler = handlers['files:open-folder'];
      const result = await handler({}, '/path/to/file.txt');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('NOT_A_DIRECTORY');
    });

    test('handles folder not found', async () => {
      mockFs.stat.mockRejectedValueOnce({
        code: 'ENOENT',
        message: 'Not found'
      });

      const handler = handlers['files:open-folder'];
      const result = await handler({}, '/nonexistent/folder');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('FOLDER_NOT_FOUND');
    });

    test('opens folder successfully', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });

      const handler = handlers['files:open-folder'];
      const result = await handler({}, '/existing/folder');

      expect(result.success).toBe(true);
      expect(mockShell.openPath).toHaveBeenCalled();
    });

    test('handles shell error', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockShell.openPath.mockRejectedValueOnce(new Error('Shell error'));

      const handler = handlers['files:open-folder'];
      const result = await handler({}, '/folder');

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('OPEN_FAILED');
    });
  });

  describe('deleteFolder handler', () => {
    beforeEach(() => {
      registerFolderHandlers({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: {
          FILES: {
            CREATE_FOLDER_DIRECT: 'files:create-folder-direct',
            OPEN_FOLDER: 'files:open-folder',
            DELETE_FOLDER: 'files:delete-folder'
          }
        },
        shell: mockShell
      });
    });

    test('rejects null path', async () => {
      const handler = handlers['files:delete-folder'];
      const result = await handler({}, null);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('INVALID_PATH');
    });

    test('rejects if path is not a directory', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => false });

      const handler = handlers['files:delete-folder'];
      const result = await handler({}, '/path/to/file.txt');

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_DIRECTORY');
    });

    test('returns success if folder already deleted', async () => {
      mockFs.stat.mockRejectedValueOnce({ code: 'ENOENT' });

      const handler = handlers['files:delete-folder'];
      const result = await handler({}, '/already/deleted');

      expect(result.success).toBe(true);
      expect(result.existed).toBe(false);
    });

    test('rejects non-empty folder', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockFs.readdir.mockResolvedValueOnce(['file1.txt', 'file2.txt']);

      const handler = handlers['files:delete-folder'];
      const result = await handler({}, '/non/empty/folder');

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_EMPTY');
      expect(result.itemCount).toBe(2);
    });

    test('deletes empty folder successfully', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockFs.readdir.mockResolvedValueOnce([]);

      const handler = handlers['files:delete-folder'];
      const result = await handler({}, '/empty/folder');

      expect(result.success).toBe(true);
      expect(mockFs.rmdir).toHaveBeenCalled();
    });

    test('handles permission denied error', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockFs.readdir.mockResolvedValueOnce([]);
      mockFs.rmdir.mockRejectedValueOnce({
        code: 'EACCES',
        message: 'Permission denied'
      });

      const handler = handlers['files:delete-folder'];
      const result = await handler({}, '/protected/folder');

      expect(result.success).toBe(false);
      expect(result.code).toBe('EACCES');
    });

    test('handles busy directory error', async () => {
      mockFs.stat.mockResolvedValueOnce({ isDirectory: () => true });
      mockFs.readdir.mockResolvedValueOnce([]);
      mockFs.rmdir.mockRejectedValueOnce({
        code: 'EBUSY',
        message: 'Directory busy'
      });

      const handler = handlers['files:delete-folder'];
      const result = await handler({}, '/busy/folder');

      expect(result.success).toBe(false);
      expect(result.code).toBe('EBUSY');
    });
  });
});
