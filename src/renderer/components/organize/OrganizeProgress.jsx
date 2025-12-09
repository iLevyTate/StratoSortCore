import React, { useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { FolderOpen, CheckCircle, Clock, FileText } from 'lucide-react';

function OrganizeProgress({
  isOrganizing,
  batchProgress = { current: 0, total: 0, currentFile: '' },
  preview = [],
}) {
  const [startedAt, setStartedAt] = useState(null);
  const hasTotals = Number(batchProgress.total) > 0;
  const actualPercent = hasTotals
    ? Math.round(
        (Number(batchProgress.current) / Number(batchProgress.total)) * 100,
      )
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

  // Smooth, informative visual progress when real percent is unavailable
  useEffect(() => {
    if (!isOrganizing) return;
    if (hasTotals && actualPercent > 0) {
      setVisualPercent((prev) => Math.max(prev, actualPercent));
      return;
    }
    let rafId;
    let isMounted = true;
    const tick = () => {
      if (!isMounted) return;
      setVisualPercent((prev) => {
        // Ease towards 85% while waiting for real progress
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

  // Compute ETA only when totals are known and progress is non-zero
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
  }, [
    startedAt,
    hasTotals,
    actualPercent,
    batchProgress.current,
    batchProgress.total,
  ]);
  // batchProgress props are read for computation; lint incorrectly flags object properties

  if (!isOrganizing) return null;

  const percentToShow = hasTotals
    ? Math.max(visualPercent, actualPercent)
    : visualPercent;

  return (
    // py-12 (3rem vertical padding) provides optimal visual breathing room for the organization
    // progress display, ensuring the animated spinner, progress bars, and file preview list
    // are comfortably spaced without overwhelming the interface during file operations
    <div className="py-12">
      {/* Animated header */}
      <div className="flex items-center justify-center gap-8 text-stratosort-blue mb-8">
        <div className="relative w-21 h-21">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-stratosort-blue/30 border-t-stratosort-blue"></div>
          <div className="absolute inset-2 rounded-full bg-stratosort-blue/5 flex items-center justify-center">
            <FolderOpen className="w-5 h-5 text-stratosort-blue" />
          </div>
        </div>
        <div>
          <div className="text-lg font-medium">Organizing Files...</div>
          <div className="text-xs text-system-gray-600">
            Do not close the app until completion
          </div>
        </div>
      </div>

      {/* Progress */}
      <div className="mb-8">
        <div className="flex justify-between text-sm text-system-gray-600 mb-3">
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
        {hasTotals ? (
          <div className="progress-enhanced">
            <div
              className="progress-bar-enhanced"
              style={{ width: `${percentToShow}%` }}
            />
          </div>
        ) : (
          <div className="indeterminate-bar" />
        )}
        {batchProgress.currentFile && (
          <div className="text-xs text-system-gray-500 mt-3 break-words">
            Currently processing: {batchProgress.currentFile}
          </div>
        )}
        <div className="text-xs text-system-gray-500 mt-3">{etaText}</div>
      </div>

      {/* Preview upcoming or recent operations */}
      {Array.isArray(preview) && preview.length > 0 && (
        <div className="bg-system-gray-50 border border-system-gray-200 rounded-lg p-8 overflow-hidden">
          <div className="text-xs font-semibold text-system-gray-700 mb-5">
            Planned operations ({preview.length} files)
          </div>
          <div className="space-y-5 max-h-40 overflow-y-auto pr-5">
            {preview.slice(0, 6).map((op, idx) => {
              const isCurrentFile =
                batchProgress.currentFile &&
                op.fileName === batchProgress.currentFile;
              const isProcessed = hasTotals && idx < batchProgress.current;

              return (
                <div
                  key={op.destination || op.fileName || idx}
                  className={`flex items-start gap-3 text-sm ${isCurrentFile ? 'bg-stratosort-blue/10 -mx-2 px-2 py-1 rounded' : ''}`}
                >
                  <span className="mt-0.5 flex-shrink-0">
                    {isProcessed ? (
                      <CheckCircle className="w-4 h-4 text-stratosort-success" />
                    ) : isCurrentFile ? (
                      <Clock className="w-4 h-4 text-stratosort-blue animate-pulse" />
                    ) : (
                      <FileText className="w-4 h-4 text-system-gray-400" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div
                      className="font-medium text-system-gray-900 truncate"
                      title={op.fileName}
                    >
                      {op.fileName}
                    </div>
                    <div
                      className="text-xs text-system-gray-600 truncate"
                      title={op.destination}
                    >
                      → {op.destination}
                    </div>
                  </div>
                </div>
              );
            })}
            {preview.length > 6 && (
              <div className="text-xs text-system-gray-500 italic">
                ...and {preview.length - 6} more files
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

OrganizeProgress.propTypes = {
  isOrganizing: PropTypes.bool.isRequired,
  batchProgress: PropTypes.shape({
    current: PropTypes.number,
    total: PropTypes.number,
    currentFile: PropTypes.string,
  }),
  preview: PropTypes.arrayOf(
    PropTypes.shape({
      fileName: PropTypes.string,
      destination: PropTypes.string,
    }),
  ),
};

export default OrganizeProgress;
