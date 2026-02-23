import React, { useCallback, useEffect, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import Input from '../ui/Input';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import { getElectronAPI } from '../../services/ipc';
import { DEFAULT_SETTINGS } from '../../../shared/defaultSettings';

const BYTES_PER_MB = 1024 * 1024;
const CONCURRENCY_MIN = 1;
const CONCURRENCY_MAX = 10;
const FILE_SIZE_MIN_MB = 1;
const MAX_GENERAL_FILE_MB = 1024; // 1 GB (matches settingsValidation max)
const MAX_IMAGE_FILE_MB = 500; // 500 MB
const MAX_DOCUMENT_FILE_MB = 500; // 500 MB

function bytesToMb(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return Math.round(bytes / BYTES_PER_MB).toString();
}

function mbToBytes(mbStr, maxMb) {
  const parsed = parseInt(mbStr, 10);
  if (!Number.isFinite(parsed) || parsed < FILE_SIZE_MIN_MB) return null;
  return Math.min(maxMb, parsed) * BYTES_PER_MB;
}

/**
 * Processing limits - advanced settings for file size and concurrency
 * Kept minimal to avoid overwhelming casual users
 */
function ProcessingLimitsSection({ settings, setSettings }) {
  const [recommendedConcurrency, setRecommendedConcurrency] = useState(null);

  useEffect(() => {
    const api = getElectronAPI();
    if (api?.system?.getRecommendedConcurrency) {
      api.system
        .getRecommendedConcurrency()
        .then((r) => {
          if (r && typeof r.maxConcurrent === 'number') {
            setRecommendedConcurrency(r.maxConcurrent);
          }
        })
        .catch(() => {});
    }
  }, []);

  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [setSettings]
  );

  const maxConcurrent = useMemo(() => {
    const raw = settings.maxConcurrentAnalysis ?? DEFAULT_SETTINGS.maxConcurrentAnalysis;
    const num = Number(raw);
    return Number.isFinite(num)
      ? Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, Math.round(num)))
      : CONCURRENCY_MIN;
  }, [settings.maxConcurrentAnalysis]);

  const maxFileSizeMb = useMemo(
    () => bytesToMb(settings.maxFileSize ?? DEFAULT_SETTINGS.maxFileSize),
    [settings.maxFileSize]
  );

  const maxImageFileSizeMb = useMemo(
    () => bytesToMb(settings.maxImageFileSize ?? DEFAULT_SETTINGS.maxImageFileSize),
    [settings.maxImageFileSize]
  );

  const maxDocumentFileSizeMb = useMemo(
    () => bytesToMb(settings.maxDocumentFileSize ?? DEFAULT_SETTINGS.maxDocumentFileSize),
    [settings.maxDocumentFileSize]
  );

  return (
    <SettingsCard
      title="Processing limits"
      description="File size limits and analysis concurrency. Adjust for your hardware."
    >
      <SettingRow
        layout="col"
        label="Concurrent analysis"
        description={
          recommendedConcurrency != null
            ? `System recommends ${recommendedConcurrency}. Lower values reduce memory use.`
            : 'Number of files analyzed in parallel. Lower values reduce memory use.'
        }
      >
        <Input
          type="number"
          min={CONCURRENCY_MIN}
          max={CONCURRENCY_MAX}
          value={maxConcurrent}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10);
            if (Number.isFinite(next)) {
              updateSetting(
                'maxConcurrentAnalysis',
                Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, next))
              );
            }
          }}
          className="w-24"
          aria-label="Max concurrent analysis"
        />
      </SettingRow>

      <SettingRow
        layout="col"
        label="Max general file size (MB)"
        description="Maximum file size for analysis. Files above this are skipped."
      >
        <Input
          type="number"
          min={FILE_SIZE_MIN_MB}
          max={MAX_GENERAL_FILE_MB}
          value={maxFileSizeMb}
          onChange={(e) => {
            const bytes = mbToBytes(e.target.value, MAX_GENERAL_FILE_MB);
            if (bytes != null) updateSetting('maxFileSize', bytes);
          }}
          className="w-24"
          aria-label="Max file size in MB"
        />
      </SettingRow>

      <SettingRow
        layout="col"
        label="Max image file size (MB)"
        description="Maximum size for image analysis."
      >
        <Input
          type="number"
          min={FILE_SIZE_MIN_MB}
          max={MAX_IMAGE_FILE_MB}
          value={maxImageFileSizeMb}
          onChange={(e) => {
            const bytes = mbToBytes(e.target.value, MAX_IMAGE_FILE_MB);
            if (bytes != null) updateSetting('maxImageFileSize', bytes);
          }}
          className="w-24"
          aria-label="Max image file size in MB"
        />
      </SettingRow>

      <SettingRow
        layout="col"
        label="Max document file size (MB)"
        description="Maximum size for document extraction."
      >
        <Input
          type="number"
          min={FILE_SIZE_MIN_MB}
          max={MAX_DOCUMENT_FILE_MB}
          value={maxDocumentFileSizeMb}
          onChange={(e) => {
            const bytes = mbToBytes(e.target.value, MAX_DOCUMENT_FILE_MB);
            if (bytes != null) updateSetting('maxDocumentFileSize', bytes);
          }}
          className="w-24"
          aria-label="Max document file size in MB"
        />
      </SettingRow>
    </SettingsCard>
  );
}

ProcessingLimitsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ProcessingLimitsSection;
