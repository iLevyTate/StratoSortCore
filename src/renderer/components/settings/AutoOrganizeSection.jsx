import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';

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
    <div className="space-y-6">
      {/* Auto-organize toggle */}
      <SettingRow
        label="Auto-organize Downloads"
        description="Automatically organize new files detected in your download folder."
      >
        <Switch
          checked={settings.autoOrganize || false}
          onChange={(checked) => setSettings((prev) => ({ ...prev, autoOrganize: checked }))}
        />
      </SettingRow>

      {/* Confidence threshold - only shown when autoOrganize is enabled */}
      {settings.autoOrganize && (
        <div className="ml-0 pl-4 border-l-2 border-system-gray-100 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-system-gray-700">Minimum confidence</span>
            <span className="text-sm font-medium text-stratosort-blue">{confidencePercent}%</span>
          </div>
          <p className="text-xs text-system-gray-500 mb-3">
            Files must meet this confidence level to be automatically organized. Lower confidence
            matches require manual review.
          </p>
          <div className="h-2 bg-system-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-stratosort-blue rounded-full transition-all duration-300"
              style={{ width: `${confidencePercent}%` }}
            />
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
