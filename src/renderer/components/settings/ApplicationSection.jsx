import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import Button from '../ui/Button';
import SettingsCard from './SettingsCard';
import { logger } from '../../../shared/logger';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings }) {
  const [isOpeningLogs, setIsOpeningLogs] = React.useState(false);
  const [isExportingLogs, setIsExportingLogs] = React.useState(false);

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

  const handleExportLogs = React.useCallback(
    async (redact = false) => {
      if (isExportingLogs) return;
      if (!window?.electronAPI?.system?.exportLogs) return;

      setIsExportingLogs(true);
      try {
        const result = await window.electronAPI.system.exportLogs(redact);
        if (result?.success) {
          // Success notification handled by caller if needed
        } else if (result?.error) {
          logger.error('[Settings] Failed to export logs', { error: result.error });
        }
      } catch (error) {
        logger.error('[Settings] Failed to export logs', { error });
      } finally {
        setIsExportingLogs(false);
      }
    },
    [isExportingLogs]
  );

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
        label="Troubleshooting Logs"
        description="Manage application logs for debugging and support. Use 'Export (Redacted)' before uploading to remove file names and analysis content."
      >
        <div className="flex flex-wrap gap-2">
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
            onClick={() => handleExportLogs(false)}
            disabled={!window?.electronAPI?.system?.exportLogs}
            isLoading={isExportingLogs}
            title="Export full logs (includes paths and crash dumps)"
          >
            Export Full
          </Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => handleExportLogs(true)}
            disabled={!window?.electronAPI?.system?.exportLogs}
            isLoading={isExportingLogs}
            title="Redact file paths and analysis content for safe upload"
          >
            Export (Redacted)
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ApplicationSection;
