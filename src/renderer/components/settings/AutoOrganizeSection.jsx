import React, { useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import Select from '../ui/Select';
import SettingRow from './SettingRow';
import { Text } from '../ui/Typography';

const DEFAULT_CONFIDENCE = 0.75; // 75%
const CONFIDENCE_MIN = 0.5; // 50%
const CONFIDENCE_MAX = 0.95; // 95%

/**
 * AutoOrganizeSection - Settings for automatic file organization
 *
 * Controls:
 * - autoOrganize: Enable/disable auto-organize for new downloads
 * - confidenceThreshold: Minimum confidence (0-1) required to auto-move files
 */
function AutoOrganizeSection({ settings, setSettings }) {
  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => ({
        ...prev,
        [key]: value
      }));
    },
    [setSettings]
  );

  const confidencePercent = useMemo(
    () => Math.round((settings.confidenceThreshold ?? DEFAULT_CONFIDENCE) * 100),
    [settings.confidenceThreshold]
  );
  const clampedConfidence = useMemo(() => {
    const raw = settings.confidenceThreshold ?? DEFAULT_CONFIDENCE;
    const safe = Number.isFinite(raw) ? raw : DEFAULT_CONFIDENCE;
    return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, safe));
  }, [settings.confidenceThreshold]);
  const confidenceSliderValue = Math.round(clampedConfidence * 100);

  return (
    <div className="space-y-6">
      {/* Auto-organize toggle */}
      <SettingRow
        label="Auto-organize Downloads"
        description="Automatically organize new files detected in your download folder."
      >
        <Switch
          checked={settings.autoOrganize || false}
          onChange={(checked) => updateSetting('autoOrganize', checked)}
        />
      </SettingRow>

      <SettingRow
        label="Smart folder routing"
        description="Auto mode uses LLM-only when embeddings are missing, then shifts to hybrid or embedding-first as embeddings become healthy."
      >
        <Select
          id="settings-smart-folder-routing"
          value={settings.smartFolderRoutingMode || 'auto'}
          onChange={(e) => updateSetting('smartFolderRoutingMode', e.target.value)}
          aria-label="Smart folder routing mode"
          className="w-full max-w-[220px]"
        >
          <option value="auto">Auto</option>
          <option value="llm">LLM-only</option>
          <option value="hybrid">Hybrid</option>
          <option value="embedding">Embedding-first</option>
        </Select>
      </SettingRow>

      {/* Confidence threshold - only shown when autoOrganize is enabled */}
      {settings.autoOrganize && (
        <div className="ml-0 pl-4 border-l-2 border-system-gray-100 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-system-gray-700">Minimum confidence</span>
            <span className="text-sm font-medium text-stratosort-blue">{confidencePercent}%</span>
          </div>
          <Text variant="tiny" className="text-system-gray-500 mb-3">
            Files must meet this confidence level to be automatically organized. Lower confidence
            matches require manual review.
          </Text>
          <input
            type="range"
            min={Math.round(CONFIDENCE_MIN * 100)}
            max={Math.round(CONFIDENCE_MAX * 100)}
            step="1"
            value={confidenceSliderValue}
            onChange={(e) => {
              const next = Number(e.target.value);
              const normalized = Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, next / 100));
              updateSetting('confidenceThreshold', normalized);
            }}
            aria-label="Minimum confidence threshold"
            className="w-full accent-stratosort-blue"
          />
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
