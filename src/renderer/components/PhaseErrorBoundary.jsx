import React from 'react';
import PropTypes from 'prop-types';
import { createLogger } from '../../shared/logger';
import { useAppDispatch } from '../store/hooks';
import { resetUi } from '../store/slices/uiSlice';
import { resetFilesState } from '../store/slices/filesSlice';
import { resetAnalysisState, resetToSafeState } from '../store/slices/analysisSlice';
import { ErrorBoundaryCore } from './ErrorBoundary';

const logger = createLogger('PhaseErrorBoundary');
/**
 * Phase-specific error boundary wrapper
 *
 * Uses the unified ErrorBoundaryCore with phase-specific configuration:
 * - Shows phase name in error UI
 * - Provides "Go to Home" navigation
 * - Enables chunk load recovery
 */
function PhaseErrorBoundary({ children, phaseName }) {
  const dispatch = useAppDispatch();

  const handleNavigateHome = () => {
    dispatch(resetUi());
    dispatch(resetFilesState());
    dispatch(resetAnalysisState());
  };

  const handleError = (error, errorInfo, context) => {
    logger.error(`Phase error: ${context}`, {
      error: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack
    });
  };

  // Uses resetToSafeState to clear in-progress state but preserve results
  const handleReset = () => {
    dispatch(resetToSafeState());
    logger.info('Phase error boundary reset, analysis state cleared');
  };

  return (
    <ErrorBoundaryCore
      variant="phase"
      contextName={phaseName}
      showNavigateHome
      enableChunkRecovery
      onNavigateHome={handleNavigateHome}
      onError={handleError}
      onReset={handleReset}
    >
      {children}
    </ErrorBoundaryCore>
  );
}

PhaseErrorBoundary.propTypes = {
  children: PropTypes.node.isRequired,
  phaseName: PropTypes.string.isRequired
};

export default PhaseErrorBoundary;
