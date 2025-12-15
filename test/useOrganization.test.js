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
    normalizePath: jest.fn((path) => path) // Just return path as-is for testing join logic
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

      test('does not use auto-organize in OrganizePhase (uses UI category/name for deterministic moves)', async () => {
        // Even if auto-organize is available and would return a different destination,
        // OrganizePhase must honor the reviewed UI category/name.
        mockElectronAPI.organize.auto.mockResolvedValue({
          success: true,
          operations: [
            { type: 'move', source: '/test.txt', destination: '/Documents/3D Print/test.txt' }
          ]
        });

        const options = createMockOptions({
          unprocessedFiles: [
            {
              path: '/test.txt',
              name: 'test.txt',
              analysis: { category: 'How To', suggestedName: 'Test Document.txt' }
            }
          ],
          findSmartFolderForCategory: jest.fn((category) =>
            category === 'How To' ? { name: 'How To', path: '/Documents/How To' } : null
          )
        });
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        expect(mockElectronAPI.organize.auto).not.toHaveBeenCalled();
        expect(options.executeAction).toHaveBeenCalled();
      });

      test('does not depend on auto-organize failure handling in OrganizePhase', async () => {
        mockElectronAPI.organize.auto.mockResolvedValue({
          success: false,
          error: 'Service unavailable'
        });

        const options = createMockOptions({
          unprocessedFiles: [
            {
              path: '/test.txt',
              name: 'test.txt',
              analysis: { category: 'Documents', suggestedName: 'Test Document.txt' }
            }
          ],
          findSmartFolderForCategory: jest.fn((category) =>
            category === 'Documents' ? { name: 'Documents', path: '/Documents/Documents' } : null
          )
        });
        const { result } = renderHook(() => useOrganization(options));

        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        // No auto-organize call; executeAction is used instead
        expect(mockElectronAPI.organize.auto).not.toHaveBeenCalled();
        expect(options.executeAction).toHaveBeenCalled();
      });

      // NOTE: The following notifications were produced by the auto-organize pipeline:
      // - needsReview
      // - failed files
      // - no operations generated
      // OrganizePhase now builds deterministic operations locally from the UI category/name,
      // so these auto-organize-only notifications are intentionally not emitted here.

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
        const options = createMockOptions({
          findSmartFolderForCategory: jest.fn((category) =>
            category === 'documents' ? { name: 'documents', path: '/Documents/documents' } : null
          ),
          executeAction: jest.fn().mockRejectedValue(new Error('Organization failed'))
        });
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

        expect(mockElectronAPI.organize.auto).not.toHaveBeenCalled();
        expect(options.executeAction).toHaveBeenCalled();
      });

      test('joins paths with backslashes on Windows-like root', async () => {
        const options = createMockOptions({
          defaultLocation: 'C:\\Users\\User\\Documents',
          findSmartFolderForCategory: jest.fn(() => ({ name: 'SmartFolder', path: null })),
          unprocessedFiles: [
            {
              path: 'test.txt',
              name: 'test.txt',
              analysis: { category: 'SmartFolder', suggestedName: 'test.txt' }
            }
          ]
        });
        const { result } = renderHook(() => useOrganization(options));
        await act(async () => {
          await result.current.handleOrganizeFiles();
        });

        const call = options.executeAction.mock.calls[0][0];
        const dest = call.operations[0].destination;
        // Verify destination has backslashes and correct structure
        expect(dest).toContain('C:\\Users\\User\\Documents\\SmartFolder\\test.txt');
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

      test('onRedo filters out already organized files', async () => {
        const options = createMockOptions({
          phaseData: {
            organizedFiles: [
              {
                originalPath: '/test.txt',
                path: '/Documents/test.txt'
              }
            ]
          },
          setOrganizedFiles: jest.fn()
        });

        options.executeAction.mockImplementation(async (action) => {
          // Simulate redo with SAME file already in state
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

        // setOrganizedFiles should NOT be called because the file is already there
        // or effectively filtered out.
        // Wait, if no unique results, setOrganizedFiles is skipped?
        // Code: if (uniqueResults.length > 0) { ... }
        expect(options.setOrganizedFiles).not.toHaveBeenCalled();
      });
    });
  });
});
