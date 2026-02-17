/**
 * Focused tests for newly added UI processing/error reducers.
 */

jest.mock('../src/shared/constants', () => ({
  PHASES: {
    WELCOME: 'welcome',
    SETUP: 'setup',
    DISCOVER: 'discover',
    ORGANIZE: 'organize',
    COMPLETE: 'complete'
  },
  PHASE_TRANSITIONS: {
    welcome: ['setup', 'discover'],
    setup: ['welcome', 'discover'],
    discover: ['welcome', 'setup', 'organize'],
    organize: ['welcome', 'discover', 'complete'],
    complete: ['welcome', 'discover', 'organize']
  },
  PHASE_ORDER: ['welcome', 'setup', 'discover', 'organize', 'complete']
}));

jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

import uiReducer, {
  setDiscovering,
  setProcessing,
  setOperationError,
  clearOperationError,
  resetUi
} from '../src/renderer/store/slices/uiSlice';

describe('uiSlice processing and operation error reducers', () => {
  test('setDiscovering coerces payload to boolean', () => {
    const initial = uiReducer(undefined, { type: 'init' });
    const updated = uiReducer(initial, setDiscovering('truthy'));

    expect(updated.isDiscovering).toBe(true);
  });

  test('setProcessing toggles generic processing state', () => {
    const initial = uiReducer(undefined, { type: 'init' });
    const enabled = uiReducer(initial, setProcessing(true));
    const disabled = uiReducer(enabled, setProcessing(false));

    expect(enabled.isProcessing).toBe(true);
    expect(disabled.isProcessing).toBe(false);
  });

  test('setOperationError stores structured error payload with timestamp', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const initial = uiReducer(undefined, { type: 'init' });

    const updated = uiReducer(
      initial,
      setOperationError({
        operation: 'organize:batch',
        message: 'Batch move failed'
      })
    );

    expect(updated.lastOperationError).toEqual({
      operation: 'organize:batch',
      message: 'Batch move failed',
      timestamp: 1_700_000_000_000
    });

    nowSpy.mockRestore();
  });

  test('clearOperationError removes previous operation error', () => {
    const initial = uiReducer(undefined, { type: 'init' });
    const withError = uiReducer(
      initial,
      setOperationError({ operation: 'analysis', message: 'Failed to parse' })
    );
    const cleared = uiReducer(withError, clearOperationError());

    expect(withError.lastOperationError).toBeTruthy();
    expect(cleared.lastOperationError).toBeNull();
  });

  test('resetUi increments resetCounter and clears processing flags', () => {
    const seededState = {
      ...uiReducer(undefined, { type: 'init' }),
      isDiscovering: true,
      isProcessing: true,
      resetCounter: 4
    };

    const resetState = uiReducer(seededState, resetUi());

    expect(resetState.resetCounter).toBe(5);
    expect(resetState.isDiscovering).toBe(false);
    expect(resetState.isProcessing).toBe(false);
    expect(resetState.currentPhase).toBe('welcome');
  });
});
