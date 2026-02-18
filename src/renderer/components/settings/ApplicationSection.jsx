import React from 'react';
import PropTypes from 'prop-types';
import { RefreshCw } from 'lucide-react';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import Button from '../ui/Button';
import SettingsCard from './SettingsCard';
import { logger } from '../../../shared/logger';
import { getElectronAPI, systemIpc } from '../../services/ipc';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings, addNotification }) {
  const [isCheckingUpdates, setIsCheckingUpdates] = React.useState(false);
  const electronApi = getElectronAPI();
  const canCheckUpdates = typeof electronApi?.system?.checkForUpdates === 'function';

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
    </SettingsCard>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
  addNotification: PropTypes.func
};

export default ApplicationSection;
