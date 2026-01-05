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
    () =>
      Math.round(
        ((settings.confidenceThreshold ?? DEFAULT_CONFIDENCE) || DEFAULT_CONFIDENCE) * 100
      ),
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
        <div className="ml-6 space-y-3 p-3 bg-system-gray-50 rounded-lg">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-system-gray-700">Minimum confidence</label>
              <span className="text-sm font-medium text-system-gray-500">
                Locked at {confidencePercent}% (temporarily not configurable)
              </span>
            </div>
            <p className="text-xs text-system-gray-500">
              Confidence is currently fixed. Auto-organize will use this threshold until editing is
              re-enabled.
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
