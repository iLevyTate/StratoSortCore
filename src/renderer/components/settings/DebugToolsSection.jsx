import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import Button from '../ui/Button';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import {
  DEBUG_STORAGE_KEYS,
  getStoredDebugModeEnabled,
  getStoredForceModelWizardEnabled,
  writeStoredFlag
} from '../../utils/debugFlags';

function DebugToolsSection({ addNotification }) {
  const isDevBuild = process.env.NODE_ENV === 'development';
  const [debugModeEnabled, setDebugModeEnabled] = React.useState(() => getStoredDebugModeEnabled());
  const [forceModelWizardEnabled, setForceModelWizardEnabled] = React.useState(() =>
    getStoredForceModelWizardEnabled()
  );

  if (!isDevBuild) return null;

  const handleDebugModeChange = (checked) => {
    writeStoredFlag(DEBUG_STORAGE_KEYS.debugMode, checked);
    setDebugModeEnabled(checked);

    if (!checked) {
      writeStoredFlag(DEBUG_STORAGE_KEYS.forceModelWizard, false);
      setForceModelWizardEnabled(false);
      addNotification?.('Debug mode disabled. Debug-only flags were cleared.', 'info');
      return;
    }

    addNotification?.('Debug mode enabled.', 'info');
  };

  const handleForceWizardChange = (checked) => {
    if (!debugModeEnabled) return;
    writeStoredFlag(DEBUG_STORAGE_KEYS.forceModelWizard, checked);
    setForceModelWizardEnabled(checked);
    addNotification?.(
      checked
        ? 'Model setup wizard will be forced on Welcome.'
        : 'Model setup wizard forcing disabled.',
      'info'
    );
  };

  const clearDebugFlags = () => {
    writeStoredFlag(DEBUG_STORAGE_KEYS.forceModelWizard, false);
    writeStoredFlag(DEBUG_STORAGE_KEYS.debugMode, false);
    setForceModelWizardEnabled(false);
    setDebugModeEnabled(false);
    addNotification?.('Debug flags cleared.', 'info');
  };

  return (
    <SettingsCard
      title="Debug tools"
      description="Developer-only switches for testing setup and onboarding behavior."
    >
      <SettingRow
        label="Enable Debug Mode"
        description="Turns on local debug switches in this app profile. Dev builds only."
      >
        <Switch checked={debugModeEnabled} onChange={handleDebugModeChange} />
      </SettingRow>

      <SettingRow
        label="Force Setup Wizard"
        description="When enabled, Welcome shows the model setup wizard even if required models exist."
      >
        <Switch
          checked={forceModelWizardEnabled}
          onChange={handleForceWizardChange}
          disabled={!debugModeEnabled}
        />
      </SettingRow>

      <SettingRow
        label="Reset Debug Flags"
        description="Clears local debug switches and restores normal behavior."
      >
        <Button variant="subtle" size="sm" onClick={clearDebugFlags}>
          Reset
        </Button>
      </SettingRow>
    </SettingsCard>
  );
}

DebugToolsSection.propTypes = {
  addNotification: PropTypes.func
};

export default DebugToolsSection;
