import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { FolderOpen } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingRow from './SettingRow';

/**
 * Default locations section for smart folder configuration
 */
function DefaultLocationsSection({ settings, setSettings }) {
  const handleBrowse = useCallback(async () => {
    const res = await window.electronAPI.files.selectDirectory();
    if (res?.success && res.path) {
      setSettings((prev) => ({
        ...prev,
        defaultSmartFolderLocation: res.path
      }));
    }
  }, [setSettings]);

  return (
    <div className="space-y-6">
      <SettingRow
        layout="col"
        label="Default Smart Folder Location"
        description="Where new smart folders will be created by default."
      >
        <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
          <Input
            type="text"
            value={settings.defaultSmartFolderLocation}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                defaultSmartFolderLocation: e.target.value
              }))
            }
            className="flex-1"
            placeholder="Documents"
          />
          <Button
            onClick={handleBrowse}
            variant="secondary"
            type="button"
            title="Browse"
            aria-label="Browse for default folder"
            leftIcon={<FolderOpen className="w-4 h-4" />}
            size="md"
            className="shrink-0"
          >
            Browse
          </Button>
        </div>
      </SettingRow>
    </div>
  );
}

DefaultLocationsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default DefaultLocationsSection;
