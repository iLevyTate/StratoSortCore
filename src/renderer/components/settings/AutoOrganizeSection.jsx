import React from 'react';
import PropTypes from 'prop-types';

function AutoOrganizeSection({ settings, setSettings }) {
  const updateSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const clamp01 = (val, fallback = 0) => {
    if (val === null || val === undefined || Number.isNaN(val)) return fallback;
    return Math.min(1, Math.max(0, val));
  };

  const toPercent = (val, fallback) => Math.round(clamp01(val, fallback) * 100);
  const fromPercent = (val) => clamp01(Number(val) / 100, 0);

  return (
    <div className="space-y-4">
      {/* Auto-organize toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.autoOrganize}
          onChange={(e) => updateSetting('autoOrganize', e.target.checked)}
          className="form-checkbox accent-stratosort-blue"
        />
        <span className="text-sm text-system-gray-700">Automatically organize new downloads</span>
      </label>

      {/* Confidence thresholds */}
      {settings.autoOrganize && (
        <div className="ml-6 space-y-3 p-3 bg-system-gray-50 rounded-lg">
          <h4 className="text-xs font-medium text-system-gray-600 uppercase tracking-wider">
            Confidence Thresholds
          </h4>

          {/* Auto-approve threshold */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-system-gray-700">Auto-approve confidence</label>
              <span className="text-sm font-medium text-stratosort-blue">
                {toPercent(settings.autoApproveThreshold, 0.8)}%
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="100"
              step="1"
              value={toPercent(settings.autoApproveThreshold, 0.8)}
              onChange={(e) => updateSetting('autoApproveThreshold', fromPercent(e.target.value))}
              className="w-full accent-stratosort-blue"
            />
            <p className="text-xs text-system-gray-500">
              Files above this confidence are organized automatically
            </p>
          </div>

          {/* Download confidence threshold */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-system-gray-700">Downloads confidence</label>
              <span className="text-sm font-medium text-stratosort-blue">
                {toPercent(settings.downloadConfidenceThreshold, 0.9)}%
              </span>
            </div>
            <input
              type="range"
              min="70"
              max="100"
              step="1"
              value={toPercent(settings.downloadConfidenceThreshold, 0.9)}
              onChange={(e) =>
                updateSetting('downloadConfidenceThreshold', fromPercent(e.target.value))
              }
              className="w-full accent-stratosort-blue"
            />
            <p className="text-xs text-system-gray-500">
              Higher threshold for automatic download organization
            </p>
          </div>

          {/* Review threshold */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-system-gray-700">Review threshold</label>
              <span className="text-sm font-medium text-amber-600">
                {toPercent(settings.reviewThreshold, 0.5)}%
              </span>
            </div>
            <input
              type="range"
              min="30"
              max="80"
              step="1"
              value={toPercent(settings.reviewThreshold, 0.5)}
              onChange={(e) => updateSetting('reviewThreshold', fromPercent(e.target.value))}
              className="w-full accent-stratosort-blue"
            />
            <p className="text-xs text-system-gray-500">Files below this need manual review</p>
          </div>

          {/* Visual confidence guide */}
          <div className="mt-3 p-2 bg-white rounded border border-system-gray-200">
            <div className="text-xs text-system-gray-600 mb-2">Confidence Guide:</div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span>≥80% - Auto-organize</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span>50-79% - Review suggested</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                <span>&lt;50% - Manual review required</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

AutoOrganizeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default AutoOrganizeSection;
