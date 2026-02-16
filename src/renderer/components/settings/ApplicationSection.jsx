import React from 'react';
import PropTypes from 'prop-types';
import { RefreshCw } from 'lucide-react';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import Button from '../ui/Button';
import SettingsCard from './SettingsCard';
import { logger } from '../../../shared/logger';
import { systemIpc } from '../../services/ipc';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings, addNotification }) {
  const [isOpeningLogs, setIsOpeningLogs] = React.useState(false);
  const [isExportingLogs, setIsExportingLogs] = React.useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = React.useState(false);

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

  const handleExportLogs = React.useCallback(async () => {
    if (isExportingLogs) return;
    if (!window?.electronAPI?.system?.exportLogs) return;

    setIsExportingLogs(true);
    try {
      const result = await window.electronAPI.system.exportLogs();
      if (result?.success) {
        // Success notification handled by caller if needed, or we can add one here
      } else if (result?.error) {
        logger.error('[Settings] Failed to export logs', { error: result.error });
      }
    } catch (error) {
      logger.error('[Settings] Failed to export logs', { error });
    } finally {
      setIsExportingLogs(false);
    }
  }, [isExportingLogs]);

  const handleCheckForUpdates = React.useCallback(async () => {
    if (isCheckingUpdates) return;

    setIsCheckingUpdates(true);
    try {
      await systemIpc.checkForUpdates();
      addNotification?.('Checking for updates...', 'info');
    } catch (error) {
      logger.error('[Settings] Failed to check for updates', { error });
      addNotification?.('Failed to check for updates', 'error');
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [addNotification, isCheckingUpdates]);

  return (
    <SettingsCard
      title="Application preferences"
      description="Startup behavior and diagnostic access."
    >
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

      <SettingRow
        label="Software Updates"
        description="Check now for a new StratoSort version. If available, it will download and show an update prompt."
      >
        <Button
          variant="subtle"
          size="sm"
          onClick={handleCheckForUpdates}
          isLoading={isCheckingUpdates}
          leftIcon={<RefreshCw className="w-4 h-4" />}
        >
          Check for Updates
        </Button>
      </SettingRow>

      <SettingRow
        label="Troubleshooting Logs"
        description="Manage application logs for debugging and support."
      >
        <div className="flex gap-2">
          <Button
            variant="subtle"
            size="sm"
            onClick={handleOpenLogsFolder}
            disabled={!window?.electronAPI?.settings?.openLogsFolder}
            isLoading={isOpeningLogs}
          >
            Open Folder
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={handleExportLogs}
            disabled={!window?.electronAPI?.system?.exportLogs}
            isLoading={isExportingLogs}
          >
            Export Logs
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
  addNotification: PropTypes.func
};

export default ApplicationSection;
