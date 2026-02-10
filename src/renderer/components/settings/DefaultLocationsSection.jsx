import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { FolderOpen } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import { selectRedactPaths } from '../../store/selectors';

/**
 * Default locations section for smart folder configuration
 */
function DefaultLocationsSection({ settings, setSettings }) {
  // PERF: Use memoized selector instead of inline Boolean coercion
  const redactPaths = useSelector(selectRedactPaths);

  const handleBrowse = useCallback(async () => {
    try {
      if (!window?.electronAPI?.files?.selectDirectory) return;
      const res = await window.electronAPI.files.selectDirectory();
      if (res?.success && res.path) {
        setSettings((prev) => ({
          ...prev,
          defaultSmartFolderLocation: res.path
        }));
      }
    } catch {
      // Ignore selection errors
    }
  }, [setSettings]);

  return (
    <SettingsCard
      title="Default locations"
      description="Choose where StratoSort creates new smart folders by default."
    >
      <SettingRow
        layout="col"
        label="Default Smart Folder Location"
        description="Where new smart folders will be created by default."
      >
        <div className="settings-input-group">
          <Input
            type={redactPaths ? 'password' : 'text'}
            value={settings.defaultSmartFolderLocation || ''}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                defaultSmartFolderLocation: e.target.value
              }))
            }
            className="w-full"
            placeholder="Documents"
          />
          <Button
            onClick={handleBrowse}
            variant="secondary"
            type="button"
            title="Browse"
            aria-label="Browse for default folder"
            leftIcon={<FolderOpen className="w-4 h-4" />}
            size="sm"
            className="w-full sm:w-auto justify-center min-w-[9rem]"
          >
            Browse
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}

DefaultLocationsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default DefaultLocationsSection;
