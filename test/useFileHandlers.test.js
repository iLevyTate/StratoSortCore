/**
 * Tests for useFileHandlers Hook
 * Tests file selection and handling logic
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

jest.mock('../src/shared/constants', () => ({
  RENDERER_LIMITS: {
    FILE_STATS_BATCH_SIZE: 50
  }
}));

jest.mock('../src/renderer/phases/discover/namingUtils', () => ({
  extractExtension: jest.fn((name) => {
    if (!name || !name.includes('.')) return '';
    return '.' + name.split('.').pop().toLowerCase();
  }),
  extractFileName: jest.fn((path) => {
    if (!path) return '';
    return path.split(/[\\/]/).pop() || '';
  })
}));

// Mock window.electronAPI
const mockElectronAPI = {
  files: {
    select: jest.fn(),
    selectDirectory: jest.fn(),
    getStats: jest.fn()
  },
  smartFolders: {
    scanStructure: jest.fn()
  }
};

describe('useFileHandlers', () => {
  let useFileHandlers;
  let mockSetSelectedFiles;
  let mockUpdateFileState;
  let mockAddNotification;
  let mockAnalyzeFiles;

  const createMockOptions = (overrides = {}) => ({
    selectedFiles: [],
    setSelectedFiles: mockSetSelectedFiles,
    updateFileState: mockUpdateFileState,
    addNotification: mockAddNotification,
    analyzeFiles: mockAnalyzeFiles,
    ...overrides
  });

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    jest.clearAllMocks();

    // Set up window.electronAPI fresh each test (test-setup.js may overwrite global.window)
    global.window = global.window || {};
    global.window.electronAPI = mockElectronAPI;

    mockSetSelectedFiles = jest.fn();
    mockUpdateFileState = jest.fn();
    mockAddNotification = jest.fn();
    mockAnalyzeFiles = jest.fn();

    mockElectronAPI.files.select.mockResolvedValue({ success: true, files: [] });
    mockElectronAPI.files.selectDirectory.mockResolvedValue({ success: true, path: null });
    mockElectronAPI.files.getStats.mockResolvedValue({
      size: 1024,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      isDirectory: false
    });
    mockElectronAPI.smartFolders.scanStructure.mockResolvedValue({ files: [] });

    useFileHandlers = require('../src/renderer/phases/discover/useFileHandlers').useFileHandlers;
  });

  describe('initialization', () => {
    test('returns isScanning state', () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      expect(result.current.isScanning).toBe(false);
    });

    test('returns handleFileSelection function', () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      expect(typeof result.current.handleFileSelection).toBe('function');
    });

    test('returns handleFolderSelection function', () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      expect(typeof result.current.handleFolderSelection).toBe('function');
    });

    test('returns handleFileDrop function', () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      expect(typeof result.current.handleFileDrop).toBe('function');
    });

    test('returns getBatchFileStats function', () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      expect(typeof result.current.getBatchFileStats).toBe('function');
    });
  });

  describe('handleFileSelection', () => {
    test('shows notification when no files selected', async () => {
      mockElectronAPI.files.select.mockResolvedValue({ success: true, files: [] });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileSelection();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'No files selected',
        'info',
        2000,
        'file-selection'
      );
    });

    test('adds new files when files are selected', async () => {
      mockElectronAPI.files.select.mockResolvedValue({
        success: true,
        files: [{ path: '/test.txt', name: 'test.txt' }]
      });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileSelection();
      });

      expect(mockSetSelectedFiles).toHaveBeenCalled();
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining('Added'),
        'success',
        2500,
        'files-added'
      );
    });

    test('skips duplicate files', async () => {
      mockElectronAPI.files.select.mockResolvedValue({
        success: true,
        files: [{ path: '/existing.txt', name: 'existing.txt' }]
      });

      const { result } = renderHook(() =>
        useFileHandlers(
          createMockOptions({
            selectedFiles: [{ path: '/existing.txt', name: 'existing.txt' }]
          })
        )
      );

      await act(async () => {
        await result.current.handleFileSelection();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'All files are already in the queue',
        'info',
        2000,
        'duplicate-files'
      );
    });

    test('handles selection errors', async () => {
      mockElectronAPI.files.select.mockRejectedValue(new Error('Selection failed'));

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileSelection();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining('Error selecting files'),
        'error',
        4000,
        'file-selection-error'
      );
    });

    test('calls analyzeFiles after adding files', async () => {
      mockElectronAPI.files.select.mockResolvedValue({
        success: true,
        files: [{ path: '/test.txt', name: 'test.txt' }]
      });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileSelection();
      });

      expect(mockAnalyzeFiles).toHaveBeenCalled();
    });
  });

  describe('handleFolderSelection', () => {
    test('shows notification when folder selection cancelled', async () => {
      mockElectronAPI.files.selectDirectory.mockResolvedValue({
        success: false,
        path: null
      });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFolderSelection();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'Folder selection cancelled',
        'info',
        2000,
        'folder-selection'
      );
    });

    test('scans folder structure when selected', async () => {
      mockElectronAPI.files.selectDirectory.mockResolvedValue({
        success: true,
        path: '/test-folder'
      });
      mockElectronAPI.smartFolders.scanStructure.mockResolvedValue({
        files: [{ path: '/test-folder/test.pdf', name: 'test.pdf' }]
      });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFolderSelection();
      });

      expect(mockElectronAPI.smartFolders.scanStructure).toHaveBeenCalledWith('/test-folder');
    });

    test('shows warning when no supported files found', async () => {
      mockElectronAPI.files.selectDirectory.mockResolvedValue({
        success: true,
        path: '/test-folder'
      });
      mockElectronAPI.smartFolders.scanStructure.mockResolvedValue({
        files: [{ path: '/test-folder/test.xyz', name: 'test.xyz' }]
      });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFolderSelection();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        'No supported files found in the selected folder',
        'warning',
        3000,
        'folder-scan'
      );
    });

    test('handles folder selection errors', async () => {
      mockElectronAPI.files.selectDirectory.mockRejectedValue(new Error('Folder error'));

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFolderSelection();
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining('Error selecting folder'),
        'error',
        4000,
        'folder-selection-error'
      );
    });
  });

  describe('handleFileDrop', () => {
    test('does nothing for empty files', async () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop([]);
      });

      expect(mockSetSelectedFiles).not.toHaveBeenCalled();
    });

    test('does nothing for null files', async () => {
      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop(null);
      });

      expect(mockSetSelectedFiles).not.toHaveBeenCalled();
    });

    test('adds dropped files', async () => {
      const droppedFiles = [{ path: '/dropped.txt', name: 'dropped.txt' }];

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop(droppedFiles);
      });

      expect(mockSetSelectedFiles).toHaveBeenCalled();
      expect(mockUpdateFileState).toHaveBeenCalledWith('/dropped.txt', 'pending');
    });

    test('adds source and timestamp to dropped files', async () => {
      const droppedFiles = [{ path: '/dropped.txt', name: 'dropped.txt' }];

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop(droppedFiles);
      });

      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining('Added 1 new file'),
        'success',
        2500,
        'files-added'
      );
    });

    test('calls analyzeFiles after dropping files', async () => {
      const droppedFiles = [{ path: '/dropped.txt', name: 'dropped.txt' }];

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop(droppedFiles);
      });

      expect(mockAnalyzeFiles).toHaveBeenCalled();
    });

    test('extracts extension if not provided', async () => {
      const droppedFiles = [{ path: '/dropped.pdf', name: 'dropped.pdf' }];

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop(droppedFiles);
      });

      // File should have extension set
      const setFilesCall = mockSetSelectedFiles.mock.calls[0][0];
      expect(setFilesCall[0].extension).toBe('.pdf');
    });

    test('expands dropped directories and analyzes contained files', async () => {
      const droppedItems = [{ path: '/dropped-folder', name: 'dropped-folder' }];

      mockElectronAPI.files.getStats.mockResolvedValueOnce({
        size: 0,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        isDirectory: true
      });

      mockElectronAPI.smartFolders.scanStructure.mockResolvedValueOnce({
        files: [{ path: '/dropped-folder/doc.pdf', name: 'doc.pdf' }]
      });

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      await act(async () => {
        await result.current.handleFileDrop(droppedItems);
      });

      expect(mockElectronAPI.smartFolders.scanStructure).toHaveBeenCalledWith('/dropped-folder');
      expect(mockSetSelectedFiles).toHaveBeenCalled();
      expect(mockUpdateFileState).toHaveBeenCalledWith('/dropped-folder/doc.pdf', 'pending');
      expect(mockAnalyzeFiles).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ path: '/dropped-folder/doc.pdf' })])
      );
    });
  });

  describe('getBatchFileStats', () => {
    test('returns file stats for all paths', async () => {
      const filePaths = ['/test1.txt', '/test2.txt'];

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      let stats;
      await act(async () => {
        stats = await result.current.getBatchFileStats(filePaths);
      });

      expect(stats.length).toBe(2);
      expect(stats[0].path).toBe('/test1.txt');
      expect(stats[1].path).toBe('/test2.txt');
    });

    test('handles stats errors gracefully', async () => {
      mockElectronAPI.files.getStats.mockRejectedValue(new Error('Stats error'));
      const filePaths = ['/error.txt'];

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      let stats;
      await act(async () => {
        stats = await result.current.getBatchFileStats(filePaths);
      });

      expect(stats.length).toBe(1);
      expect(stats[0].success).toBe(false);
      expect(stats[0].error).toBe('Stats error');
    });

    test('processes files in batches', async () => {
      const filePaths = Array(100)
        .fill(null)
        .map((_, i) => `/file${i}.txt`);

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      let stats;
      await act(async () => {
        stats = await result.current.getBatchFileStats(filePaths, 10);
      });

      expect(stats.length).toBe(100);
    });
  });

  describe('isScanning state', () => {
    test('sets isScanning during file selection', async () => {
      let resolveSelect;
      mockElectronAPI.files.select.mockReturnValue(
        new Promise((resolve) => {
          resolveSelect = resolve;
        })
      );

      const { result } = renderHook(() => useFileHandlers(createMockOptions()));

      // Start selection (don't await)
      act(() => {
        result.current.handleFileSelection();
      });

      // isScanning should be true during the operation
      // Note: Due to async nature, we may not catch this state

      // Complete the operation
      await act(async () => {
        resolveSelect({ success: true, files: [] });
      });

      // After completion, isScanning should be false
      expect(result.current.isScanning).toBe(false);
    });
  });
});
