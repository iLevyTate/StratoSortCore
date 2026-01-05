import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { BarChart2, TrendingUp, ClipboardList, Download, Folder } from 'lucide-react';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import Modal, { ConfirmModal } from './Modal';
import Button from './ui/Button';
import Input from './ui/Input';

logger.setContext('AnalysisHistoryModal');

function AnalysisHistoryModal({ onClose, analysisStats, setAnalysisStats }) {
  const { addNotification } = useNotification();
  const [historyData, setHistoryData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
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

  const searchHistory = async () => {
    if (!searchQuery.trim()) return;
    try {
      const results = await window.electronAPI.analysisHistory.search(searchQuery, { limit: 200 });
      // FIX: Check if still mounted before updating state
      if (!isMountedRef.current) return;
      // FIX H1: Validate results is an array before setting
      setHistoryData(Array.isArray(results) ? results : []);
    } catch (error) {
      if (!isMountedRef.current) return;
      addNotification('Search failed', 'error');
    }
  };

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

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={
          <span className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5" /> Analysis History &amp; Statistics
          </span>
        }
        size="large"
      >
        {/* Tabs */}
        <div className="flex mb-4 border-b border-system-gray-200 -mt-2">
          <button
            onClick={() => setSelectedTab('statistics')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${selectedTab === 'statistics' ? 'border-stratosort-blue text-stratosort-blue' : 'border-transparent text-system-gray-500 hover:text-system-gray-700'}`}
          >
            <TrendingUp className="w-4 h-4" /> Statistics
          </button>
          <button
            onClick={() => setSelectedTab('history')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${selectedTab === 'history' ? 'border-stratosort-blue text-stratosort-blue' : 'border-transparent text-system-gray-500 hover:text-system-gray-700'}`}
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
                <div className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center">
                      <div className="text-2xl font-bold text-stratosort-blue">
                        {analysisStats.totalFiles || 0}
                      </div>
                      <div className="text-sm text-system-gray-600">Total Files</div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center">
                      <div className="text-2xl font-bold text-stratosort-success">
                        {Math.round(analysisStats.averageConfidence || 0)}%
                      </div>
                      <div className="text-sm text-system-gray-600">Avg Confidence</div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center">
                      <div className="text-2xl font-bold text-stratosort-indigo">
                        {analysisStats.categoriesCount || 0}
                      </div>
                      <div className="text-sm text-system-gray-600">Categories</div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-[var(--panel-padding)] text-center">
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
                <div className="space-y-5">
                  <div className="flex gap-4">
                    <Input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search analysis history..."
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          searchHistory().catch((error) => {
                            logger.error('Search failed', {
                              error: error.message,
                              stack: error.stack
                            });
                          });
                        }
                      }}
                    />
                    <Button onClick={searchHistory} variant="primary">
                      Search
                    </Button>
                    <Button onClick={loadAnalysisData} variant="outline">
                      Reset
                    </Button>
                  </div>
                  <div className="space-y-4 max-h-[50vh] overflow-y-auto modern-scrollbar">
                    {/* FIX: Use stable identifier instead of array index as key */}
                    {/* FIX H1: Add defensive check for historyData being an array */}
                    {(Array.isArray(historyData) ? historyData : []).map((entry) => (
                      <div
                        key={entry.id || entry.filePath || entry.timestamp || entry.fileName}
                        className="bg-surface-primary rounded-xl border border-border-soft shadow-sm p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-medium text-system-gray-900">
                              {entry.fileName || 'Unknown File'}
                            </div>
                            <div className="text-sm text-system-gray-600 mt-1">
                              <span className="text-stratosort-blue">
                                {getDestinationLabel(entry)}
                              </span>
                              {(entry?.analysis?.confidence || entry?.confidence) && (
                                <span className="ml-4">
                                  Confidence: {entry?.analysis?.confidence ?? entry?.confidence}%
                                </span>
                              )}
                            </div>
                            {entry.keywords && entry.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {/* FIX: Include index to handle duplicate keywords in same entry */}
                                {entry.keywords.slice(0, 5).map((keyword, idx) => (
                                  <span
                                    key={`${entry.id || entry.filePath || entry.timestamp}-kw-${idx}-${keyword}`}
                                    className="text-xs bg-stratosort-blue/10 text-stratosort-blue px-2 py-1 rounded-full"
                                  >
                                    {keyword}
                                  </span>
                                ))}
                              </div>
                            )}
                            {!entry.keywords &&
                              entry?.analysis?.tags &&
                              entry.analysis.tags.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {/* FIX: Include index to handle duplicate tags in same entry */}
                                  {entry.analysis.tags.slice(0, 5).map((tag, idx) => (
                                    <span
                                      key={`${entry.id || entry.filePath || entry.timestamp}-tag-${idx}-${tag}`}
                                      className="text-xs bg-stratosort-blue/10 text-stratosort-blue px-2 py-1 rounded-full"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </div>
                          <div className="text-xs text-system-gray-500">
                            {entry.timestamp
                              ? new Date(entry.timestamp).toLocaleDateString()
                              : 'Unknown Date'}
                          </div>
                        </div>
                      </div>
                    ))}
                    {(Array.isArray(historyData) ? historyData : []).length === 0 && (
                      <div className="empty-state">
                        <Folder className="w-10 h-10 text-system-gray-400 mx-auto" />
                        <div className="space-y-1">
                          <p className="text-system-gray-800 font-semibold">
                            No analysis history yet
                          </p>
                          <p className="text-system-gray-500 text-sm">
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
