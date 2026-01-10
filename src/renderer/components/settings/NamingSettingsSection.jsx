import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { FileText } from 'lucide-react';
import Select from '../ui/Select';
import Input from '../ui/Input';
import SettingRow from './SettingRow';

// Characters that could break file paths - used for separator validation
const UNSAFE_SEPARATOR_CHARS = /[/\\:*?"<>|]/;

/**
 * NamingSettingsSection - Settings section for file naming conventions
 * Allows users to configure default naming patterns for auto-organized files.
 * These settings are used by DownloadWatcher and SmartFolderWatcher.
 */
function NamingSettingsSection({ settings, setSettings }) {
  const updateSetting = useCallback(
    (key, value) => {
      setSettings((prev) => ({
        ...prev,
        [key]: value
      }));
    },
    [setSettings]
  );

  const handleConventionChange = useCallback(
    (e) => updateSetting('namingConvention', e.target.value),
    [updateSetting]
  );

  const handleDateFormatChange = useCallback(
    (e) => updateSetting('dateFormat', e.target.value),
    [updateSetting]
  );

  const handleCaseChange = useCallback(
    (e) => updateSetting('caseConvention', e.target.value),
    [updateSetting]
  );

  // FIX: Validate separator against unsafe characters that could break file paths
  const handleSeparatorChange = useCallback(
    (e) => {
      const { value } = e.target;
      // Only allow safe characters (reject path-breaking ones)
      if (value === '' || !UNSAFE_SEPARATOR_CHARS.test(value)) {
        updateSetting('separator', value);
      }
      // Silently reject unsafe characters
    },
    [updateSetting]
  );

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-5 h-5 text-stratosort-blue" />
          <h3 className="text-base font-medium text-system-gray-900">
            File Naming Defaults (Watchers &amp; Reanalysis)
          </h3>
        </div>
        <p className="text-sm text-system-gray-500 ml-7">
          Configure how files are renamed by <strong>Download Watcher</strong>,{' '}
          <strong>Smart Folder Watcher</strong>, and when running{' '}
          <strong>Reanalyze All Files</strong>. These settings do not affect the Discover phase —
          Discover has its own naming controls in the analysis interface.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SettingRow layout="col" label="Convention" className="h-full">
          <Select
            id="settings-naming-convention"
            value={settings.namingConvention || 'subject-date'}
            onChange={handleConventionChange}
            aria-label="Naming convention"
            className="w-full"
          >
            <option value="subject-date">subject-date</option>
            <option value="date-subject">date-subject</option>
            <option value="project-subject-date">project-subject-date</option>
            <option value="category-subject">category-subject</option>
            <option value="keep-original">keep-original</option>
          </Select>
        </SettingRow>

        <SettingRow layout="col" label="Date Format" className="h-full">
          <Select
            id="settings-date-format"
            value={settings.dateFormat || 'YYYY-MM-DD'}
            onChange={handleDateFormatChange}
            aria-label="Date format"
            className="w-full"
          >
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="MM-DD-YYYY">MM-DD-YYYY</option>
            <option value="DD-MM-YYYY">DD-MM-YYYY</option>
            <option value="YYYYMMDD">YYYYMMDD</option>
          </Select>
        </SettingRow>

        <SettingRow layout="col" label="Case" className="h-full">
          <Select
            id="settings-case-convention"
            value={settings.caseConvention || 'kebab-case'}
            onChange={handleCaseChange}
            aria-label="Case convention"
            className="w-full"
          >
            <option value="kebab-case">kebab-case</option>
            <option value="snake_case">snake_case</option>
            <option value="camelCase">camelCase</option>
            <option value="PascalCase">PascalCase</option>
            <option value="lowercase">lowercase</option>
            <option value="UPPERCASE">UPPERCASE</option>
          </Select>
        </SettingRow>

        <SettingRow
          layout="col"
          label="Separator"
          className="h-full"
          description="Letters, numbers, dash or underscore."
        >
          <Input
            id="settings-separator"
            value={settings.separator || '-'}
            onChange={handleSeparatorChange}
            placeholder="-"
            aria-label="Separator character"
            className="w-full"
          />
        </SettingRow>
      </div>
    </div>
  );
}

NamingSettingsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default NamingSettingsSection;
