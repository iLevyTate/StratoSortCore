/**
 * Tests for useOrganization Hook
 * Tests main organization logic for batch file operations
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
  PHASES: { DISCOVER: 'discover', ORGANIZE: 'organize', COMPLETE: 'complete' }
}));

jest.mock('../src/renderer/components/UndoRedoSystem', () => ({
  createOrganizeBatchAction: jest.fn((label, operations, callbacks) => ({
    type: 'organize-batch',
    label,
    operations,
    callbacks
  }))
}));

// Mock window.electronAPI
const mockElectronAPI = {
  organize: {
    auto: jest.fn()
  },
  events: {
    onOperationProgress: jest.fn()
  },
  files: {
    normalizePath: jest.fn((path) => path)
  }
};

describe('useOrganization', () => {
  let useOrganization;
  let useProgressTracking;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    jest.clearAllMocks();

    // Set up window.electronAPI fresh each test (test-setup.js may overwrite global.window)
    global.window = global.window || {};
    global.window.electronAPI = mockElectronAPI;

    mockElectronAPI.events.onOperationProgress.mockReturnValue(jest.fn());
    mockElectronAPI.organize.auto.mockResolvedValue({
      success: true,
      operations: [{ type: 'move', source: '/test.txt', destination: '/Documents/test.txt' }]
    });

    const module = require('../src/renderer/phases/organize/useOrganization');
    useOrganization = module.useOrganization;
    useProgressTracking = module.useProgressTracking;
  });

  describe('useProgressTracking', () => {
    test('initializes with empty progress', () => {
      const { result } = renderHook(() => useProgressTracking());

      expect(result.current.batchProgress).toEqual({
        current: 0,
        total: 0,
        currentFile: ''
      });
    });

    test('initializes with empty preview', () => {
      const { result } = renderHook(() => useProgressTracking());

      expect(result.current.organizePreview).toEqual([]);
    });

    test('initializes with isOrganizing false', () => {
      const { result } = renderHook(() => useProgressTracking());

      expect(result.current.isOrganizing).toBe(false);
    });

    test('setBatchProgress updates state', () => {
      const { result } = renderHook(() => useProgressTracking());

      act(() => {
        result.current.setBatchProgress({
          current: 5,
          total: 10,
          currentFile: 'test.txt'
        });
      });

      expect(result.current.batchProgress).toEqual({
        current: 5,
        total: 10,
        currentFile: 'test.txt'
      });
    });

    test('setOrganizePreview updates state', () => {
      const { result } = renderHook(() => useProgressTracking());

      act(() => {
        result.current.setOrganizePreview([
          { fileName: 'test.txt', destination: '/Documents/test.txt' }
        ]);
      });

      expect(result.current.organizePreview).toEqual([
        { fileName: 'test.txt', destination: '/Documents/test.txt' }
      ]);
    });

    test('setIsOrganizing updates state', () => {
      const { result } = renderHook(() => useProgressTracking());

      act(() => {
        result.current.setIsOrganizing(true);
      });

      expect(result.current.isOrganizing).toBe(true);
    });

    test('sets up progress listener on mount', () => {
      renderHook(() => useProgressTracking());

      expect(mockElectronAPI.events.onOperationProgress).toHaveBeenCalled();
    });

    test('handles missing progress event API gracefully', () => {
      const originalAPI = window.electronAPI.events;
      window.electronAPI.events = {};

      const { result } = renderHook(() => useProgressTracking());

      expect(result.current.batchProgress).toEqual({
        current: 0,
        total: 0,
        currentFile: ''
      });

      window.electronAPI.events = originalAPI;
    });
  });

  describe('useOrganization', () => {
    const createMockOptions = (overrides = {}) => ({
      unprocessedFiles: [
        {
          path: '/test.txt',
          name: 'test.txt',
          analysis: { category: 'documents', suggestedName: 'Test Document.txt' }
        }
      ],
      editingFiles: {},
      getFileWithEdits: jest.fn((file) => file),
      findSmartFolderForCategory: jest.fn(() => null),
      defaultLocation: '/Documents',
      smartFolders: [],
      analysisResults: [],
      markFilesAsProcessed: jest.fn(),
      unmarkFilesAsProcessed: jest.fn(),
      actions: {
        setPhaseData: jest.fn(),
        advancePhase: jest.fn()
      },
      phaseData: {
        organizedFiles: []
      },
      addNotification: jest.fn(),
      executeAction: jest.fn().mockResolvedValue({
        results: [{ success: true, source: '/test.txt', destination: '/Documents/test.txt' }]
      }),
      setOrganizedFiles: jest.fn(),
      setOrganizingState: jest.fn(),
      ...overrides
    });

    test('returns handleOrganizeFiles function', () => {
      const { result } = renderHook(() => useOrganization(createMockOptions()));

      expect(typeof result.current.handleOrganizeFiles).toBe('function');
    });

    test('returns isOrganizing state', () => {
      const { result } = renderHook(() => useOrganization(createMockOptions()));

      expect(result.current.isOrganizing).toBe(false);
    });

    test('returns batchProgress state', () => {
      const { result } = renderHook(() => useOrganization(createMockOptions()));

      expect(result.current.batchProgress).toEqual({
        current: 0,
        total: 0,
        currentFile: ''
      });
    });

    test('returns organizePreview state', () => {
      const { result } = renderHook(() => useOrganization(createMockOptions()));

      expect(result.current.organizePreview).toEqual([]);
    });

    describe('handleOrganizeFiles', () => {
      test('does nothing with no files to process', async () => {
        const options = createMockOptions({ unprocessedFiles: [] });
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.executeAction).not.toHaveBeenCalled();
      });

      test('uses auto-organize when available', async () => {
        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(mockElectronAPI.organize.auto).toHaveBeenCalled();
      });

      test('handles auto-organize failure', async () => {
        mockElectronAPI.organize.auto.mockResolvedValue({
          success: false,
          error: 'Service unavailable'
        });

        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.addNotification).toHaveBeenCalledWith(
          'Service unavailable',
          'error',
          5000,
          'organize-service-error'
        );
      });

      test('shows notification for files needing review', async () => {
        mockElectronAPI.organize.auto.mockResolvedValue({
          success: true,
          operations: [{ type: 'move', source: '/a.txt', destination: '/b.txt' }],
          needsReview: [{ path: '/review.txt' }]
        });

        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.addNotification).toHaveBeenCalledWith(
          expect.stringContaining('need manual review'),
          'info',
          4000,
          'organize-needs-review'
        );
      });

      test('shows notification for failed files', async () => {
        mockElectronAPI.organize.auto.mockResolvedValue({
          success: true,
          operations: [{ type: 'move', source: '/a.txt', destination: '/b.txt' }],
          failed: [{ path: '/failed.txt', error: 'Permission denied' }]
        });

        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.addNotification).toHaveBeenCalledWith(
          expect.stringContaining('could not be organized'),
          'warning',
          4000,
          'organize-failed-files'
        );
      });

      test('shows notification when no operations generated', async () => {
        mockElectronAPI.organize.auto.mockResolvedValue({
          success: true,
          operations: []
        });

        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.addNotification).toHaveBeenCalledWith(
          expect.stringContaining('No confident file moves'),
          'info',
          4000,
          'organize-no-operations'
        );
      });

      test('executes action with organize batch', async () => {
        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.executeAction).toHaveBeenCalled();
      });

      test('advances phase after successful organization', async () => {
        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.actions.advancePhase).toHaveBeenCalledWith('complete');
      });

      test('handles organization errors', async () => {
        mockElectronAPI.organize.auto.mockRejectedValue(new Error('Organization failed'));

        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.addNotification).toHaveBeenCalledWith(
          'Organization failed: Organization failed',
          'error'
        );
      });

      test('resets state in finally block', async () => {
        const options = createMockOptions();
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.setOrganizingState).toHaveBeenCalledWith(false);
        expect(result.current.isOrganizing).toBe(false);
      });

      test('accepts specific files to organize', async () => {
        const options = createMockOptions();
        const filesToOrganize = [
          { path: '/specific.txt', name: 'specific.txt', analysis: { category: 'test' } }
        ];

        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles(filesToOrganize);
        });

        expect(mockElectronAPI.organize.auto).toHaveBeenCalledWith(
          expect.objectContaining({
            files: filesToOrganize
          })
        );
      });
    });

    describe('fallback operations builder', () => {
      test('uses fallback when auto-organize is not available', async () => {
        delete mockElectronAPI.organize.auto;

        const options = createMockOptions({
          findSmartFolderForCategory: jest.fn(() => ({
            name: 'Documents',
            path: '/Documents'
          }))
        });

        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.executeAction).toHaveBeenCalled();

        // Restore
        mockElectronAPI.organize = { auto: jest.fn() };
      });
    });

    describe('state callbacks', () => {
      test('onExecute updates organized files', async () => {
        const options = createMockOptions();

        options.executeAction.mockImplementation(async (action) => {
          // Simulate calling the execute callback
          action.callbacks.onExecute({
            results: [{ success: true, source: '/test.txt', destination: '/Documents/test.txt' }]
          });
          return { results: [{ success: true }] };
        });

        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.setOrganizedFiles).toHaveBeenCalled();
        expect(options.markFilesAsProcessed).toHaveBeenCalled();
      });

      test('onUndo restores files to unprocessed', async () => {
        const options = createMockOptions();

        options.executeAction.mockImplementation(async (action) => {
          // Simulate calling the undo callback
          action.callbacks.onUndo({
            results: [{ success: true, originalPath: '/test.txt' }],
            successCount: 1,
            failCount: 0
          });
          return { results: [{ success: true }] };
        });

        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.unmarkFilesAsProcessed).toHaveBeenCalled();
      });

      test('onRedo re-organizes files', async () => {
        const options = createMockOptions();

        options.executeAction.mockImplementation(async (action) => {
          // Simulate calling the redo callback
          action.callbacks.onRedo({
            results: [{ success: true, source: '/test.txt', destination: '/Documents/test.txt' }],
            successCount: 1,
            failCount: 0
          });
          return { results: [{ success: true }] };
        });

        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(options.markFilesAsProcessed).toHaveBeenCalled();
      });
    });
  });
});
