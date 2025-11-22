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
    <div className="space-y-4 p-4">
      {items.map((file, index) => {
        const stateDisplay = getFileStateDisplay(file.path, !!file.analysis);
        return (
          <div
            key={file.path || index}
            className="border rounded-lg p-4 bg-white/50 hover:bg-white/80 transition-all"
          >
            <div className="flex items-start gap-4">
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
                  <div className="text-xs text-system-gray-600 mt-1">
                    Category:{' '}
                    <span className="text-stratosort-blue font-medium">
                      {file.analysis.category}
                    </span>
                  </div>
                )}
              </div>
              <div
                className={`text-sm font-medium flex items-center gap-2 ${stateDisplay.color}`}
              >
                <span className={stateDisplay.spinning ? 'animate-spin' : ''}>
                  {stateDisplay.icon}
                </span>
                <span>{stateDisplay.label}</span>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3 border-t pt-2 border-system-gray-100">
              <button
                onClick={() => handleAction('open', file.path)}
                className="text-stratosort-blue hover:underline text-xs font-medium"
              >
                Open
              </button>
              <button
                onClick={() => handleAction('reveal', file.path)}
                className="text-stratosort-blue hover:underline text-xs font-medium"
              >
                Reveal
              </button>
              <button
                onClick={() => handleAction('delete', file.path)}
                className="text-red-600 hover:underline text-xs font-medium ml-auto"
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
