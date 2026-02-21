import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Check, RotateCcw, ArrowLeft } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPhase, resetUi } from '../store/slices/uiSlice';
import { resetFilesState } from '../store/slices/filesSlice';
import { resetAnalysisState } from '../store/slices/analysisSlice';
import { Button, Card, StatusBadge } from '../components/ui';
import { Heading, Text } from '../components/ui/Typography';
import { UndoRedoToolbar } from '../components/UndoRedoSystem';
import { ActionBar, Inline, Stack } from '../components/layout';
import { formatDisplayPath } from '../utils/pathDisplay';

function FileRow({ file, index, redactPaths }) {
  if (!file || typeof file !== 'object') {
    return null;
  }
  const originalName = file.originalName || file.name || `File ${index + 1}`;
  const fullPath = file.path || file.newLocation || file.destination || '';
  const displayPath = fullPath
    ? formatDisplayPath(fullPath, { redact: redactPaths, segments: 2 })
    : 'Organized';

  return (
    <div
      className="flex items-center py-2.5 px-4 gap-3 border-b border-border-soft/30 last:border-0"
      aria-label={`Organized file ${index + 1}`}
    >
      <Check className="w-4 h-4 text-stratosort-success flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <Text
          variant="small"
          className="text-system-gray-800 truncate"
          title={`${originalName} → ${displayPath}`}
        >
          {originalName}
        </Text>
        <Text variant="tiny" className="text-system-gray-500 truncate">
          {displayPath}
        </Text>
      </div>
    </div>
  );
}

function CompletePhase() {
  const dispatch = useAppDispatch();
  const organizedFiles = useAppSelector((state) => state.files.organizedFiles);
  const redactPaths = useAppSelector((state) => Boolean(state?.system?.redactPaths));
  const shouldReduceMotion = useReducedMotion();

  const { filesToRender, overflowCount, destinationCount, totalFiles } = useMemo(() => {
    const safeFiles = Array.isArray(organizedFiles) ? organizedFiles : [];
    const destinations = new Set();
    safeFiles.forEach((file) => {
      if (file && typeof file === 'object') {
        const destination = file.path || file.newLocation || file.destination || 'Organized';
        destinations.add(destination);
      }
    });

    const displayed = safeFiles.slice(0, 12);
    return {
      filesToRender: displayed,
      overflowCount: Math.max(safeFiles.length - displayed.length, 0),
      destinationCount: destinations.size,
      totalFiles: safeFiles.length
    };
  }, [organizedFiles]);

  const actions = useMemo(
    () => ({
      advancePhase: (phase) => dispatch(setPhase(phase)),
      resetWorkflow: () => {
        // React 18+ batches state updates automatically
        dispatch(resetUi());
        dispatch(resetFilesState());
        dispatch(resetAnalysisState());
        try {
          localStorage.removeItem('stratosort_workflow_state');
          localStorage.removeItem('stratosort_redux_state');
        } catch {
          // Ignore cleanup errors
        }
      }
    }),
    [dispatch]
  );

  const showCelebration = totalFiles > 0 && !shouldReduceMotion;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-relaxed lg:gap-spacious pb-6">
      {/* Header with optional celebration animation */}
      <Stack className="text-center flex-shrink-0" gap="compact">
        <motion.div
          initial={showCelebration ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.22,
            ease: [0.22, 1, 0.36, 1]
          }}
        >
          <Heading as="h1" variant="display">
            Organization <span className="text-gradient">Complete</span>
          </Heading>
        </motion.div>
        <motion.div
          initial={showCelebration ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{
            duration: 0.22,
            delay: showCelebration ? 0.1 : 0,
            ease: [0.22, 1, 0.36, 1]
          }}
          className="max-w-xl mx-auto"
        >
          <Text variant="lead">
            {totalFiles > 0
              ? `Successfully organized ${totalFiles} file${totalFiles !== 1 ? 's' : ''} using AI-powered analysis.`
              : 'No files were organized in this session.'}
          </Text>
        </motion.div>
      </Stack>

      {/* Toolbar with success badge animation */}
      <motion.div
        initial={showCelebration ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{
          duration: 0.22,
          delay: showCelebration ? 0.18 : 0,
          ease: [0.22, 1, 0.36, 1]
        }}
      >
        <Inline className="justify-between pt-2" gap="cozy">
          <Inline gap="relaxed">
            {totalFiles > 0 && (
              <StatusBadge variant="success">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {totalFiles} file{totalFiles !== 1 ? 's' : ''} moved
              </StatusBadge>
            )}
            {destinationCount > 1 && (
              <StatusBadge variant="info">{destinationCount} destinations</StatusBadge>
            )}
          </Inline>
          <UndoRedoToolbar className="flex-shrink-0" />
        </Inline>
      </motion.div>

      {/* Main Content */}
      <Stack className="flex-1 min-h-0" gap="relaxed">
        <Card className="flex flex-col overflow-hidden p-0 max-h-[450px]">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border-soft/70 bg-white/50 flex-shrink-0">
            <Heading as="h2" variant="h5">
              What Changed
            </Heading>
            {totalFiles > 0 && (
              <Text variant="tiny" className="text-system-gray-500">
                {totalFiles} file{totalFiles !== 1 ? 's' : ''} organized
              </Text>
            )}
          </div>

          <div className="flex-1 min-h-0 bg-system-gray-50/30 overflow-y-auto modern-scrollbar">
            {filesToRender.length > 0 ? (
              <>
                {filesToRender.map((file, index) => (
                  <FileRow
                    key={
                      file.path ||
                      file.id ||
                      file.originalPath ||
                      file.originalName ||
                      `file-${index}`
                    }
                    file={file}
                    index={index}
                    redactPaths={redactPaths}
                  />
                ))}
                {overflowCount > 0 && (
                  <div className="text-sm text-system-gray-500 text-center py-3 bg-system-gray-50/50 border-t border-border-soft/30">
                    +{overflowCount} more file{overflowCount !== 1 ? 's' : ''}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <Text variant="small" className="font-medium text-system-gray-700">
                  No files were moved
                </Text>
                <Text variant="tiny" className="text-system-gray-500 mt-1">
                  Go back to adjust your selections or start a new session.
                </Text>
              </div>
            )}
          </div>
        </Card>
      </Stack>

      {/* Footer Navigation */}
      <ActionBar className="mt-auto pt-4">
        <Button
          onClick={() => actions.advancePhase(PHASES?.ORGANIZE ?? 'organize')}
          variant="secondary"
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Organize
        </Button>
        <Button
          onClick={() => actions.resetWorkflow()}
          variant="primary"
          size="md"
          className="w-full sm:w-auto min-w-[180px]"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Start New Session
        </Button>
      </ActionBar>
    </div>
  );
}

FileRow.propTypes = {
  file: PropTypes.shape({
    originalName: PropTypes.string,
    name: PropTypes.string,
    path: PropTypes.string,
    newLocation: PropTypes.string,
    destination: PropTypes.string
  }),
  index: PropTypes.number.isRequired,
  redactPaths: PropTypes.bool
};

export default memo(CompletePhase);
