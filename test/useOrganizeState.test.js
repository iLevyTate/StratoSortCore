/**
 * Tests for useOrganizeState Hook
 * Tests Redux state management for OrganizePhase
 */

import { renderHook, act } from '@testing-library/react';

// Mock dependencies
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock store hooks
jest.mock('../src/renderer/store/hooks', () => ({
  useAppSelector: jest.fn(),
  useAppDispatch: jest.fn(() => jest.fn()),
}));

// Mock slices
jest.mock('../src/renderer/store/slices/filesSlice', () => ({
  setSmartFolders: jest.fn((payload) => ({
    type: 'files/setSmartFolders',
    payload,
  })),
  setOrganizedFiles: jest.fn((payload) => ({
    type: 'files/setOrganizedFiles',
    payload,
  })),
  setFileStates: jest.fn((payload) => ({
    type: 'files/setFileStates',
    payload,
  })),
}));

jest.mock('../src/renderer/store/selectors', () => ({
  selectFilesWithAnalysis: jest.fn(
    (state) => state?.files?.selectedFiles || [],
  ),
  selectFileStats: jest.fn(() => ({ total: 0, ready: 0, failed: 0 })),
}));

jest.mock('../src/renderer/store/slices/uiSlice', () => ({
  setPhase: jest.fn((payload) => ({ type: 'ui/setPhase', payload })),
  setOrganizing: jest.fn((payload) => ({ type: 'ui/setOrganizing', payload })),
}));

jest.mock('../src/renderer/store/slices/systemSlice', () => ({
  fetchDocumentsPath: jest.fn(() => ({ type: 'system/fetchDocumentsPath' })),
}));

// Mock electronAPI
const mockElectronAPI = {
  smartFolders: {
    get: jest.fn().mockResolvedValue([]),
  },
};

