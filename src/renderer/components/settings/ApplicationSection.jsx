import React from 'react';
import PropTypes from 'prop-types';
import { RefreshCw } from 'lucide-react';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import Button from '../ui/Button';
import SettingsCard from './SettingsCard';
import { logger } from '../../../shared/logger';
import { getElectronAPI, settingsIpc, systemIpc } from '../../services/ipc';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings, addNotification }) {
  const [isOpeningLogs, setIsOpeningLogs] = React.useState(false);
  const [isExportingLogs, setIsExportingLogs] = React.useState(false);
  const [isCheckingUpdates, setIsCheckingUpdates] = React.useState(false);
  const electronApi = getElectronAPI();
  const canOpenLogsFolder = typeof electronApi?.settings?.openLogsFolder === 'function';
  const canExportLogs = typeof electronApi?.system?.exportLogs === 'function';
  const canCheckUpdates = typeof electronApi?.system?.checkForUpdates === 'function';

  const handleOpenLogsFolder = React.useCallback(async () => {
    if (isOpeningLogs) return;
    if (!canOpenLogsFolder) {
      addNotification?.('Open logs folder is unavailable in this build', 'error');
      return;
    }

    setIsOpeningLogs(true);
    try {
      const result = await settingsIpc.openLogsFolder();
      if (result?.success === false) {
        throw new Error(result.error || 'Failed to open logs folder');
      }
    } catch (error) {
      logger.error('[Settings] Failed to open logs folder', { error });
      addNotification?.('Failed to open logs folder', 'error');
    } finally {
      setIsOpeningLogs(false);
    }
  }, [addNotification, canOpenLogsFolder, isOpeningLogs]);

  const handleExportLogs = React.useCallback(async () => {
    if (isExportingLogs) return;
    if (!canExportLogs) {
      addNotification?.('Export logs is unavailable in this build', 'error');
      return;
    }

    setIsExportingLogs(true);
    try {
      const result = await systemIpc.exportLogs();
      if (result?.success) {
        addNotification?.(`Logs exported to ${result.filePath || 'file'}`, 'success');
      } else if (result?.canceled || result?.cancelled) {
        // User canceled the save dialog — no notification needed
      } else if (result?.error) {
        logger.error('[Settings] Failed to export logs', { error: result.error });
        addNotification?.(result.error || 'Failed to export logs', 'error');
      }
    } catch (error) {
      logger.error('[Settings] Failed to export logs', { error });
      addNotification?.('Failed to export logs', 'error');
    } finally {
      setIsExportingLogs(false);
    }
  }, [addNotification, canExportLogs, isExportingLogs]);

  const handleCheckForUpdates = React.useCallback(async () => {
    if (isCheckingUpdates) return;
    if (!canCheckUpdates) {
      addNotification?.('Update checks are unavailable in this build', 'error');
      return;
    }

    setIsCheckingUpdates(true);
    try {
      await systemIpc.checkForUpdates();
      addNotification?.('Checking for updates\u2026', 'info');
    } catch (error) {
      logger.error('[Settings] Failed to check for updates', { error });
      addNotification?.('Failed to check for updates', 'error');
    } finally {
      setIsCheckingUpdates(false);
    }
  }, [addNotification, canCheckUpdates, isCheckingUpdates]);

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
          disabled={!canCheckUpdates}
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
            disabled={!canOpenLogsFolder}
            isLoading={isOpeningLogs}
          >
            Open Folder
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={handleExportLogs}
            disabled={!canExportLogs}
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
