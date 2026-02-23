/**
 * @jest-environment jsdom
 */

const REDUX_STATE_KEY = 'stratosort_redux_state';
const LEGACY_STATE_KEY = 'stratosort_workflow_state';

function loadStoreWithStorage({ reduxState, legacyState } = {}) {
  jest.resetModules();

  const markStoreReadyMock = jest.fn();

  jest.doMock('../src/renderer/store/middleware/ipcMiddleware', () => ({
    __esModule: true,
    default: () => (next) => (action) => next(action),
    markStoreReady: markStoreReadyMock
  }));

  jest.doMock('../src/renderer/store/middleware/persistenceMiddleware', () => ({
    __esModule: true,
    default: () => (next) => (action) => next(action)
  }));

  const storage = {};
  if (reduxState !== undefined) {
    storage[REDUX_STATE_KEY] = reduxState;
  }
  if (legacyState !== undefined) {
    storage[LEGACY_STATE_KEY] = legacyState;
  }

  const localStorageMock = {
    getItem: jest.fn((key) =>
      Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null
    ),
    setItem: jest.fn((key, value) => {
      storage[key] = String(value);
    }),
    removeItem: jest.fn((key) => {
      delete storage[key];
    }),
    clear: jest.fn(() => {
      Object.keys(storage).forEach((key) => delete storage[key]);
    })
  };

  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true
  });
  Object.defineProperty(global, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true
  });

  delete window.__STRATOSORT_STATE_EXPIRED__;
  delete window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__;

  const storeModule = require('../src/renderer/store/index');
  const store = storeModule.default || storeModule;

  return { store, markStoreReadyMock };
}

describe('store bootstrap persistence recovery', () => {
  test('falls back to initial state when persisted JSON is corrupted', () => {
    const { store, markStoreReadyMock } = loadStoreWithStorage({
      reduxState: '{not-valid-json'
    });

    const state = store.getState();
    expect(state.ui.currentPhase).toBe('welcome');
    expect(Array.isArray(state.files.selectedFiles)).toBe(true);
    expect(markStoreReadyMock).toHaveBeenCalledTimes(1);
  });

  test('hydrates legacy workflow state when redux state is missing', () => {
    const legacyState = JSON.stringify({
      currentPhase: 'discover',
      phaseData: {
        selectedFiles: [{ path: 'C:/docs/a.pdf', created: '2025-01-01T00:00:00.000Z' }],
        organizedFiles: [{ path: 'C:/docs/organized.pdf' }],
        smartFolders: [{ id: 'sf-1', name: 'Invoices' }],
        analysisResults: [{ path: 'C:/docs/a.pdf', analysis: { category: 'finance' } }],
        fileStates: { 'C:/docs/a.pdf': { state: 'analyzed' } }
      }
    });

    const { store, markStoreReadyMock } = loadStoreWithStorage({
      legacyState
    });

    const state = store.getState();
    expect(state.ui.currentPhase).toBe('discover');
    expect(state.files.selectedFiles).toHaveLength(1);
    expect(state.files.smartFolders).toHaveLength(1);
    expect(state.analysis.results).toHaveLength(1);
    expect(markStoreReadyMock).toHaveBeenCalledTimes(1);
  });

  test('expires stale state but preserves durable smart folder data', () => {
    const staleTimestamp = Date.now() - 26 * 60 * 60 * 1000;
    const staleState = JSON.stringify({
      _version: 2,
      timestamp: staleTimestamp,
      ui: { currentPhase: 'organize' },
      files: {
        selectedFiles: [{ path: 'C:/docs/pending.pdf' }],
        organizedFiles: [{ path: 'C:/docs/already-organized.pdf' }],
        smartFolders: [{ id: 'sf-keep', name: 'Keep Me' }],
        fileStates: { 'C:/docs/pending.pdf': { state: 'pending' } }
      },
      analysis: {
        results: [{ path: 'C:/docs/pending.pdf', analysis: { category: 'misc' } }]
      },
      system: {
        documentsPath: 'C:/Users/test/Documents'
      }
    });

    const { store } = loadStoreWithStorage({ reduxState: staleState });
    const state = store.getState();

    expect(state.ui.currentPhase).toBe('welcome');
    expect(state.files.selectedFiles).toEqual([]);
    expect(state.files.smartFolders).toHaveLength(1);
    expect(state.files.organizedFiles).toHaveLength(1);
    expect(window.__STRATOSORT_STATE_EXPIRED__).toBe(true);
    expect(window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__).toBeGreaterThanOrEqual(25);
  });

  test('sanitizes malformed persisted slices instead of crashing', () => {
    const malformedState = JSON.stringify({
      _version: 2,
      timestamp: Date.now(),
      ui: { currentPhase: '__broken__' },
      files: {
        selectedFiles: 'oops',
        smartFolders: null,
        organizedFiles: {},
        fileStates: []
      },
      analysis: {
        results: { bad: true }
      },
      system: {
        notifications: 'not-an-array'
      }
    });

    const { store } = loadStoreWithStorage({ reduxState: malformedState });
    const state = store.getState();

    expect(state.ui.currentPhase).toBe('welcome');
    expect(Array.isArray(state.files.selectedFiles)).toBe(true);
    expect(Array.isArray(state.files.smartFolders)).toBe(true);
    expect(Array.isArray(state.files.organizedFiles)).toBe(true);
    expect(Array.isArray(state.analysis.results)).toBe(true);
    expect(Array.isArray(state.system.notifications)).toBe(true);
  });
});
