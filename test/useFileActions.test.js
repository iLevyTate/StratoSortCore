/**
 * Tests for useFileActions Hook
 * Tests file action operations (open, reveal, delete)
 */

import { renderHook, act } from '@testing-library/react';

// Mock dependencies
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock window.electronAPI
const mockElectronAPI = {
  files: {
    open: jest.fn(),
    reveal: jest.fn(),
    delete: jest.fn(),
    getStats: jest.fn()
  }
};

describe('useFileActions', () => {
  let useFileActions;
  let mockSetAnalysisResults;
  let mockSetSelectedFiles;
  let mockSetFileStates;
  let mockAddNotification;
  let mockShowConfirm;

  const createMockOptions = (overrides = {}) => ({
    setAnalysisResults: mockSetAnalysisResults,
    setSelectedFiles: mockSetSelectedFiles,
    setFileStates: mockSetFileStates,
    addNotification: mockAddNotification,
    showConfirm: mockShowConfirm,
    phaseData: {
      organizedFiles: []
    },
    ...overrides
  });

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    jest.clearAllMocks();

    // Set up window.electronAPI fresh each test (test-setup.js may overwrite global.window)
    global.window = global.window || {};
    global.window.electronAPI = mockElectronAPI;

    mockSetAnalysisResults = jest.fn();
    mockSetSelectedFiles = jest.fn();
    mockSetFileStates = jest.fn();
    mockAddNotification = jest.fn();
    mockShowConfirm = jest.fn();

    mockElectronAPI.files.open.mockResolvedValue({ success: true });
    mockElectronAPI.files.reveal.mockResolvedValue({ success: true });
    mockElectronAPI.files.delete.mockResolvedValue({ success: true });
    mockElectronAPI.files.getStats.mockResolvedValue({ exists: true });

    useFileActions = require('../src/renderer/phases/discover/useFileActions').useFileActions;
  });

  describe('initialization', () => {
    test('returns handleFileAction function', () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      expect(typeof result.current.handleFileAction).toBe('function');
    });
  });

  describe('open action', () => {
    test('opens file and shows success notification', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('open', '/path/to/file.txt');
      });

      expect(mockElectronAPI.files.open).toHaveBeenCalledWith('/path/to/file.txt');
      expect(mockAddNotification).toHaveBeenCalledWith(
        'Opened: file.txt',
        'success',
        2000,
        'file-actions'
      );
    });

    test('handles open errors', async () => {
      mockElectronAPI.files.open.mockRejectedValue(new Error('Cannot open file'));

      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('open', '/path/to/file.txt');
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Action failed: Cannot open file',
        'error',
        4000,
        'file-actions'
      );
    });
  });

  describe('reveal action', () => {
    test('reveals file in folder', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('reveal', '/path/to/file.txt');
      });

      expect(mockElectronAPI.files.reveal).toHaveBeenCalledWith('/path/to/file.txt');
      expect(mockAddNotification).toHaveBeenCalledWith(
        'Revealed: file.txt',
        'success',
        2000,
        'file-actions'
      );
    });

    test('uses original path when file not found at current path', async () => {
      mockElectronAPI.files.getStats.mockResolvedValueOnce({ exists: false });
      mockElectronAPI.files.getStats.mockResolvedValueOnce({ exists: true });

      const { result } = renderHook(() =>
        useFileActions(
          createMockOptions({
            phaseData: {
              organizedFiles: [
                {
                  path: '/new/path/file.txt',
                  originalPath: '/original/path/file.txt'
                }
              ]
            }
          })
        )
      );

      await act(async () => {
        await result.current.handleFileAction('reveal', '/new/path/file.txt');
      });

      expect(mockElectronAPI.files.reveal).toHaveBeenCalledWith('/original/path/file.txt');
    });

    test('handles reveal errors', async () => {
      mockElectronAPI.files.reveal.mockRejectedValue(new Error('Cannot reveal'));

      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('reveal', '/path/to/file.txt');
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Action failed: Cannot reveal',
        'error',
        4000,
        'file-actions'
      );
    });
  });

  describe('remove action', () => {
    test('removes file from queue without deleting', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('remove', '/path/to/file.txt');
      });

      expect(mockSetAnalysisResults).toHaveBeenCalled();
      expect(mockSetSelectedFiles).toHaveBeenCalled();
      expect(mockSetFileStates).toHaveBeenCalled();
      expect(mockAddNotification).toHaveBeenCalledWith(
        'Removed from queue: file.txt',
        'info',
        2000,
        'file-actions'
      );
    });

    test('filters out file from analysis results', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('remove', '/path/to/file.txt');
      });

      const filterFn = mockSetAnalysisResults.mock.calls[0][0];
      const prev = [{ path: '/path/to/file.txt' }, { path: '/path/to/other.txt' }];
      expect(filterFn(prev)).toEqual([{ path: '/path/to/other.txt' }]);
    });

    test('removes file state entry', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('remove', '/path/to/file.txt');
      });

      const updateFn = mockSetFileStates.mock.calls[0][0];
      const prev = {
        '/path/to/file.txt': { state: 'ready' },
        '/path/to/other.txt': { state: 'pending' }
      };
      const next = updateFn(prev);
      expect(next['/path/to/file.txt']).toBeUndefined();
      expect(next['/path/to/other.txt']).toEqual({ state: 'pending' });
    });
  });

  describe('delete action', () => {
    test('shows confirmation dialog before delete', async () => {
      mockShowConfirm.mockResolvedValue(false);

      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('delete', '/path/to/file.txt');
      });

      expect(mockShowConfirm).toHaveBeenCalledWith({
        title: 'Delete File',
        message: expect.stringContaining('cannot be undone'),
        confirmText: 'Delete',
        cancelText: 'Cancel',
        variant: 'danger',
        fileName: 'file.txt'
      });
    });

    test('does not delete when confirmation cancelled', async () => {
      mockShowConfirm.mockResolvedValue(false);

      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('delete', '/path/to/file.txt');
      });

      expect(mockElectronAPI.files.delete).not.toHaveBeenCalled();
    });

    test('deletes file when confirmed', async () => {
      mockShowConfirm.mockResolvedValue(true);
      mockElectronAPI.files.delete.mockResolvedValue({ success: true });

      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('delete', '/path/to/file.txt');
      });

      expect(mockElectronAPI.files.delete).toHaveBeenCalledWith('/path/to/file.txt');
      expect(mockSetAnalysisResults).toHaveBeenCalled();
      expect(mockSetSelectedFiles).toHaveBeenCalled();
      expect(mockSetFileStates).toHaveBeenCalled();
      expect(mockAddNotification).toHaveBeenCalledWith(
        'Deleted: file.txt',
        'success',
        3000,
        'file-actions'
      );
    });

    test('shows error when delete fails', async () => {
      mockShowConfirm.mockResolvedValue(true);
      mockElectronAPI.files.delete.mockResolvedValue({ success: false });

      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('delete', '/path/to/file.txt');
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Failed to delete: file.txt',
        'error',
        4000,
        'file-actions'
      );
    });
  });

  describe('unknown action', () => {
    test('shows error for unknown action', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('unknown', '/path/to/file.txt');
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Unknown action: unknown',
        'error',
        4000,
        'file-actions'
      );
    });
  });

  describe('file path handling', () => {
    test('extracts filename from forward slash path', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('open', '/unix/path/file.txt');
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Opened: file.txt',
        'success',
        2000,
        'file-actions'
      );
    });

    test('extracts filename from backslash path', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('open', 'C:\\Windows\\path\\file.txt');
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Opened: file.txt',
        'success',
        2000,
        'file-actions'
      );
    });
  });

  describe('setFileStates with null prev', () => {
    test('handles null previous state', async () => {
      const { result } = renderHook(() => useFileActions(createMockOptions()));

      await act(async () => {
        await result.current.handleFileAction('remove', '/path/to/file.txt');
      });

      const updateFn = mockSetFileStates.mock.calls[0][0];
      expect(updateFn(null)).toBe(null);
    });
  });
});
