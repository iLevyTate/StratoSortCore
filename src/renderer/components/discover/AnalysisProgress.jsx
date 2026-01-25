import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { FolderOpen } from 'lucide-react';
import { StatusBadge } from '../ui';
import Card from '../ui/Card';
import { Text } from '../ui/Typography';

const AnalysisProgress = memo(function AnalysisProgress({
  progress = { current: 0, total: 0 },
  currentFile = '',
  surface = 'card',
  className = ''
}) {
  const total = Math.max(0, Number(progress.total) || 0);
  const current = Math.max(
    0,
    Math.min(Number(progress.current) || 0, total || Number(progress.current) || 0)
  );
  const hasTotals = total > 0;
  const isDone = hasTotals && current >= total;
  const percent = hasTotals ? Math.min(100, Math.round((current / total) * 100)) : 0;

  const Content = (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10">
            <div className="absolute inset-0 rounded-full border-2 border-stratosort-blue/25 border-t-stratosort-blue animate-spin" />
            <div className="absolute inset-2 rounded-full bg-stratosort-blue/10 flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-stratosort-blue" />
            </div>
          </div>
          <div>
            <Text variant="small" className="font-semibold text-system-gray-900">
              {isDone
                ? 'Analysis complete'
                : hasTotals
                  ? `Analyzing ${current} of ${total}`
                  : 'Preparing analysis...'}
            </Text>
            <Text variant="tiny" className="text-system-gray-600">
              {hasTotals ? `${percent}%` : 'Estimating remaining time'}
            </Text>
          </div>
        </div>
        {hasTotals && <StatusBadge variant="info">{percent}%</StatusBadge>}
      </div>

      <div className="space-y-3">
        {hasTotals ? (
          <div className="h-2 w-full bg-system-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-stratosort-blue transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
        ) : (
          <div className="h-2 w-full bg-system-gray-100 rounded-full overflow-hidden relative">
            <div className="absolute inset-y-0 left-0 w-1/3 bg-stratosort-blue animate-[shimmer_1.5s_infinite]" />
          </div>
        )}
        {currentFile && (
          <Text variant="tiny" className="text-system-gray-500 break-words truncate">
            {isDone ? 'Last processed:' : 'Currently processing:'}{' '}
            <span className="text-system-gray-700 font-medium">{currentFile}</span>
          </Text>
        )}
      </div>
    </div>
  );

  if (surface === 'none') {
    return Content;
  }

  return (
    <Card variant="default" className="p-5" role="status" aria-live="polite" aria-atomic="true">
      {Content}
    </Card>
  );
});

AnalysisProgress.propTypes = {
  progress: PropTypes.shape({
    current: PropTypes.number,
    total: PropTypes.number
  }),
  currentFile: PropTypes.string,
  surface: PropTypes.oneOf(['card', 'none']),
  className: PropTypes.string
};

export default AnalysisProgress;
