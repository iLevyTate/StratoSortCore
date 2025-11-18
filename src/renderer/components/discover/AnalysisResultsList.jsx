import React, { memo, useMemo } from 'react';
import PropTypes from 'prop-types';

function AnalysisResultsList({
  results = [],
  onFileAction,
  getFileStateDisplay,
}) {
  const isEmpty = !Array.isArray(results) || results.length === 0;
  const items = useMemo(
    () => (Array.isArray(results) ? results : []),
    [results],
  );
  const handleAction = useMemo(() => onFileAction, [onFileAction]);
  if (isEmpty) return null;
  return (
    <div className="space-y-8">
      {items.map((file, index) => {
        const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
        return (
          <div key={file.path || index} className="border rounded-lg p-13">
            <div className="flex items-start gap-13">
              <div className="text-2xl">📄</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-system-gray-900 break-words">
                  {file.name}
                </div>
                <div className="text-xs text-system-gray-500">
                  {file.source?.replace('_', ' ')}
                  {file.size ? ` • ${Math.round(file.size / 1024)} KB` : ''}
                </div>
                {file.analysis?.category && (
                  <div className="text-xs text-system-gray-600 mt-3">
                    Category:{' '}
                    <span className="text-stratosort-blue">
                      {file.analysis.category}
                    </span>
                  </div>
                )}
              </div>
              <div
                className={`text-sm font-medium flex items-center gap-3 ${stateDisplay.color}`}
              >
                <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
                  {stateDisplay.icon}
                </span>
                <span>{stateDisplay.label}</span>
              </div>
            </div>
            <div className="flex items-center gap-8 mt-8">
              <button
                onClick={() => handleAction('open', file.path)}
                className="text-blue-600 hover:underline text-sm"
              >
                Open
              </button>
              <button
                onClick={() => handleAction('reveal', file.path)}
                className="text-blue-600 hover:underline text-sm"
              >
                Reveal
              </button>
              <button
                onClick={() => handleAction('delete', file.path)}
                className="text-system-red-600 hover:underline text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

AnalysisResultsList.propTypes = {
  results: PropTypes.arrayOf(PropTypes.object),
  onFileAction: PropTypes.func.isRequired,
  getFileStateDisplay: PropTypes.func.isRequired,
};

export default memo(AnalysisResultsList);
