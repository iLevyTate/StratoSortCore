import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

const DEFAULT_CONFIDENCE = 0.75; // 75%

/**
 * AutoOrganizeSection - Settings for automatic file organization
 *
 * Controls:
 * - autoOrganize: Enable/disable auto-organize for new downloads
 * - confidenceThreshold: Minimum confidence (0-1) required to auto-move files
 */
function AutoOrganizeSection({ settings, setSettings }) {
  const confidencePercent = useMemo(
    () => Math.round((settings.confidenceThreshold ?? DEFAULT_CONFIDENCE) * 100),
    [settings.confidenceThreshold]
  );

  return (
    <div className="space-y-4">
      {/* Auto-organize toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.autoOrganize || false}
          onChange={(e) => setSettings((prev) => ({ ...prev, autoOrganize: e.target.checked }))}
          className="form-checkbox accent-stratosort-blue"
        />
        <span className="text-sm text-system-gray-700">Automatically organize new downloads</span>
      </label>

      {/* Confidence threshold - only shown when autoOrganize is enabled */}
      {settings.autoOrganize && (
        <div className="ml-6 p-3 bg-system-gray-50 rounded border border-system-gray-200">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-system-gray-700">Minimum confidence</span>
            <span className="text-sm font-medium text-stratosort-blue">{confidencePercent}%</span>
          </div>
          <p className="text-xs text-system-gray-500">
            Files must meet this confidence level to be automatically organized. Lower confidence
            matches require manual review.
          </p>
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
