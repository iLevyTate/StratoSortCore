import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import Button from '../ui/Button';
import { logger } from '../../../shared/logger';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings }) {
  const [isOpeningLogs, setIsOpeningLogs] = React.useState(false);

  const handleOpenLogsFolder = React.useCallback(async () => {
    if (isOpeningLogs) return;
    if (!window?.electronAPI?.settings?.openLogsFolder) return;

    setIsOpeningLogs(true);
    try {
      await window.electronAPI.settings.openLogsFolder();
    } catch (error) {
      logger.error('[Settings] Failed to open logs folder', { error });
    } finally {
      setIsOpeningLogs(false);
    }
  }, [isOpeningLogs]);

  return (
    <div className="space-y-6">
      {/* Launch on Startup */}
      <SettingRow
        label="Launch on Startup"
        description="Automatically start StratoSort when you log in to your computer."
      >
        <Switch
          checked={!!settings.launchOnStartup}
          onChange={(checked) =>
            setSettings((prev) => ({
              ...prev,
              launchOnStartup: checked
            }))
          }
        />
      </SettingRow>

      {/* Logs */}
      <SettingRow
        label="Troubleshooting Logs"
        description="Open the folder that contains StratoSort logs (useful for sharing with support)."
      >
        <Button
          variant="subtle"
          size="sm"
          onClick={handleOpenLogsFolder}
          disabled={!window?.electronAPI?.settings?.openLogsFolder}
          isLoading={isOpeningLogs}
        >
          Open Logs Folder
        </Button>
      </SettingRow>
    </div>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ApplicationSection;
