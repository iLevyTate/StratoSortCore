import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import Button from '../ui/Button';
import Card from '../ui/Card';
import { logger } from '../../../shared/logger';
import { Stack } from '../layout';
import { Text } from '../ui/Typography';

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

  return (
    <Card variant="default" className="space-y-5">
      <div>
        <Text variant="tiny" className="font-semibold uppercase tracking-wide text-system-gray-500">
          Application preferences
        </Text>
        <Text variant="small" className="text-system-gray-600">
          Startup behavior and diagnostic access.
        </Text>
      </div>

      <Stack gap="relaxed">
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
      </Stack>
    </Card>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ApplicationSection;
