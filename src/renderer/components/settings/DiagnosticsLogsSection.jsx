import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import { logger } from '../../../shared/logger';
import { getElectronAPI, settingsIpc, systemIpc } from '../../services/ipc';

/**
 * Diagnostics logs section (open/export logs for troubleshooting).
 */
function DiagnosticsLogsSection({ addNotification }) {
  const [isOpeningLogs, setIsOpeningLogs] = React.useState(false);
  const [isExportingLogs, setIsExportingLogs] = React.useState(false);
  const electronApi = getElectronAPI();
  const canOpenLogsFolder = typeof electronApi?.settings?.openLogsFolder === 'function';
  const canExportLogs = typeof electronApi?.system?.exportLogs === 'function';

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
      logger.error('[Diagnostics] Failed to open logs folder', { error });
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
        logger.error('[Diagnostics] Failed to export logs', { error: result.error });
        addNotification?.(result.error || 'Failed to export logs', 'error');
      }
    } catch (error) {
      logger.error('[Diagnostics] Failed to export logs', { error });
      addNotification?.('Failed to export logs', 'error');
    } finally {
      setIsExportingLogs(false);
    }
  }, [addNotification, canExportLogs, isExportingLogs]);

  return (
    <SettingsCard
      title="Troubleshooting logs"
      description="Open or export logs for support and debugging."
    >
      <SettingRow
        label="Logs"
        description="Use these tools when sharing diagnostic details for issue investigation."
      >
        <div className="flex flex-wrap gap-cozy">
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

DiagnosticsLogsSection.propTypes = {
  addNotification: PropTypes.func
};

export default DiagnosticsLogsSection;
