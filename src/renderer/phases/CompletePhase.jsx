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

function StatPill({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'success'
      ? 'text-stratosort-success bg-white/70 border-stratosort-success/20'
      : 'text-system-gray-700 bg-white/60 border-border-soft';

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-xs ${toneClass}`}
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <span className="text-sm font-semibold">{value}</span>
      <span className="text-xs text-system-gray-500">{label}</span>
    </div>
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

  return (
    <div className="text-sm flex items-center bg-white/70 rounded-lg border border-border-soft/60 shadow-sm p-4 gap-3">
      <div className="h-10 w-10 rounded-lg bg-stratosort-success/10 text-stratosort-success flex items-center justify-center font-semibold text-base flex-shrink-0">
        {index + 1}
      </div>
      <div className="flex flex-col flex-1 min-w-0 gap-1 mx-1">
        <span
          className="truncate text-system-gray-900 font-medium"
          title={`${originalName} → ${fullPath}`}
        >
          {originalName}
        </span>
        <span className="truncate text-system-gray-500 text-xs" title={fullPath}>
          {displayLocation}
        </span>
      </div>
      <Check className="w-5 h-5 text-stratosort-success flex-shrink-0 ml-2" />
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
      <div className="container-responsive flex flex-col flex-1 min-h-0 px-default pt-8 pb-default md:px-relaxed lg:px-spacious gap-6 lg:gap-8 max-w-6xl w-full mx-auto">
        {/* Header */}
        <div className="text-center flex flex-col flex-shrink-0 gap-compact">
          <div className="flex items-center justify-center gap-2 mb-1">
            <div className="h-8 w-8 rounded-xl bg-stratosort-success/10 text-stratosort-success flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <p className="text-xs uppercase tracking-wide text-system-gray-500 font-semibold">
              Session complete
            </p>
          </div>
          <h1 className="heading-primary text-xl md:text-2xl">
            Organization <span className="text-gradient">Complete</span>
          </h1>
          <p className="text-system-gray-600 leading-relaxed max-w-xl mx-auto text-sm md:text-base">
            Successfully organized {totalFiles} file{totalFiles !== 1 ? 's' : ''} using AI-powered
            analysis.
          </p>
        </div>

        {/* Toolbar / Summary Stats */}
        <div className="flex items-center justify-between gap-cozy mb-2">
          <div className="flex flex-wrap items-center gap-cozy">
            <StatPill label="Files organized" value={totalFiles} tone="success" />
            <StatPill label="Destinations" value={destinationCount || 1} />
            <StatPill label="Undo/Redo" value="Available" />
          </div>
          <UndoRedoToolbar className="flex-shrink-0" />
        </div>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-3 flex-1 min-h-0 gap-6">
          {/* Organization Summary Card */}
          <section className="surface-panel flex flex-col xl:col-span-2 gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-cozy">
              <h3 className="heading-tertiary m-0 flex items-center gap-cozy">
                <ClipboardList className="w-5 h-5 text-stratosort-blue" />
                <span>What changed</span>
              </h3>
              <span className="status-chip success">
                {totalFiles} file{totalFiles !== 1 ? 's' : ''}
              </span>
            </div>

            <div
              className="flex-1 min-h-0 overflow-y-auto modern-scrollbar"
              style={{ maxHeight: '320px' }}
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
                <div className="text-sm text-system-gray-500 text-center p-default">
                  No files were organized in this session.
                </div>
              )}
            </div>
          </section>

          {/* Next Steps */}
          <div className="flex flex-col gap-default">
            <section className="surface-panel flex flex-col justify-between gap-6">
              <div className="flex items-center justify-between">
                <h3 className="heading-tertiary m-0 flex items-center gap-cozy">
                  <Target className="w-5 h-5 text-stratosort-blue" />
                  <span>Next Steps</span>
                </h3>
                <span className="text-xs text-system-gray-500">All set</span>
              </div>

              <div className="flex flex-col gap-default">
                <div className="p-4 rounded-xl bg-system-gray-50 border border-border-soft/70">
                  <p className="text-sm text-system-gray-600 mb-2">Ready for your next session?</p>
                  <Button
                    onClick={() => actions.resetWorkflow()}
                    variant="primary"
                    className="w-full justify-center"
                    size="lg"
                  >
                    Start New Session
                  </Button>
                </div>

                <div className="border-t border-border-soft/60 pt-default">
                  <p className="text-xs text-system-gray-500 mb-3">Need to make adjustments?</p>
                  <div className="flex flex-col gap-cozy">
                    <Button
                      onClick={() => actions.advancePhase(PHASES?.ORGANIZE ?? 'organize')}
                      variant="secondary"
                      size="sm"
                      className="w-full"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Organization
                    </Button>
                    <Button
                      onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                      variant="ghost"
                      size="sm"
                      className="w-full"
                    >
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Discovery
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
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
