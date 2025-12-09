import React, { memo } from 'react';
import PropTypes from 'prop-types';

const StatusOverview = memo(function StatusOverview({
  unprocessedCount = 0,
  processedCount = 0,
  failedCount = 0,
}) {
  return (
    <div className="stats-grid">
      <div className="surface-card text-center p-4">
        <div className="text-xs font-semibold text-stratosort-blue/80 mb-1 uppercase tracking-wide">
          Ready to Organize
        </div>
        <div className="text-xl font-bold text-stratosort-blue">
          {unprocessedCount}
        </div>
      </div>
      <div className="surface-card text-center p-4">
        <div className="text-xs font-semibold text-stratosort-success/90 mb-1 uppercase tracking-wide">
          Already Organized
        </div>
        <div className="text-xl font-bold text-stratosort-success">
          {processedCount}
        </div>
      </div>
      <div className="surface-card text-center p-4">
        <div className="text-xs font-semibold text-system-gray-600 mb-1 uppercase tracking-wide">
          Failed Analysis
        </div>
        <div className="text-xl font-bold text-system-gray-700">
          {failedCount}
        </div>
      </div>
    </div>
  );
});

StatusOverview.propTypes = {
  unprocessedCount: PropTypes.number,
  processedCount: PropTypes.number,
  failedCount: PropTypes.number,
};

export default StatusOverview;
