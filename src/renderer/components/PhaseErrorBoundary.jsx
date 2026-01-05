import React from 'react';
import PropTypes from 'prop-types';
import { logger } from '../../shared/logger';
import { useAppDispatch } from '../store/hooks';
import { resetUi } from '../store/slices/uiSlice';
import { resetFilesState } from '../store/slices/filesSlice';
import { resetAnalysisState } from '../store/slices/analysisSlice';
import { ErrorBoundaryCore } from './ErrorBoundary';

logger.setContext('PhaseErrorBoundary');

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

  return (
    <ErrorBoundaryCore
      variant="phase"
      contextName={phaseName}
      showNavigateHome
      enableChunkRecovery
      onNavigateHome={handleNavigateHome}
      onError={handleError}
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
