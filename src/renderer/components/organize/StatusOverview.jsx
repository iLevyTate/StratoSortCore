import React, { memo } from 'react';
import PropTypes from 'prop-types';
import { FolderCheck, CheckCircle2, AlertTriangle } from 'lucide-react';
import Card from '../ui/Card';
import { Text, Heading } from '../ui/Typography';

const StatusOverview = memo(function StatusOverview({
  unprocessedCount = 0,
  processedCount = 0,
  failedCount = 0
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card variant="default" className="text-center p-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-stratosort-blue/10 text-stratosort-blue">
            <FolderCheck className="w-4 h-4" aria-hidden />
          </span>
          <Text
            variant="tiny"
            className="font-semibold text-stratosort-blue/80 uppercase tracking-wide"
          >
            Ready to Organize
          </Text>
        </div>
        <Heading as="div" variant="h3" className="text-stratosort-blue">
          {unprocessedCount}
        </Heading>
      </Card>

      <Card variant="default" className="text-center p-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-stratosort-success/10 text-stratosort-success">
            <CheckCircle2 className="w-4 h-4" aria-hidden />
          </span>
          <Text
            variant="tiny"
            className="font-semibold text-stratosort-success/90 uppercase tracking-wide"
          >
            Already Organized
          </Text>
        </div>
        <Heading as="div" variant="h3" className="text-stratosort-success">
          {processedCount}
        </Heading>
      </Card>

      <Card variant="default" className="text-center p-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-stratosort-danger/10 text-stratosort-danger">
            <AlertTriangle className="w-4 h-4" aria-hidden />
          </span>
          <Text
            variant="tiny"
            className="font-semibold text-stratosort-danger/80 uppercase tracking-wide"
          >
            Failed Analysis
          </Text>
        </div>
        <Heading as="div" variant="h3" className="text-stratosort-danger">
          {failedCount}
        </Heading>
      </Card>
    </div>
  );
});

StatusOverview.propTypes = {
  unprocessedCount: PropTypes.number,
  processedCount: PropTypes.number,
  failedCount: PropTypes.number
};

export default StatusOverview;
