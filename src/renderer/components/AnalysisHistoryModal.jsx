import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { TrendingUp, ClipboardList, Download, Folder, RefreshCw, FileText } from 'lucide-react';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import Modal, { ConfirmModal } from './ui/Modal';
import Button from './ui/Button';
import Card from './ui/Card';
import { Heading, Text } from './ui/Typography';
import { StatusBadge, StateMessage } from './ui';
import { Inline, Stack } from './layout';

logger.setContext('AnalysisHistoryModal');

function AnalysisHistoryModal({ onClose, analysisStats, setAnalysisStats }) {
  const { addNotification } = useNotification();
  const [historyData, setHistoryData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('statistics');
  const hasLoadedRef = React.useRef(false);
  const isMountedRef = React.useRef(true);
  const [isClearing, setIsClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAnalysisData = useCallback(async () => {
    setIsLoading(true);

    let loadedCount = 0;
    const totalLoads = 2;

    const markLoaded = () => {
      loadedCount++;
      if (loadedCount >= totalLoads && isMountedRef.current) {
        setIsLoading(false);
      }
    };

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

    window.electronAPI.analysisHistory
      .get({ all: true })
      .then((history) => {
        if (!isMountedRef.current) return;
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
    } catch {
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
    } catch {
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

  const getConfidenceVariant = (confidence) => {
    if (!confidence) return 'info';
    if (confidence >= 90) return 'success';
    if (confidence >= 70) return 'info';
    if (confidence >= 50) return 'warning';
    return 'error';
  };

  return (
    <>
      <Modal isOpen onClose={onClose} title="Analysis History & Statistics" size="lg">
        <Stack gap="default">
          {/* Tabs */}
          <div className="flex border-b border-system-gray-200">
            <button
              onClick={() => setSelectedTab('statistics')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                selectedTab === 'statistics'
                  ? 'border-stratosort-blue text-stratosort-blue'
                  : 'border-transparent text-system-gray-500 hover:text-system-gray-700'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Statistics</span>
            </button>
            <button
              onClick={() => setSelectedTab('history')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                selectedTab === 'history'
                  ? 'border-stratosort-blue text-stratosort-blue'
                  : 'border-transparent text-system-gray-500 hover:text-system-gray-700'
              }`}
            >
              <ClipboardList className="w-4 h-4" />
              <span>History</span>
            </button>
          </div>

          {/* Content */}
          <div className="min-h-[300px]">
            {isLoading ? (
              <div className="text-center p-8">
                <div className="animate-spin w-12 h-12 border-4 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-4" />
                <Text variant="small" className="text-system-gray-500">
                  Loading analysis data...
                </Text>
              </div>
            ) : (
              <>
                {selectedTab === 'statistics' && analysisStats && (
                  <Stack gap="relaxed" className="animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <Card variant="default" className="text-center p-4">
                        <Heading as="div" variant="h3" className="text-stratosort-blue mb-1">
                          {analysisStats.totalFiles || 0}
                        </Heading>
                        <Text
                          variant="tiny"
                          className="text-system-gray-500 uppercase tracking-wide font-medium"
                        >
                          Total Files
                        </Text>
                      </Card>
                      <Card variant="default" className="text-center p-4">
                        <Heading as="div" variant="h3" className="text-stratosort-success mb-1">
                          {Math.round(analysisStats.averageConfidence || 0)}%
                        </Heading>
                        <Text
                          variant="tiny"
                          className="text-system-gray-500 uppercase tracking-wide font-medium"
                        >
                          Avg Confidence
                        </Text>
                      </Card>
                      <Card variant="default" className="text-center p-4">
                        <Heading as="div" variant="h3" className="text-stratosort-indigo mb-1">
                          {analysisStats.categoriesCount || 0}
                        </Heading>
                        <Text
                          variant="tiny"
                          className="text-system-gray-500 uppercase tracking-wide font-medium"
                        >
                          Categories
                        </Text>
                      </Card>
                      <Card variant="default" className="text-center p-4">
                        <Heading as="div" variant="h3" className="text-stratosort-warning mb-1">
                          {Math.round(analysisStats.averageProcessingTime || 0)}ms
                        </Heading>
                        <Text
                          variant="tiny"
                          className="text-system-gray-500 uppercase tracking-wide font-medium"
                        >
                          Avg Time
                        </Text>
                      </Card>
                    </div>

                    <Card variant="default" className="p-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Download className="w-4 h-4 text-system-gray-500" />
                        <Heading as="h4" variant="h6">
                          Export Options
                        </Heading>
                      </div>
                      <Inline gap="cozy">
                        <Button
                          onClick={() => exportHistory('json')}
                          variant="secondary"
                          size="sm"
                          disabled={isExporting}
                          isLoading={isExporting}
                        >
                          Export JSON
                        </Button>
                        <Button
                          onClick={() => exportHistory('csv')}
                          variant="secondary"
                          size="sm"
                          disabled={isExporting}
                          isLoading={isExporting}
                        >
                          Export CSV
                        </Button>
                        <div className="flex-1" />
                        <Button
                          onClick={handleClearClick}
                          variant="danger"
                          size="sm"
                          disabled={isClearing}
                        >
                          {isClearing ? 'Clearing...' : 'Clear History'}
                        </Button>
                      </Inline>
                    </Card>
                  </Stack>
                )}
                {selectedTab === 'history' && (
                  <Stack gap="default" className="animate-fade-in">
                    <div className="flex justify-between items-center">
                      <Heading as="h4" variant="h6">
                        Recent Analysis
                      </Heading>
                      <Button
                        onClick={loadAnalysisData}
                        variant="ghost"
                        size="sm"
                        className="text-system-gray-500 hover:text-stratosort-blue h-8"
                      >
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                        Refresh
                      </Button>
                    </div>

                    <div className="space-y-3 max-h-[50vh] overflow-y-auto modern-scrollbar pr-2 pb-2">
                      {(Array.isArray(historyData) ? historyData : []).map((entry) => (
                        <Card
                          key={entry.id || entry.filePath || entry.timestamp || entry.fileName}
                          variant="interactive"
                          className="p-4"
                        >
                          <div className="flex items-start gap-4">
                            <div className="p-2.5 rounded-lg bg-system-gray-50 text-stratosort-blue border border-system-gray-100 shrink-0">
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-start gap-4 mb-1">
                                <div className="min-w-0">
                                  <Text
                                    variant="body"
                                    className="font-medium text-system-gray-900 truncate"
                                    title={entry.fileName}
                                  >
                                    {entry.fileName || 'Unknown File'}
                                  </Text>
                                  <div className="flex items-center gap-2 mt-1 text-sm text-system-gray-500 flex-wrap">
                                    <Text
                                      as="span"
                                      variant="tiny"
                                      className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-system-gray-50 border border-system-gray-100"
                                    >
                                      <Folder className="w-3 h-3" />
                                      <span className="truncate max-w-[200px]">
                                        {getDestinationLabel(entry)}
                                      </span>
                                    </Text>
                                    <span className="text-system-gray-300">•</span>
                                    <Text as="span" variant="tiny">
                                      {entry.timestamp
                                        ? new Date(entry.timestamp).toLocaleDateString()
                                        : 'Unknown Date'}
                                    </Text>
                                  </div>
                                </div>
                                {(entry?.analysis?.confidence || entry?.confidence) && (
                                  <StatusBadge
                                    variant={getConfidenceVariant(
                                      entry?.analysis?.confidence || entry?.confidence
                                    )}
                                    className="shrink-0"
                                  >
                                    {entry?.analysis?.confidence || entry?.confidence}% Match
                                  </StatusBadge>
                                )}
                              </div>

                              {(entry.keywords?.length > 0 || entry.analysis?.tags?.length > 0) && (
                                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-system-gray-50">
                                  {(entry.keywords || entry.analysis?.tags || [])
                                    .slice(0, 5)
                                    .map((tag, idx) => (
                                      <Text
                                        as="span"
                                        variant="tiny"
                                        key={`${entry.id || entry.filePath || entry.timestamp}-kw-${idx}-${tag}`}
                                        className="px-2 py-0.5 rounded-full bg-system-gray-50 text-system-gray-600 border border-system-gray-200"
                                      >
                                        {tag}
                                      </Text>
                                    ))}
                                  {(entry.keywords?.length > 5 ||
                                    entry.analysis?.tags?.length > 5) && (
                                    <Text
                                      as="span"
                                      variant="tiny"
                                      className="px-2 py-0.5 text-system-gray-400"
                                    >
                                      +{(entry.keywords || entry.analysis?.tags || []).length - 5}{' '}
                                      more
                                    </Text>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </Card>
                      ))}
                      {(Array.isArray(historyData) ? historyData : []).length === 0 && (
                        <StateMessage
                          icon={Folder}
                          tone="neutral"
                          size="lg"
                          title="No analysis history yet"
                          description="Run an analysis to see recent activity and export options here."
                          className="p-8 border-2 border-dashed border-system-gray-200 rounded-xl bg-system-gray-50/50"
                          contentClassName="max-w-xs"
                        />
                      )}
                    </div>
                  </Stack>
                )}
              </>
            )}
          </div>
        </Stack>
      </Modal>

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
