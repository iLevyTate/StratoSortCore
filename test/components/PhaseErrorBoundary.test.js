import React from 'react';
import { render } from '@testing-library/react';

const mockDispatch = jest.fn();
const mockErrorBoundaryCore = jest.fn(({ children }) => (
  <div data-testid="error-boundary-core">{children}</div>
));

jest.mock('../../src/renderer/store/hooks', () => ({
  useAppDispatch: jest.fn(() => mockDispatch)
}));

jest.mock('../../src/shared/logger', () => {
  const __mockLogger = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  };
  return {
    __mockLogger,
    createLogger: jest.fn(() => __mockLogger)
  };
});

jest.mock('../../src/renderer/store/slices/uiSlice', () => ({
  resetUi: jest.fn(() => ({ type: 'ui/resetUi' }))
}));

jest.mock('../../src/renderer/store/slices/filesSlice', () => ({
  resetFilesState: jest.fn(() => ({ type: 'files/resetFilesState' }))
}));

jest.mock('../../src/renderer/store/slices/analysisSlice', () => ({
  resetAnalysisState: jest.fn(() => ({ type: 'analysis/resetAnalysisState' })),
  resetToSafeState: jest.fn(() => ({ type: 'analysis/resetToSafeState' }))
}));

jest.mock('../../src/renderer/components/ErrorBoundary', () => ({
  ErrorBoundaryCore: (props) => mockErrorBoundaryCore(props)
}));

import { resetUi } from '../../src/renderer/store/slices/uiSlice';
import { resetFilesState } from '../../src/renderer/store/slices/filesSlice';
import {
  resetAnalysisState,
  resetToSafeState
} from '../../src/renderer/store/slices/analysisSlice';
import { __mockLogger } from '../../src/shared/logger';
import PhaseErrorBoundary from '../../src/renderer/components/PhaseErrorBoundary';

describe('PhaseErrorBoundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('passes phase-specific configuration to ErrorBoundaryCore', () => {
    render(
      <PhaseErrorBoundary phaseName="Discover">
        <div>Child content</div>
      </PhaseErrorBoundary>
    );

    expect(mockErrorBoundaryCore).toHaveBeenCalledTimes(1);
    const props = mockErrorBoundaryCore.mock.calls[0][0];
    expect(props.variant).toBe('phase');
    expect(props.contextName).toBe('Discover');
    expect(props.showNavigateHome).toBe(true);
    expect(props.enableChunkRecovery).toBe(true);
    expect(typeof props.onNavigateHome).toBe('function');
    expect(typeof props.onError).toBe('function');
    expect(typeof props.onReset).toBe('function');
  });

  test('dispatches full state reset when navigate home is triggered', () => {
    render(
      <PhaseErrorBoundary phaseName="Organize">
        <div>Child content</div>
      </PhaseErrorBoundary>
    );

    const props = mockErrorBoundaryCore.mock.calls[0][0];
    props.onNavigateHome();

    expect(resetUi).toHaveBeenCalledTimes(1);
    expect(resetFilesState).toHaveBeenCalledTimes(1);
    expect(resetAnalysisState).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'ui/resetUi' });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'files/resetFilesState' });
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'analysis/resetAnalysisState' });
  });

  test('dispatches resetToSafeState when retry reset is triggered', () => {
    render(
      <PhaseErrorBoundary phaseName="Setup">
        <div>Child content</div>
      </PhaseErrorBoundary>
    );

    const props = mockErrorBoundaryCore.mock.calls[0][0];
    props.onReset();

    expect(resetToSafeState).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'analysis/resetToSafeState' });
    expect(__mockLogger.info).toHaveBeenCalled();
  });

  test('logs contextual details when error callback is invoked', () => {
    render(
      <PhaseErrorBoundary phaseName="Welcome">
        <div>Child content</div>
      </PhaseErrorBoundary>
    );

    const props = mockErrorBoundaryCore.mock.calls[0][0];
    const error = new Error('Boom');
    const errorInfo = { componentStack: 'stack-trace' };
    props.onError(error, errorInfo, 'Welcome');

    expect(__mockLogger.error).toHaveBeenCalledWith('Phase error: Welcome', {
      error: 'Boom',
      stack: expect.any(String),
      componentStack: 'stack-trace'
    });
  });
});
