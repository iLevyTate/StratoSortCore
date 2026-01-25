import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle2, ClipboardList, Target, Check, ArrowLeft } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPhase, resetUi } from '../store/slices/uiSlice';
import { resetFilesState } from '../store/slices/filesSlice';
import { resetAnalysisState } from '../store/slices/analysisSlice';
import Button from '../components/ui/Button';
import { UndoRedoToolbar } from '../components/UndoRedoSystem';
import { ActionBar, Inline, Stack } from '../components/layout';
import { formatDisplayPath } from '../utils/pathDisplay';

function StatPill({ label, value, tone = 'neutral' }) {
  const baseClass = 'badge-soft justify-between';
  const toneClass = tone === 'success' ? 'status-chip success' : baseClass;
  const Comp = tone === 'success' ? 'span' : 'div';

  return (
    <Comp className={`inline-flex items-center gap-2 ${toneClass}`}>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-xs text-system-gray-500">{label}</span>
    </Comp>
  );
}

function FileRow({ file, index }) {
  if (!file || typeof file !== 'object') {
    return null;
  }
  const originalName = file.originalName || file.name || `File ${index + 1}`;
  // FIX: Prefer smartFolder for display if available, otherwise fallback to path
  const displayLocation =
    file.smartFolder || file.path || file.newLocation || file.destination || 'Organized';
  const fullPath = file.path || file.newLocation || file.destination || '';
  const displayPath = fullPath
    ? formatDisplayPath(fullPath, { redact: true, segments: 2 })
    : typeof displayLocation === 'string'
      ? displayLocation
      : 'Organized';

  return (
    <Inline
      className="list-row text-sm items-center p-default gap-cozy"
      wrap={false}
      aria-label={`Organized file ${index + 1}`}
    >
      <div className="h-10 w-10 rounded-lg bg-stratosort-success/10 text-stratosort-success flex items-center justify-center font-semibold text-base flex-shrink-0">
        {index + 1}
      </div>
      <Stack className="flex-1 min-w-0" gap="compact">
        <span
          className="truncate text-system-gray-900 font-medium"
          title={`${originalName} → ${fullPath}`}
        >
          {originalName}
        </span>
        <span className="truncate text-system-gray-500 text-xs" title={fullPath || ''}>
          {displayPath}
        </span>
      </Stack>
      <Check className="w-5 h-5 text-stratosort-success flex-shrink-0" />
    </Inline>
  );
}