describe('useOrganizeState', () => {
  let useOrganizeState;
  let mockDispatch;
  let mockUseAppSelector;
  let mockUseAppDispatch;

  const defaultState = {
    files: {
      organizedFiles: [],
      selectedFiles: [
        { path: '/test.txt', analysis: { category: 'documents' } },
      ],
      smartFolders: [{ name: 'Documents', path: '/Documents' }],
      fileStates: { '/test.txt': { state: 'ready' } },
    },
    analysis: {
      results: [{ path: '/test.txt', analysis: { category: 'documents' } }],
    },
    system: {
      documentsPath: '/home/user/Documents',
    },
    ui: {
      phase: 'organize',
    },
  };

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    jest.clearAllMocks();

    // Set up window.electronAPI fresh each test (test-setup.js may overwrite global.window)
    global.window = global.window || {};
    global.window.electronAPI = mockElectronAPI;

    mockDispatch = jest.fn();
    mockUseAppDispatch = require('../src/renderer/store/hooks').useAppDispatch;
    mockUseAppSelector = require('../src/renderer/store/hooks').useAppSelector;

    mockUseAppDispatch.mockReturnValue(mockDispatch);
    mockUseAppSelector.mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector(defaultState);
      }
      return selector;
    });

    const module = require('../src/renderer/phases/organize/useOrganizeState');
    useOrganizeState = module.useOrganizeState;
  });

  describe('state selectors', () => {
    test('returns organizedFiles from state', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.organizedFiles).toEqual([]);
    });

    test('returns smartFolders from state', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.smartFolders).toEqual(
        defaultState.files.smartFolders,
      );
    });

    test('returns analysisResults from state', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.analysisResults).toEqual(
        defaultState.analysis.results,
      );
    });

    test('returns fileStates from state', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.fileStates).toEqual(defaultState.files.fileStates);
    });

    test('returns documentsPath from state', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.documentsPath).toBe('/home/user/Documents');
    });

    test('returns defaultLocation based on documentsPath', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.defaultLocation).toBe('/home/user/Documents');
    });

    test('returns "Documents" as defaultLocation when documentsPath is null', () => {
      mockUseAppSelector.mockImplementation((selector) => {
        const stateWithoutPath = {
          ...defaultState,
          system: { documentsPath: null },
        };
        return selector(stateWithoutPath);
      });

      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.defaultLocation).toBe('Documents');
    });
  });

  describe('action dispatchers', () => {
    test('setOrganizedFiles dispatches action', () => {
      const { result } = renderHook(() => useOrganizeState());
      const newFiles = [{ path: '/organized.txt' }];

      act(() => {
        result.current.setOrganizedFiles(newFiles);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setSmartFolders dispatches action', () => {
      const { result } = renderHook(() => useOrganizeState());
      const newFolders = [{ name: 'Projects', path: '/Projects' }];

      act(() => {
        result.current.setSmartFolders(newFolders);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setFileStates dispatches action with object', () => {
      const { result } = renderHook(() => useOrganizeState());
      const newStates = { '/test.txt': { state: 'organizing' } };

      act(() => {
        result.current.setFileStates(newStates);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setFileStates handles function updater', () => {
      const { result } = renderHook(() => useOrganizeState());

      act(() => {
        result.current.setFileStates((prev) => ({
          ...prev,
          '/new.txt': { state: 'pending' },
        }));
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('setOrganizingState dispatches action', () => {
      const { result } = renderHook(() => useOrganizeState());

      act(() => {
        result.current.setOrganizingState(true);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('advancePhase dispatches setPhase action', () => {
      const { result } = renderHook(() => useOrganizeState());

      act(() => {
        result.current.advancePhase('complete');
      });

      expect(mockDispatch).toHaveBeenCalled();
    });
  });

  describe('phaseData compatibility', () => {
    test('returns phaseData object with all required properties', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.phaseData).toHaveProperty('analysisResults');
      expect(result.current.phaseData).toHaveProperty('smartFolders');
      expect(result.current.phaseData).toHaveProperty('organizedFiles');
      expect(result.current.phaseData).toHaveProperty('fileStates');
    });
  });

  describe('actions compatibility', () => {
    test('actions.setPhaseData handles smartFolders key', () => {
      const { result } = renderHook(() => useOrganizeState());

      act(() => {
        result.current.actions.setPhaseData('smartFolders', []);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('actions.setPhaseData handles organizedFiles key', () => {
      const { result } = renderHook(() => useOrganizeState());

      act(() => {
        result.current.actions.setPhaseData('organizedFiles', []);
      });

      expect(mockDispatch).toHaveBeenCalled();
    });

    test('actions.advancePhase dispatches setPhase', () => {
      const { result } = renderHook(() => useOrganizeState());

      act(() => {
        result.current.actions.advancePhase('complete');
      });

      expect(mockDispatch).toHaveBeenCalled();
    });
  });

  describe('refs', () => {
    test('returns smartFoldersRef', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.smartFoldersRef).toBeDefined();
      expect(result.current.smartFoldersRef.current).toEqual(
        defaultState.files.smartFolders,
      );
    });

    test('returns dispatchRef', () => {
      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.dispatchRef).toBeDefined();
      expect(result.current.dispatchRef.current).toBe(mockDispatch);
    });
  });

  describe('failedCount', () => {
    test('returns failed count from fileStats', () => {
      const selectFileStats =
        require('../src/renderer/store/selectors').selectFileStats;
      selectFileStats.mockReturnValue({ total: 10, ready: 8, failed: 2 });

      const { result } = renderHook(() => useOrganizeState());

      expect(result.current.failedCount).toBe(2);
    });
  });
});

describe('useLoadInitialData', () => {
  let useLoadInitialData;
  let mockAddNotification;
  let mockDispatch;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks React hooks context
    jest.clearAllMocks();

    mockAddNotification = jest.fn();
    mockDispatch = jest.fn();

    const mockUseAppSelector =
      require('../src/renderer/store/hooks').useAppSelector;
    mockUseAppSelector.mockReturnValue(null);

    useLoadInitialData =
      require('../src/renderer/phases/organize/useOrganizeState').useLoadInitialData;
  });

  test('loads smart folders if missing', async () => {
    const smartFoldersRef = { current: [] };
    const dispatchRef = { current: mockDispatch };

    window.electronAPI.smartFolders.get.mockResolvedValue([
      { name: 'Documents', path: '/Documents' },
    ]);

    renderHook(() =>
      useLoadInitialData({ smartFoldersRef, dispatchRef }, mockAddNotification),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(window.electronAPI.smartFolders.get).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalled();
    expect(mockAddNotification).toHaveBeenCalledWith(
      'Loaded 1 smart folder',
      'info',
    );
  });

  test('does not load if smart folders exist', async () => {
    const smartFoldersRef = {
      current: [{ name: 'Existing', path: '/Existing' }],
    };
    const dispatchRef = { current: mockDispatch };

    renderHook(() =>
      useLoadInitialData({ smartFoldersRef, dispatchRef }, mockAddNotification),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(window.electronAPI.smartFolders.get).not.toHaveBeenCalled();
  });

  test('handles load errors gracefully', async () => {
    const smartFoldersRef = { current: [] };
    const dispatchRef = { current: mockDispatch };

    window.electronAPI.smartFolders.get.mockRejectedValue(
      new Error('Load error'),
    );

    renderHook(() =>
      useLoadInitialData({ smartFoldersRef, dispatchRef }, mockAddNotification),
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Should not throw
    expect(mockAddNotification).not.toHaveBeenCalled();
  });
});
