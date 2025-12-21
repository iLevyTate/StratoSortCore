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

  const confidencePercent = toPercent(settings.confidenceThreshold, 0.75);

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

      {/* Confidence threshold */}
      {settings.autoOrganize && (
        <div className="ml-6 space-y-3 p-3 bg-system-gray-50 rounded-lg">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-system-gray-700">Minimum confidence</label>
              <span className="text-sm font-medium text-stratosort-blue">{confidencePercent}%</span>
            </div>
            <input
              type="range"
              min="50"
              max="95"
              step="5"
              value={confidencePercent}
              onChange={(e) => updateSetting('confidenceThreshold', fromPercent(e.target.value))}
              className="w-full accent-stratosort-blue"
            />
            <p className="text-xs text-system-gray-500">
              Files must meet this confidence level to be automatically organized. Lower values
              organize more files but may be less accurate.
            </p>
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
