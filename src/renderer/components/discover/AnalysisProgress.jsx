import React, { memo } from 'react';
import PropTypes from 'prop-types';

const AnalysisProgress = memo(function AnalysisProgress({
  progress = { current: 0, total: 0 },
  currentFile = '',
}) {
  const total = Math.max(0, Number(progress.total) || 0);
  const current = Math.max(
    0,
    Math.min(
      Number(progress.current) || 0,
      total || Number(progress.current) || 0,
    ),
  );
  const hasTotals = total > 0;
  const isDone = hasTotals && current >= total;
  const percent = hasTotals
    ? Math.min(100, Math.round((current / total) * 100))
    : 0;

  return (
    <div className="surface-card p-5">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 rounded-full border-2 border-stratosort-blue/25 border-t-stratosort-blue animate-spin" />
            <div className="absolute inset-2 rounded-full bg-stratosort-blue/10 flex items-center justify-center text-base">
              📂
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-system-gray-900">
              {isDone
                ? 'Analysis complete'
                : hasTotals
                  ? `Analyzing ${current} of ${total}`
                  : 'Preparing analysis...'}
            </p>
            <p className="text-xs text-system-gray-600">
              {hasTotals ? `${percent}%` : 'Estimating remaining time'}
            </p>
          </div>
        </div>
        {hasTotals && (
          <div className="status-chip info">
            <span className="h-2 w-2 rounded-full bg-stratosort-blue" />
            {percent}%
          </div>
        )}
      </div>

      <div className="space-y-3">
        {hasTotals ? (
          <div className="progress-enhanced">
            <div
              className="progress-bar-enhanced"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : (
          <div className="indeterminate-bar" />
        )}
        {currentFile && (
          <div className="text-xs text-system-gray-500 break-words">
            {isDone ? 'Last processed:' : 'Currently processing:'}{' '}
            <span className="text-system-gray-700">{currentFile}</span>
          </div>
        )}
      </div>
    </div>
  );
});

AnalysisProgress.propTypes = {
  progress: PropTypes.shape({
    current: PropTypes.number,
    total: PropTypes.number,
  }),
  currentFile: PropTypes.string,
};

export default AnalysisProgress;
