import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import {
  BarChart2,
  TrendingUp,
  ClipboardList,
  Download,
  Folder,
  RefreshCw,
  FileText
} from 'lucide-react';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import Modal, { ConfirmModal } from './Modal';
import Button from './ui/Button';

logger.setContext('AnalysisHistoryModal');

function AnalysisHistoryModal({ onClose, analysisStats, setAnalysisStats }) {
  const { addNotification } = useNotification();
  const [historyData, setHistoryData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('statistics');
  // FIX H3: Track if initial load has been done to prevent infinite loop
  const hasLoadedRef = React.useRef(false);
  // FIX: Track mounted state to prevent state updates after unmount
  const isMountedRef = React.useRef(true);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // FIX: Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAnalysisData = useCallback(async () => {
    setIsLoading(true);

    // PERF FIX: Fetch each data source independently instead of Promise.all
    // This allows the UI to update as soon as each response arrives,
    // rather than waiting for the slowest request to complete.
    let loadedCount = 0;
    const totalLoads = 2;

    const markLoaded = () => {
      loadedCount++;
      if (loadedCount >= totalLoads && isMountedRef.current) {
        setIsLoading(false);
      }
    };

    // Fetch statistics
    window.electronAPI.analysisHistory
      .getStatistics()
      .then((stats) => {
        if (isMountedRef.current) {
          setAnalysisStats(stats);
        }
      })
      .catch((error) => {
        if (isMountedRef.current) {
          logger.warn('Failed to load statistics', { error: error?.message });
        }
      })
      .finally(markLoaded);

    // Fetch history
    window.electronAPI.analysisHistory
      .get({ all: true })
      .then((history) => {
        if (!isMountedRef.current) return;
        // FIX H1: Validate history is an array before setting
        if (Array.isArray(history)) {
          setHistoryData(history);
        } else {
          logger.warn('History data is not an array, falling back to empty array', {
            historyType: typeof history,
            history
          });
          setHistoryData([]);
        }
      })
      .catch((error) => {
        if (isMountedRef.current) {
          addNotification('Failed to load analysis history', 'error');
          logger.warn('Failed to load history', { error: error?.message });
        }
      })
      .finally(markLoaded);
  }, [addNotification, setAnalysisStats]);

  useEffect(() => {
    // FIX H3: Only load data once on mount to prevent infinite re-renders
    if (hasLoadedRef.current) {
      return;
    }
    hasLoadedRef.current = true;
    loadAnalysisData();
  }, [loadAnalysisData]);

  const exportHistory = async (format) => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const exportResponse = await window.electronAPI.analysisHistory.export(format);
      if (!exportResponse || exportResponse.success === false)
        throw new Error(exportResponse?.error || 'Export failed');
      const blob = new Blob(
        [
          typeof exportResponse.data === 'string'
            ? exportResponse.data
            : JSON.stringify(exportResponse.data)
        ],
        {
          type: exportResponse.mime || (format === 'csv' ? 'text/csv' : 'application/json')
        }
      );
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = exportResponse.filename || `analysis-history.${format}`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      URL.revokeObjectURL(url);
      addNotification(`Analysis history exported as ${format.toUpperCase()}`, 'success');
    } catch (error) {
      addNotification('Export failed', 'error');
    } finally {
      if (isMountedRef.current) {
        setIsExporting(false);
      }
    }
  };

  const doClearHistory = useCallback(async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      const result = await window.electronAPI.analysisHistory.clear();
      if (result?.success === false) {
        throw new Error(result?.error || 'Failed to clear history');
      }
      await loadAnalysisData();
      addNotification('Analysis history cleared', 'success');
    } catch (error) {
      addNotification('Failed to clear analysis history', 'error');
    } finally {
      if (isMountedRef.current) {
        setIsClearing(false);
      }
    }
  }, [isClearing, loadAnalysisData, addNotification]);

  const handleClearClick = useCallback(() => {
    setShowClearConfirm(true);
  }, []);

  const getDestinationLabel = (entry) => {
    try {
      const actual = entry?.organization?.actual;
      if (actual && typeof actual === 'string') {
        const normalized = actual.replace(/\\+/g, '/');
        const segments = normalized.split('/').filter(Boolean);
        if (segments.length > 1) {
          const last = segments[segments.length - 1];
          const isFile = /\.[A-Za-z0-9]+$/.test(last);
          const folder = isFile ? segments[segments.length - 2] : last;
          if (folder) return folder;
        }
      }
      if (entry?.organization?.smartFolder) return entry.organization.smartFolder;
      if (entry?.analysis?.category) return entry.analysis.category;
    } catch (error) {
      logger.debug('Error generating category label', { error: error.message });
    }
    return 'Uncategorized';
  };

  const getConfidenceColor = (confidence) => {
    if (!confidence) return 'text-system-gray-500 bg-system-gray-100';
    if (confidence >= 90)
      return 'text-stratosort-success bg-stratosort-success/10 border-stratosort-success/20';
    if (confidence >= 70)
      return 'text-stratosort-blue bg-stratosort-blue/10 border-stratosort-blue/20';
    if (confidence >= 50)
      return 'text-stratosort-warning bg-stratosort-warning/10 border-stratosort-warning/20';
    return 'text-stratosort-danger bg-stratosort-danger/10 border-stratosort-danger/20';
  };

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-stratosort-blue" /> Analysis History & Statistics
          </span>
        }
        size="large"
      >
        {/* Tabs */}
        <div className="flex mb-4 border-b border-system-gray-200 -mt-2">
          <button
            onClick={() => setSelectedTab('statistics')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              selectedTab === 'statistics'
                ? 'border-stratosort-blue text-stratosort-blue'
                : 'border-transparent text-system-gray-500 hover:text-system-gray-700'
            }`}
          >
            <TrendingUp className="w-4 h-4" /> Statistics
          </button>
          <button
            onClick={() => setSelectedTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              selectedTab === 'history'
                ? 'border-stratosort-blue text-stratosort-blue'
                : 'border-transparent text-system-gray-500 hover:text-system-gray-700'
            }`}
          >
            <ClipboardList className="w-4 h-4" /> History
          </button>
        </div>

        {/* Content */}
        <div className="min-h-[300px]">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-12 h-12 border-4 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-4" />
              <p>Loading analysis data...</p>
            </div>
          ) : (
            <>
              {selectedTab === 'statistics' && analysisStats && (
                <div className="space-y-5 animate-fade-in">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center transition-all hover:shadow-md">
                      <div className="text-2xl font-bold text-stratosort-blue">
                        {analysisStats.totalFiles || 0}
                      </div>
                      <div className="text-sm text-system-gray-600">Total Files</div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center transition-all hover:shadow-md">
                      <div className="text-2xl font-bold text-stratosort-success">
                        {Math.round(analysisStats.averageConfidence || 0)}%
                      </div>
                      <div className="text-sm text-system-gray-600">Avg Confidence</div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center transition-all hover:shadow-md">
                      <div className="text-2xl font-bold text-stratosort-indigo">
                        {analysisStats.categoriesCount || 0}
                      </div>
                      <div className="text-sm text-system-gray-600">Categories</div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center transition-all hover:shadow-md">
                      <div className="text-2xl font-bold text-stratosort-warning">
                        {Math.round(analysisStats.averageProcessingTime || 0)}ms
                      </div>
                      <div className="text-sm text-system-gray-600">Avg Time</div>
                    </div>
                  </div>
                  <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)]">
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                      <Download className="w-4 h-4" /> Export Options
                    </h3>
                    <div className="flex gap-4">
                      <Button
                        onClick={() => exportHistory('json')}
                        variant="outline"
                        className="text-sm"
                        disabled={isExporting}
                        isLoading={isExporting}
                      >
                        {isExporting ? 'Exporting...' : 'Export JSON'}
                      </Button>
                      <Button
                        onClick={() => exportHistory('csv')}
                        variant="outline"
                        className="text-sm"
                        disabled={isExporting}
                        isLoading={isExporting}
                      >
                        {isExporting ? 'Exporting...' : 'Export CSV'}
                      </Button>
                      <Button
                        onClick={handleClearClick}
                        variant="danger"
                        className="text-sm ml-auto"
                        disabled={isClearing}
                      >
                        {isClearing ? 'Clearing...' : 'Clear History'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {selectedTab === 'history' && (
                <div className="space-y-4 animate-fade-in">
                  <div className="flex justify-between items-center px-1">
                    <h3 className="text-sm font-semibold text-system-gray-500 uppercase tracking-wider">
                      Recent Analysis
                    </h3>
                    <Button
                      onClick={loadAnalysisData}
                      variant="ghost"
                      size="sm"
                      className="text-system-gray-500 hover:text-stratosort-blue h-8"
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
                    </Button>
                  </div>

                  <div className="space-y-3 max-h-[50vh] overflow-y-auto modern-scrollbar pr-2 pb-2">
                    {/* FIX: Use stable identifier instead of array index as key */}
                    {/* FIX H1: Add defensive check for historyData being an array */}
                    {(Array.isArray(historyData) ? historyData : []).map((entry) => (
                      <div
                        key={entry.id || entry.filePath || entry.timestamp || entry.fileName}
                        className="group bg-surface-primary rounded-xl border border-border-soft p-4 hover:shadow-md hover:border-stratosort-blue/30 transition-all duration-200"
                      >
                        <div className="flex items-start gap-4">
                          <div className="p-2.5 rounded-lg bg-system-gray-50 text-stratosort-blue border border-system-gray-100 group-hover:bg-stratosort-blue/5 group-hover:border-stratosort-blue/10 transition-colors">
                            <FileText className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start gap-4">
                              <div className="min-w-0">
                                <h4
                                  className="font-medium text-system-gray-900 truncate"
                                  title={entry.fileName}
                                >
                                  {entry.fileName || 'Unknown File'}
                                </h4>
                                <div className="flex items-center gap-2 mt-1 text-sm text-system-gray-500 flex-wrap">
                                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-system-gray-50 border border-system-gray-100">
                                    <Folder className="w-3 h-3" />
                                    <span className="truncate max-w-[200px]">
                                      {getDestinationLabel(entry)}
                                    </span>
                                  </span>
                                  <span className="text-system-gray-300">•</span>
                                  <span className="text-xs">
                                    {entry.timestamp
                                      ? new Date(entry.timestamp).toLocaleDateString()
                                      : 'Unknown Date'}
                                  </span>
                                </div>
                              </div>
                              {(entry?.analysis?.confidence || entry?.confidence) && (
                                <div
                                  className={`px-2.5 py-1 rounded-full text-xs font-medium border flex-shrink-0 ${getConfidenceColor(entry?.analysis?.confidence || entry?.confidence)}`}
                                >
                                  {entry?.analysis?.confidence || entry?.confidence}% Match
                                </div>
                              )}
                            </div>

                            {/* Keywords/Tags */}
                            {(entry.keywords?.length > 0 || entry.analysis?.tags?.length > 0) && (
                              <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-system-gray-50 group-hover:border-system-gray-100 transition-colors">
                                {/* FIX: Include index to handle duplicate keywords in same entry */}
                                {(entry.keywords || entry.analysis?.tags || [])
                                  .slice(0, 5)
                                  .map((tag, idx) => (
                                    <span
                                      key={`${entry.id || entry.filePath || entry.timestamp}-kw-${idx}-${tag}`}
                                      className="text-xs px-2 py-0.5 rounded-full bg-system-gray-50 text-system-gray-600 border border-system-gray-200 group-hover:bg-white transition-colors"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                {(entry.keywords?.length > 5 ||
                                  entry.analysis?.tags?.length > 5) && (
                                  <span className="text-xs px-2 py-0.5 text-system-gray-400">
                                    +{(entry.keywords || entry.analysis?.tags || []).length - 5}{' '}
                                    more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {(Array.isArray(historyData) ? historyData : []).length === 0 && (
                      <div className="empty-state py-12 text-center border-2 border-dashed border-system-gray-200 rounded-xl bg-system-gray-50/50">
                        <Folder className="w-12 h-12 text-system-gray-400 mx-auto mb-3" />
                        <div className="space-y-1">
                          <p className="text-system-gray-800 font-semibold">
                            No analysis history yet
                          </p>
                          <p className="text-system-gray-500 text-sm max-w-xs mx-auto">
                            Run an analysis to see recent activity and export options here.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* Clear history confirmation modal */}
      <ConfirmModal
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={doClearHistory}
        title="Clear All History?"
        message="This will permanently delete all analysis history and statistics. This action cannot be undone."
        confirmText="Clear All"
        cancelText="Cancel"
        variant="danger"
      />
    </>
  );
}

AnalysisHistoryModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  analysisStats: PropTypes.shape({
    totalFiles: PropTypes.number,
    averageConfidence: PropTypes.number,
    categoriesCount: PropTypes.number,
    averageProcessingTime: PropTypes.number
  }),
  setAnalysisStats: PropTypes.func.isRequired
};

export default AnalysisHistoryModal;
