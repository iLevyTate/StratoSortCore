import React from 'react';
import { PHASES } from '../../shared/constants';
import { usePhase } from '../contexts/PhaseContext';
import Collapsible from '../components/ui/Collapsible';
import Button from '../components/ui/Button';

function CompletePhase() {
  const { actions, phaseData } = usePhase();
  const organizedFiles = phaseData.organizedFiles || [];

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden modern-scrollbar">
      <div className="container-responsive gap-6 py-6 pb-24 flex flex-col min-h-min">
        <div className="text-center space-y-4">
          <div className="text-6xl">✅</div>
          <h1 className="heading-primary">Organization Complete!</h1>
          <p className="text-lg text-system-gray-600 max-w-2xl mx-auto">
            Successfully organized {organizedFiles.length} files using
            AI-powered analysis.
          </p>
          <div className="flex items-center justify-center gap-6 text-xs text-system-gray-500">
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
            contentClassName="p-8"
            className="glass-panel"
          >
            <div className="space-y-5">
              {organizedFiles.slice(0, 5).map((file, index) => (
                <div key={index} className="text-sm">
                  <span className="text-system-gray-600">✓</span>{' '}
                  {file.originalName || `File ${index + 1}`} →{' '}
                  {file.path || file.newLocation || 'Organized'}
                </div>
              ))}
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
          className="glass-panel"
        >
          <div className="flex flex-col gap-13">
            <div className="flex flex-col sm:flex-row gap-8 flex-shrink-0">
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
              className="px-34 py-13 w-full sm:w-auto"
            >
              🚀 Start New Organization Session
            </Button>
          </div>
        </Collapsible>
      </div>
    </div>
  );
}

export default CompletePhase;
