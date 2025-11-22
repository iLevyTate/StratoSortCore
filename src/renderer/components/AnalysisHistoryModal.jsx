import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { logger } from '../../shared/logger';
import { useNotification } from '../contexts/NotificationContext';
import Button from './ui/Button';
import Input from './ui/Input';

logger.setContext('AnalysisHistoryModal');

function AnalysisHistoryModal({ onClose, analysisStats, setAnalysisStats }) {
  const { addNotification } = useNotification();
  const [historyData, setHistoryData] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState('statistics');

  useEffect(() => {
    loadAnalysisData();
  }, []);

  const loadAnalysisData = async () => {
    setIsLoading(true);
    try {
      const [stats, history] = await Promise.all([
        window.electronAPI.analysisHistory.getStatistics(),
        window.electronAPI.analysisHistory.get({ all: true }),
      ]);
      setAnalysisStats(stats);
      setHistoryData(history);
    } catch (error) {
      addNotification('Failed to load analysis history', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const searchHistory = async () => {
    if (!searchQuery.trim()) return;
    try {
      const results = await window.electronAPI.analysisHistory.search(
        searchQuery,
        { limit: 200 },
      );
      setHistoryData(results);
    } catch (error) {
      addNotification('Search failed', 'error');
    }
  };

  const exportHistory = async (format) => {
    try {
      const exportResponse =
        await window.electronAPI.analysisHistory.export(format);
      if (!exportResponse || exportResponse.success === false)
        throw new Error(exportResponse?.error || 'Export failed');
      const blob = new Blob(
        [
          typeof exportResponse.data === 'string'
            ? exportResponse.data
            : JSON.stringify(exportResponse.data),
        ],
        {
          type:
            exportResponse.mime ||
            (format === 'csv' ? 'text/csv' : 'application/json'),
        },
      );
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download =
        exportResponse.filename || `analysis-history.${format}`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      URL.revokeObjectURL(url);
      addNotification(
        `Analysis history exported as ${format.toUpperCase()}`,
        'success',
      );
    } catch (error) {
      addNotification('Export failed', 'error');
    }
  };

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
      if (entry?.organization?.smartFolder)
        return entry.organization.smartFolder;
      if (entry?.analysis?.category) return entry.analysis.category;
    } catch {
      // Silently ignore errors in label generation
    }
    return 'Uncategorized';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[200]">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b border-system-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-system-gray-900">
              📊 Analysis History & Statistics
            </h2>
            <button
              onClick={onClose}
              className="text-system-gray-500 hover:text-system-gray-700 p-2"
            >
              ✕
            </button>
          </div>
          <div className="flex mt-4 border-b border-system-gray-200">
            <button
              onClick={() => setSelectedTab('statistics')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${selectedTab === 'statistics' ? 'border-stratosort-blue text-stratosort-blue' : 'border-transparent text-system-gray-500 hover:text-system-gray-700'}`}
            >
              📈 Statistics
            </button>
            <button
              onClick={() => setSelectedTab('history')}
              className={`px-4 py-2 text-sm font-medium border-b-2 ${selectedTab === 'history' ? 'border-stratosort-blue text-stratosort-blue' : 'border-transparent text-system-gray-500 hover:text-system-gray-700'}`}
            >
              📋 History
            </button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh] modern-scrollbar">
          {isLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin w-12 h-12 border-4 border-stratosort-blue border-t-transparent rounded-full mx-auto mb-4"></div>
              <p>Loading analysis data...</p>
            </div>
          ) : (
            <>
              {selectedTab === 'statistics' && analysisStats && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-surface-primary rounded-xl border border-border-light shadow-sm p-6 text-center">
                      <div className="text-2xl font-bold text-stratosort-blue">
                        {analysisStats.totalFiles || 0}
                      </div>
                      <div className="text-sm text-system-gray-600">
                        Total Files
                      </div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-light shadow-sm p-6 text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {Math.round(analysisStats.averageConfidence || 0)}%
                      </div>
                      <div className="text-sm text-system-gray-600">
                        Avg Confidence
                      </div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-light shadow-sm p-6 text-center">
                      <div className="text-2xl font-bold text-purple-600">
                        {analysisStats.categoriesCount || 0}
                      </div>
                      <div className="text-sm text-system-gray-600">
                        Categories
                      </div>
                    </div>
                    <div className="bg-surface-primary rounded-xl border border-border-light shadow-sm p-6 text-center">
                      <div className="text-2xl font-bold text-orange-600">
                        {Math.round(analysisStats.averageProcessingTime || 0)}ms
                      </div>
                      <div className="text-sm text-system-gray-600">
                        Avg Time
                      </div>
                    </div>
                  </div>
                  <div className="bg-surface-primary rounded-xl border border-border-light shadow-sm p-6">
                    <h3 className="font-semibold mb-4">📤 Export Options</h3>
                    <div className="flex gap-4">
                      <Button
                        onClick={() => exportHistory('json')}
                        variant="outline"
                        className="text-sm"
                      >
                        Export JSON
                      </Button>
                      <Button
                        onClick={() => exportHistory('csv')}
                        variant="outline"
                        className="text-sm"
                      >
                        Export CSV
                      </Button>
                    </div>
                  </div>
                </div>
              )}
              {selectedTab === 'history' && (
                <div className="space-y-6">
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
                              stack: error.stack,
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
                    {historyData.map((entry, index) => (
                      <div
                        key={index}
                        className="bg-surface-primary rounded-xl border border-border-light shadow-sm p-4"
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
                              {(entry?.analysis?.confidence ||
                                entry?.confidence) && (
                                <span className="ml-4">
                                  Confidence:{' '}
                                  {entry?.analysis?.confidence ??
                                    entry?.confidence}
                                  %
                                </span>
                              )}
                            </div>
                            {entry.keywords && entry.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {entry.keywords
                                  .slice(0, 5)
                                  .map((keyword, i) => (
                                    <span
                                      key={i}
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
                                  {entry.analysis.tags
                                    .slice(0, 5)
                                    .map((tag, i) => (
                                      <span
                                        key={i}
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
                    {historyData.length === 0 && (
                      <div className="text-center py-12 text-system-gray-500">
                        No analysis history found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

AnalysisHistoryModal.propTypes = {
  onClose: PropTypes.func.isRequired,
  analysisStats: PropTypes.shape({
    totalFiles: PropTypes.number,
    averageConfidence: PropTypes.number,
    categoriesCount: PropTypes.number,
    averageProcessingTime: PropTypes.number,
  }),
  setAnalysisStats: PropTypes.func.isRequired,
};

export default AnalysisHistoryModal;
