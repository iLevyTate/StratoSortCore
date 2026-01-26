import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { FolderOpen, CheckCircle, Clock, FileText } from 'lucide-react';
import { formatDisplayPath } from '../../utils/pathDisplay';
import { Heading, Text } from '../ui/Typography';
import Card from '../ui/Card';

function OrganizeProgress({
  isOrganizing,
  batchProgress = { current: 0, total: 0, currentFile: '' },
  preview = []
}) {
  const redactPaths = useSelector((state) => Boolean(state?.system?.redactPaths));
  const [startedAt, setStartedAt] = useState(null);
  const hasTotals = Number(batchProgress.total) > 0;
  const actualPercent = hasTotals
    ? Math.round((Number(batchProgress.current) / Number(batchProgress.total)) * 100)
    : 0;
  const [visualPercent, setVisualPercent] = useState(0);

  useEffect(() => {
    if (!isOrganizing) {
      setStartedAt(null);
      setVisualPercent(0);
      return;
    }
    if (!startedAt) setStartedAt(Date.now());
  }, [isOrganizing, startedAt]);

  useEffect(() => {
    if (!isOrganizing) return undefined;
    if (hasTotals && actualPercent > 0) {
      setVisualPercent((prev) => Math.max(prev, actualPercent));
      return undefined;
    }
    let rafId;
    let isMounted = true;
    const tick = () => {
      if (!isMounted) return;
      setVisualPercent((prev) => {
        const next = prev + Math.max(0.2, (85 - prev) * 0.02);
        return Math.min(85, next);
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      isMounted = false;
      cancelAnimationFrame(rafId);
    };
  }, [isOrganizing, hasTotals, actualPercent]);

  const etaText = useMemo(() => {
    if (!startedAt || !hasTotals || actualPercent <= 0) return 'Estimating...';
    const elapsedMs = Date.now() - startedAt;
    const perUnit = elapsedMs / Math.max(1, batchProgress.current);
    const remaining = Math.max(0, batchProgress.total - batchProgress.current);
    const remainingSec = Math.round((perUnit * remaining) / 1000);
    if (remainingSec < 60) return `${remainingSec}s remaining`;
    const m = Math.floor(remainingSec / 60);
    const s = remainingSec % 60;
    return `${m}m ${s}s remaining`;
  }, [startedAt, hasTotals, actualPercent, batchProgress]);

  if (!isOrganizing) return null;

  const percentToShow = hasTotals ? Math.max(visualPercent, actualPercent) : visualPercent;

  return (
    <div className="py-8 w-full max-w-2xl mx-auto">
      <div className="flex items-center justify-center gap-6 text-stratosort-blue mb-8">
        <div className="relative w-16 h-16 flex-shrink-0">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-stratosort-blue/30 border-t-stratosort-blue" />
          <div className="absolute inset-2 rounded-full bg-stratosort-blue/5 flex items-center justify-center">
            <FolderOpen className="w-6 h-6 text-stratosort-blue" />
          </div>
        </div>
        <div>
          <Heading as="h3" variant="h4" className="text-stratosort-blue">
            Organizing Files...
          </Heading>
          <Text variant="small" className="text-system-gray-600">
            Do not close the app until completion
          </Text>
        </div>
      </div>

      <div className="mb-8">
        <div className="flex justify-between text-sm text-system-gray-600 mb-2 font-medium">
          <span>
            {hasTotals ? (
              <>
                Progress: {batchProgress.current} of {batchProgress.total}
              </>
            ) : (
              <>Working...</>
            )}
          </span>
          <span>{Math.round(percentToShow)}%</span>
        </div>

        <div className="h-3 w-full bg-system-gray-100 rounded-full overflow-hidden mb-3">
          {hasTotals ? (
            <div
              className="h-full bg-stratosort-blue transition-all duration-300 ease-out rounded-full"
              style={{ width: `${percentToShow}%` }}
            />
          ) : (
            <div className="h-full w-full bg-system-gray-200 relative overflow-hidden">
              <div className="absolute inset-y-0 left-0 w-1/3 bg-stratosort-blue animate-[shimmer_1.5s_infinite]" />
            </div>
          )}
        </div>

        {batchProgress.currentFile && (
          <Text variant="tiny" className="text-system-gray-500 break-words truncate">
            Currently processing:{' '}
            <span className="font-medium text-system-gray-700">
              {formatDisplayPath(batchProgress.currentFile, { redact: redactPaths, segments: 2 })}
            </span>
          </Text>
        )}
        <Text variant="tiny" className="text-system-gray-500 mt-1">
          {etaText}
        </Text>
      </div>

      {Array.isArray(preview) && preview.length > 0 && (
        <Card variant="static" className="p-0 overflow-hidden border-system-gray-200">
          <div className="px-4 py-3 bg-system-gray-50 border-b border-system-gray-200">
            <Text
              variant="tiny"
              className="font-semibold text-system-gray-700 uppercase tracking-wide"
            >
              Planned operations ({preview.length} files)
            </Text>
          </div>
          <div className="max-h-48 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {preview.slice(0, 6).map((op, idx) => {
              const isCurrentFile =
                batchProgress.currentFile && op.fileName === batchProgress.currentFile;
              const isProcessed = hasTotals && idx < batchProgress.current;

              return (
                <div
                  key={op.destination || op.fileName || idx}
                  className={`flex items-center gap-3 text-sm p-2 rounded-lg transition-colors ${
                    isCurrentFile ? 'bg-stratosort-blue/10' : 'hover:bg-system-gray-50'
                  }`}
                >
                  <span className="flex-shrink-0">
                    {isProcessed ? (
                      <CheckCircle className="w-4 h-4 text-stratosort-success" />
                    ) : isCurrentFile ? (
                      <Clock className="w-4 h-4 text-stratosort-blue animate-pulse" />
                    ) : (
                      <FileText className="w-4 h-4 text-system-gray-400" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden grid grid-cols-2 gap-4">
                    <div className="font-medium text-system-gray-900 truncate" title={op.fileName}>
                      {op.fileName}
                    </div>
                    <Text
                      as="div"
                      variant="tiny"
                      className="text-system-gray-500 truncate flex items-center"
                      title={formatDisplayPath(op.destination, {
                        redact: redactPaths,
                        segments: 2
                      })}
                    >
                      <span className="mr-1">→</span>
                      {formatDisplayPath(op.destination, { redact: redactPaths, segments: 2 })}
                    </Text>
                  </div>
                </div>
              );
            })}
            {preview.length > 6 && (
              <Text variant="tiny" className="text-system-gray-500 italic text-center py-2">
                ...and {preview.length - 6} more files
              </Text>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

OrganizeProgress.propTypes = {
  isOrganizing: PropTypes.bool.isRequired,
  batchProgress: PropTypes.shape({
    current: PropTypes.number,
    total: PropTypes.number,
    currentFile: PropTypes.string
  }),
  preview: PropTypes.arrayOf(
    PropTypes.shape({
      fileName: PropTypes.string,
      destination: PropTypes.string
    })
  )
};

export default OrganizeProgress;
