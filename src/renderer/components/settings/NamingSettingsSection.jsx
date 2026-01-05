import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { FileText } from 'lucide-react';
import Select from '../ui/Select';
import Input from '../ui/Input';

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
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-5 h-5 text-stratosort-blue" />
        <h3 className="text-sm font-medium text-system-gray-900">File Naming Defaults</h3>
      </div>

      <p className="text-xs text-system-gray-500 mb-4">
        Configure how files are renamed when automatically organized by watchers.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label
            htmlFor="settings-naming-convention"
            className="block text-sm font-medium text-system-gray-700 mb-2"
          >
            Convention
          </label>
          <Select
            id="settings-naming-convention"
            value={settings.namingConvention || 'subject-date'}
            onChange={handleConventionChange}
            aria-label="Naming convention"
          >
            <option value="subject-date">subject-date</option>
            <option value="date-subject">date-subject</option>
            <option value="project-subject-date">project-subject-date</option>
            <option value="category-subject">category-subject</option>
            <option value="keep-original">keep-original</option>
          </Select>
        </div>

        <div>
          <label
            htmlFor="settings-date-format"
            className="block text-sm font-medium text-system-gray-700 mb-2"
          >
            Date format
          </label>
          <Select
            id="settings-date-format"
            value={settings.dateFormat || 'YYYY-MM-DD'}
            onChange={handleDateFormatChange}
            aria-label="Date format"
          >
            <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            <option value="MM-DD-YYYY">MM-DD-YYYY</option>
            <option value="DD-MM-YYYY">DD-MM-YYYY</option>
            <option value="YYYYMMDD">YYYYMMDD</option>
          </Select>
        </div>

        <div>
          <label
            htmlFor="settings-case-convention"
            className="block text-sm font-medium text-system-gray-700 mb-2"
          >
            Case
          </label>
          <Select
            id="settings-case-convention"
            value={settings.caseConvention || 'kebab-case'}
            onChange={handleCaseChange}
            aria-label="Case convention"
          >
            <option value="kebab-case">kebab-case</option>
            <option value="snake_case">snake_case</option>
            <option value="camelCase">camelCase</option>
            <option value="PascalCase">PascalCase</option>
            <option value="lowercase">lowercase</option>
            <option value="UPPERCASE">UPPERCASE</option>
          </Select>
        </div>

        <div>
          <label
            htmlFor="settings-separator"
            className="block text-sm font-medium text-system-gray-700 mb-2"
          >
            Separator
          </label>
          <Input
            id="settings-separator"
            value={settings.separator || '-'}
            onChange={handleSeparatorChange}
            placeholder="-"
            aria-label="Separator character"
            aria-describedby="settings-separator-hint"
          />
          <p id="settings-separator-hint" className="mt-2 text-xs text-system-gray-500">
            Use letters, numbers, dash or underscore.
          </p>
        </div>
      </div>
    </div>
  );
}

NamingSettingsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default NamingSettingsSection;
