import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, ClipboardList, Target, Check, ArrowLeft, RotateCcw } from 'lucide-react';
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

function StatPill({ label, value, tone = 'neutral' }) {
  const variant = tone === 'success' ? 'success' : 'info';
  return (
    <StatusBadge variant={variant} className="justify-between w-full sm:w-auto">
      <span className="font-semibold tabular-nums mr-2">{value}</span>
      <span className="opacity-80 font-normal">{label}</span>
    </StatusBadge>
  );
}

function FileRow({ file, index }) {
  if (!file || typeof file !== 'object') {
    return null;
  }
  const originalName = file.originalName || file.name || `File ${index + 1}`;
  const displayLocation =
    file.smartFolder || file.path || file.newLocation || file.destination || 'Organized';
  const fullPath = file.path || file.newLocation || file.destination || '';
  const displayPath = fullPath
    ? formatDisplayPath(fullPath, { redact: true, segments: 2 })
    : typeof displayLocation === 'string'
      ? displayLocation
      : 'Organized';

  return (
    <div
      className="flex items-center p-3 gap-3 border-b border-border-soft/50 last:border-0 hover:bg-system-gray-50/50 transition-colors"
      aria-label={`Organized file ${index + 1}`}
    >
      <div className="h-8 w-8 rounded-lg bg-stratosort-success/10 text-stratosort-success flex items-center justify-center font-semibold text-sm flex-shrink-0">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <Text
          variant="small"
          className="font-medium text-system-gray-900 truncate"
          title={`${originalName} → ${fullPath}`}
        >
          {originalName}
        </Text>
        <Text variant="tiny" className="text-system-gray-500 truncate" title={fullPath || ''}>
          {displayPath}
        </Text>
      </div>
      <Check className="w-4 h-4 text-stratosort-success flex-shrink-0" />
    </div>
  );
}

function CompletePhase() {
  const dispatch = useAppDispatch();
  const organizedFiles = useAppSelector((state) => state.files.organizedFiles);

  const { filesToRender, overflowCount, destinationCount, totalFiles } = useMemo(() => {
    const safeFiles = Array.isArray(organizedFiles) ? organizedFiles : [];
    const destinations = new Set();
    safeFiles.forEach((file) => {
      if (file && typeof file === 'object') {
        const destination = file.path || file.newLocation || file.destination || 'Organized';
        destinations.add(destination);
      }
    });

    const displayed = safeFiles.slice(0, 8);
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

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-6 lg:gap-8 pb-6">
      {/* Header */}
      <Stack className="text-center flex-shrink-0" gap="compact">
        <Inline className="justify-center" gap="compact">
          <div className="h-8 w-8 rounded-xl bg-stratosort-success/10 text-stratosort-success flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <Text
            variant="tiny"
            className="uppercase tracking-wide text-system-gray-500 font-semibold"
          >
            Session complete
          </Text>
        </Inline>
        <Heading as="h1" variant="display">
          Organization <span className="text-gradient">Complete</span>
        </Heading>
        <Text variant="lead" className="max-w-xl mx-auto">
          {totalFiles > 0
            ? `Successfully organized ${totalFiles} file${totalFiles !== 1 ? 's' : ''} using AI-powered analysis.`
            : 'No files were organized in this session. You can go back and adjust your selections or run another session.'}
        </Text>
      </Stack>

      {/* Stats & Toolbar */}
      <Inline className="justify-between" gap="cozy" wrap>
        <Inline className="justify-center sm:justify-start w-full sm:w-auto" gap="default" wrap>
          <StatPill label="Files organized" value={totalFiles} tone="success" />
          <StatPill label="Destinations" value={destinationCount || 1} />
        </Inline>
        <div className="flex-shrink-0">
          <UndoRedoToolbar />
        </div>
      </Inline>

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-3 flex-1 min-h-0 gap-6">
        {/* Organization Summary Card */}
        <Card className="xl:col-span-2 flex flex-col overflow-hidden p-0 h-full max-h-[500px] xl:max-h-none">
          <div className="p-4 border-b border-border-soft/70 bg-white/50 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-5 h-5 text-stratosort-blue" />
              <Heading as="h3" variant="h5">
                What Changed
              </Heading>
            </div>
            <StatusBadge variant="success">
              {totalFiles} file{totalFiles !== 1 ? 's' : ''}
            </StatusBadge>
          </div>

          <div className="flex-1 overflow-y-auto modern-scrollbar bg-white">
            {filesToRender.length > 0 ? (
              <div>
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
                  />
                ))}
                {overflowCount > 0 && (
                  <div className="text-sm text-system-gray-500 text-center p-4 bg-system-gray-50/30 border-t border-border-soft/50">
                    +{overflowCount} more file{overflowCount !== 1 ? 's' : ''} organized
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 text-center p-8">
                <Text variant="small" className="font-semibold text-system-gray-800">
                  Nothing moved
                </Text>
                <Text variant="tiny" className="text-system-gray-500 mt-1">
                  Go back to Discovery or Organization to adjust your selections.
                </Text>
              </div>
            )}
          </div>
        </Card>

        {/* Next Steps */}
        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-stratosort-blue" />
                <Heading as="h3" variant="h5">
                  Next Steps
                </Heading>
              </div>
              <Text variant="tiny" className="text-system-gray-500">
                All set
              </Text>
            </div>

            <Stack gap="default">
              <div className="p-4 rounded-xl bg-system-gray-50 border border-border-soft/70">
                <Text variant="small" className="font-medium text-system-gray-700 mb-2">
                  Suggested checks
                </Text>
                <ul className="text-sm text-system-gray-600 space-y-2 list-disc pl-4">
                  <li>Review the changed files list for anything unexpected.</li>
                  <li>Use undo/redo to revert individual moves if needed.</li>
                  <li>Start a new session when you’re ready to organize more files.</li>
                </ul>
              </div>
              <Text variant="tiny" className="text-system-gray-500 text-center">
                Actions are available at the bottom of the page.
              </Text>
            </Stack>
          </Card>
        </div>
      </div>

      <ActionBar>
        <div className="text-sm text-system-gray-600 hidden sm:block">
          {totalFiles > 0
            ? `Done — ${totalFiles} file${totalFiles !== 1 ? 's' : ''} organized.`
            : 'Done — no changes applied.'}
        </div>
        <Inline className="justify-end w-full sm:w-auto" gap="default" wrap={true}>
          <Button
            onClick={() => actions.advancePhase(PHASES?.ORGANIZE ?? 'organize')}
            variant="secondary"
            size="md"
            className="w-full sm:w-auto min-w-[180px]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organization
          </Button>
          <Button
            onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
            variant="ghost"
            size="md"
            className="w-full sm:w-auto min-w-[180px]"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Discovery
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
        </Inline>
      </ActionBar>
    </div>
  );
}

StatPill.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  tone: PropTypes.string
};

FileRow.propTypes = {
  file: PropTypes.shape({
    originalName: PropTypes.string,
    name: PropTypes.string,
    path: PropTypes.string,
    newLocation: PropTypes.string,
    destination: PropTypes.string
  }),
  index: PropTypes.number.isRequired
};

export default memo(CompletePhase);
