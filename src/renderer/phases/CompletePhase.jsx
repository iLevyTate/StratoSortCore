import React, { memo, useMemo } from 'react';
import { PHASES } from '../../shared/constants';
import { useAppSelector, useAppDispatch } from '../store/hooks';
import { setPhase, resetUi } from '../store/slices/uiSlice';
import { resetFilesState } from '../store/slices/filesSlice';
import { resetAnalysisState } from '../store/slices/analysisSlice';
import Collapsible from '../components/ui/Collapsible';
import Button from '../components/ui/Button';
import { UndoRedoToolbar } from '../components/UndoRedoSystem';

function CompletePhase() {
  const dispatch = useAppDispatch();
  const organizedFiles =
    useAppSelector((state) => state.files.organizedFiles) || [];

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
      },
    }),
    [dispatch],
  );

  return (
    <div className="min-h-[calc(100vh-var(--app-nav-height))] w-full overflow-auto modern-scrollbar pb-8">
      <div className="container-responsive gap-4 py-4 flex flex-col h-full min-h-0">
        {/* Undo/Redo Toolbar */}
        <div className="flex justify-end flex-shrink-0">
          <UndoRedoToolbar className="flex-shrink-0" />
        </div>

        <div className="text-center space-y-3">
          <div className="text-6xl">✅</div>
          <h1 className="heading-primary">Organization Complete!</h1>
          <p className="text-base text-system-gray-600 max-w-2xl mx-auto">
            Successfully organized {organizedFiles.length} files using
            AI-powered analysis.
          </p>
          <div className="flex items-center justify-center gap-4 text-xs text-system-gray-500">
            <button
              className="hover:text-system-gray-800 underline"
              onClick={() => {
                try {
                  const keys = ['complete-summary', 'complete-next-steps'];
                  keys.forEach((k) =>
                    window.localStorage.setItem(`collapsible:${k}`, 'true'),
                  );
                  window.dispatchEvent(new Event('storage'));
                } catch {
                  // Non-fatal if localStorage fails
                }
              }}
            >
              Expand all
            </button>
            <span className="text-system-gray-300">•</span>
            <button
              className="hover:text-system-gray-800 underline"
              onClick={() => {
                try {
                  const keys = ['complete-summary', 'complete-next-steps'];
                  keys.forEach((k) =>
                    window.localStorage.setItem(`collapsible:${k}`, 'false'),
                  );
                  window.dispatchEvent(new Event('storage'));
                } catch {
                  // Non-fatal if localStorage fails
                }
              }}
            >
              Collapse all
            </button>
          </div>
        </div>

        {organizedFiles.length > 0 && (
          <Collapsible
            title="Organization Summary"
            defaultOpen
            persistKey="complete-summary"
            contentClassName="p-[var(--panel-padding)] panel-scroll max-h-[320px]"
            className="surface-panel"
            collapsedPreview={
              <div className="text-sm text-system-gray-600 py-1">
                {organizedFiles.length} file
                {organizedFiles.length !== 1 ? 's' : ''} successfully organized
              </div>
            }
          >
            <div className="space-y-4 overflow-hidden">
              {/* FIX: Add null check for file objects and use stable identifier */}
              {organizedFiles.slice(0, 5).map((file, index) => {
                // FIX: Guard against null/undefined file objects
                if (!file || typeof file !== 'object') {
                  return null;
                }
                const originalName =
                  file.originalName || file.name || `File ${index + 1}`;
                const destination =
                  file.path ||
                  file.newLocation ||
                  file.destination ||
                  'Organized';
                return (
                  <div
                    key={
                      file.path ||
                      file.id ||
                      file.originalPath ||
                      file.originalName ||
                      `file-${index}`
                    }
                    className="text-sm flex items-center gap-2 overflow-hidden"
                  >
                    <span className="text-green-600 flex-shrink-0">✓</span>
                    <span
                      className="truncate flex-1"
                      title={`${originalName} → ${destination}`}
                    >
                      {originalName} → {destination}
                    </span>
                  </div>
                );
              })}
              {organizedFiles.length > 5 && (
                <div className="text-sm text-system-gray-500 italic">
                  ...and {organizedFiles.length - 5} more files
                </div>
              )}
            </div>
          </Collapsible>
        )}

        <Collapsible
          title="Next Steps"
          defaultOpen
          persistKey="complete-next-steps"
          className="surface-panel"
          collapsedPreview={
            <div className="text-sm text-system-gray-600 py-1">
              Start a new session or go back to previous steps
            </div>
          }
        >
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row gap-4 flex-shrink-0">
              <Button
                onClick={() => actions.advancePhase(PHASES.ORGANIZE)}
                variant="secondary"
                className="flex-1"
              >
                ← Back to Organization
              </Button>
              <Button
                onClick={() => actions.advancePhase(PHASES.DISCOVER)}
                variant="outline"
                className="flex-1"
              >
                ← Back to Discovery
              </Button>
            </div>
            <Button
              onClick={() => actions.resetWorkflow()}
              variant="primary"
              className="px-8 py-4 w-full sm:w-auto"
            >
              🚀 Start New Organization Session
            </Button>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

// FIX: Wrap with memo to prevent unnecessary re-renders from parent changes
export default memo(CompletePhase);
