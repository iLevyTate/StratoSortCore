import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

// Convert bytes to MB for display
const bytesToMB = (bytes) => Math.round(bytes / (1024 * 1024));
// Convert MB to bytes for storage
const mbToBytes = (mb) => mb * 1024 * 1024;
// Convert ms to seconds for display
const msToSeconds = (ms) => Math.round(ms / 1000);
// Convert seconds to ms for storage
const secondsToMs = (s) => s * 1000;

/**
 * Processing limits section for file size and timeout settings
 */
function ProcessingLimitsSection({ settings, setSettings }) {
  // Memoize the display values
  const displayValues = useMemo(
    () => ({
      maxTextFileSize: bytesToMB(settings.maxTextFileSize || 50 * 1024 * 1024),
      maxImageFileSize: bytesToMB(settings.maxImageFileSize || 100 * 1024 * 1024),
      maxDocumentFileSize: bytesToMB(settings.maxDocumentFileSize || 200 * 1024 * 1024),
      analysisTimeout: msToSeconds(settings.analysisTimeout || 60000),
      maxBatchSize: settings.maxBatchSize || 100,
      retryAttempts: settings.retryAttempts || 3
    }),
    [settings]
  );

  const handleFileSizeChange = (key, valueMB) => {
    setSettings((prev) => ({
      ...prev,
      [key]: mbToBytes(valueMB)
    }));
  };

  const handleTimeoutChange = (key, valueSeconds) => {
    setSettings((prev) => ({
      ...prev,
      [key]: secondsToMs(valueSeconds)
    }));
  };

  const handleNumberChange = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: parseInt(value, 10) || 0
    }));
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          File Size Limits
        </label>
        <p className="text-xs text-system-gray-500 mb-3">
          Maximum file sizes for different content types. Larger files will be skipped during
          analysis.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-system-gray-600 mb-1">Text Files (MB)</label>
            <input
              type="number"
              min={1}
              max={200}
              value={displayValues.maxTextFileSize}
              onChange={(e) =>
                handleFileSizeChange('maxTextFileSize', parseInt(e.target.value, 10))
              }
              className="w-full px-3 py-2 border border-system-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-system-gray-600 mb-1">Images (MB)</label>
            <input
              type="number"
              min={1}
              max={500}
              value={displayValues.maxImageFileSize}
              onChange={(e) =>
                handleFileSizeChange('maxImageFileSize', parseInt(e.target.value, 10))
              }
              className="w-full px-3 py-2 border border-system-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-system-gray-600 mb-1">Documents (MB)</label>
            <input
              type="number"
              min={1}
              max={500}
              value={displayValues.maxDocumentFileSize}
              onChange={(e) =>
                handleFileSizeChange('maxDocumentFileSize', parseInt(e.target.value, 10))
              }
              className="w-full px-3 py-2 border border-system-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
            />
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-system-gray-200">
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Processing Parameters
        </label>
        <p className="text-xs text-system-gray-500 mb-3">
          Control analysis timing and batch processing behavior.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-system-gray-600 mb-1">
              Analysis Timeout (sec)
            </label>
            <input
              type="number"
              min={10}
              max={600}
              value={displayValues.analysisTimeout}
              onChange={(e) => handleTimeoutChange('analysisTimeout', parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-system-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-system-gray-600 mb-1">Max Batch Size</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={displayValues.maxBatchSize}
              onChange={(e) => handleNumberChange('maxBatchSize', e.target.value)}
              className="w-full px-3 py-2 border border-system-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs text-system-gray-600 mb-1">Retry Attempts</label>
            <input
              type="number"
              min={0}
              max={10}
              value={displayValues.retryAttempts}
              onChange={(e) => handleNumberChange('retryAttempts', e.target.value)}
              className="w-full px-3 py-2 border border-system-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-stratosort-blue focus:border-transparent"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

ProcessingLimitsSection.propTypes = {
  settings: PropTypes.shape({
    maxTextFileSize: PropTypes.number,
    maxImageFileSize: PropTypes.number,
    maxDocumentFileSize: PropTypes.number,
    analysisTimeout: PropTypes.number,
    maxBatchSize: PropTypes.number,
    retryAttempts: PropTypes.number
  }).isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ProcessingLimitsSection;