function CompletePhase() {
  const dispatch = useAppDispatch();
  const organizedFiles = useAppSelector((state) => state.files.organizedFiles);

  const { filesToRender, overflowCount, destinationCount, totalFiles, listDensityClass } =
    useMemo(() => {
      const safeFiles = Array.isArray(organizedFiles) ? organizedFiles : [];
      const destinations = new Set();
      safeFiles.forEach((file) => {
        if (file && typeof file === 'object') {
          const destination = file.path || file.newLocation || file.destination || 'Organized';
          destinations.add(destination);
        }
      });

      const displayed = safeFiles.slice(0, 8);
      const density =
        safeFiles.length <= 2
          ? 'data-sparse'
          : safeFiles.length <= 8
            ? 'data-moderate'
            : 'data-dense';
      return {
        filesToRender: displayed,
        overflowCount: Math.max(safeFiles.length - displayed.length, 0),
        destinationCount: destinations.size,
        totalFiles: safeFiles.length,
        listDensityClass: density
      };
    }, [organizedFiles]);

  // FIX: Memoize actions object to prevent recreation on every render
  const actions = useMemo(
    () => ({
      advancePhase: (phase) => dispatch(setPhase(phase)),
      resetWorkflow: () => {
        dispatch(resetUi());
        dispatch(resetFilesState());
        dispatch(resetAnalysisState());
        // Clear persistence
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
    <div className="phase-container bg-system-gray-50/30 pb-spacious">
      <Stack
        className="container-responsive flex-1 min-h-0 px-default pt-8 pb-default md:px-relaxed lg:px-spacious w-full mx-auto"
        gap="relaxed"
      >
        {/* Header */}
        <Stack className="text-center flex-shrink-0" gap="compact">
          <Inline className="justify-center" gap="compact">
            <div className="h-8 w-8 rounded-xl bg-stratosort-success/10 text-stratosort-success flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-xs uppercase tracking-wide text-system-gray-500 font-semibold">
              Session complete
            </p>
          </Inline>
          <h1 className="heading-primary">
            Organization <span className="text-gradient">Complete</span>
          </h1>
          <p className="text-system-gray-600 leading-relaxed max-w-xl mx-auto text-sm md:text-base">
            {totalFiles > 0
              ? `Successfully organized ${totalFiles} file${totalFiles !== 1 ? 's' : ''} using AI-powered analysis.`
              : 'No files were organized in this session. You can go back and adjust your selections or run another session.'}
          </p>
        </Stack>

        {/* Toolbar / Summary Stats */}
        <div className="toolbar">
          <div className="stats-grid">
            <StatPill label="Files organized" value={totalFiles} tone="success" />
            <StatPill label="Destinations" value={destinationCount || 1} />
            <StatPill label="Undo/Redo" value="Available" />
          </div>
          <div className="flex-shrink-0">
            <UndoRedoToolbar />
          </div>
        </div>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-3 flex-1 min-h-0 gap-relaxed">
          {/* Organization Summary Card */}
          <section className="surface-panel panel-responsive xl:col-span-2">
            <Inline className="justify-between" gap="cozy">
              <h3 className="heading-tertiary m-0 flex items-center gap-cozy">
                <ClipboardList className="w-5 h-5 text-stratosort-blue" />
                <span>What changed</span>
              </h3>
              <span className="status-chip success">
                {totalFiles} file{totalFiles !== 1 ? 's' : ''}
              </span>
            </Inline>

            <div
              className={`panel-responsive-content modern-scrollbar ${listDensityClass}`}
              style={{ maxHeight: 'var(--list-max-height, 320px)' }}
            >
              {filesToRender.length > 0 ? (
                <div className="flex flex-col gap-cozy">
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
                    <div className="text-sm text-system-gray-500 text-center p-cozy">
                      +{overflowCount} more file{overflowCount !== 1 ? 's' : ''} organized
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="text-sm font-semibold text-system-gray-800">Nothing moved</div>
                  <div className="text-sm text-system-gray-500">
                    Go back to Discovery or Organization to adjust your selections.
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Next Steps */}
          <div className="flex flex-col gap-default">
            <section className="surface-panel flex flex-col gap-relaxed">
              <Inline className="justify-between" gap="cozy">
                <h3 className="heading-tertiary m-0 flex items-center gap-cozy">
                  <Target className="w-5 h-5 text-stratosort-blue" />
                  <span>Next Steps</span>
                </h3>
                <span className="text-xs text-system-gray-500">All set</span>
              </Inline>

              <Stack gap="default">
                <div className="p-default rounded-xl bg-system-gray-50 border border-border-soft/70">
                  <p className="text-sm text-system-gray-600 mb-compact">Suggested checks</p>
                  <ul className="text-sm text-system-gray-600 space-y-2">
                    <li>Review the changed files list for anything unexpected.</li>
                    <li>Use undo/redo to revert individual moves if needed.</li>
                    <li>Start a new session when you’re ready to organize more files.</li>
                  </ul>
                </div>
                <div className="text-xs text-system-gray-500">
                  Actions are available at the bottom of the page.
                </div>
              </Stack>
            </section>
          </div>
        </div>

        <ActionBar>
          <div className="text-sm text-system-gray-600">
            {totalFiles > 0
              ? `Done — ${totalFiles} file${totalFiles !== 1 ? 's' : ''} organized.`
              : 'Done — no changes applied.'}
          </div>
          <Inline className="justify-end w-full sm:w-auto" gap="cozy" wrap={true}>
            <Button
              onClick={() => actions.advancePhase(PHASES?.ORGANIZE ?? 'organize')}
              variant="secondary"
              size="md"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Organization
            </Button>
            <Button
              onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
              variant="ghost"
              size="md"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Discovery
            </Button>
            <Button onClick={() => actions.resetWorkflow()} variant="primary" size="lg">
              Start New Session
            </Button>
          </Inline>
        </ActionBar>
      </Stack>
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

// FIX: Wrap with memo to prevent unnecessary re-renders from parent changes
export default memo(CompletePhase);
