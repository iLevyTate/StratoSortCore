import React, { useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import Select from '../ui/Select';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import SettingsGroup from './SettingsGroup';
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

  const clampedConfidence = useMemo(() => {
    const raw = settings.confidenceThreshold ?? DEFAULT_CONFIDENCE;
    const safe = Number.isFinite(raw) ? raw : DEFAULT_CONFIDENCE;
    return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, safe));
  }, [settings.confidenceThreshold]);
  const confidencePercent = Math.round(clampedConfidence * 100);
  const confidenceSliderValue = confidencePercent;

  return (
    <SettingsCard
      title="Auto-organize"
      description="Configure how new downloads are routed and when automation kicks in."
    >
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
          className="w-full"
        >
          <option value="auto">Auto</option>
          <option value="llm">LLM-only</option>
          <option value="hybrid">Hybrid</option>
          <option value="embedding">Embedding-first</option>
        </Select>
      </SettingRow>

      {/* Confidence threshold - only shown when autoOrganize is enabled */}
      {settings.autoOrganize && (
        <SettingsGroup gap="cozy">
          <div className="flex items-center justify-between">
            <Text as="span" variant="small" className="font-medium text-system-gray-700">
              Minimum confidence
            </Text>
            <Text as="span" variant="small" className="font-medium text-stratosort-blue">
              {confidencePercent}%
            </Text>
          </div>
          <Text variant="tiny" className="text-system-gray-500">
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
        </SettingsGroup>
      )}
    </SettingsCard>
  );
}

AutoOrganizeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default AutoOrganizeSection;
