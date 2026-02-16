import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import AlertBox from '../ui/AlertBox';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';

function BackgroundModeSection({ settings, setSettings }) {
  return (
    <SettingsCard
      title="Background mode"
      description="Keep StratoSort running in the tray when the window closes."
    >
      <SettingRow
        label="Background Mode"
        description="Keep running in the background when the window is closed."
      >
        <Switch
          checked={!!settings.backgroundMode}
          onChange={(checked) =>
            setSettings((prev) => ({
              ...prev,
              backgroundMode: checked
            }))
          }
        />
      </SettingRow>

      {settings.backgroundMode && !settings.autoOrganize && (
        <AlertBox variant="warning">
          Enable &quot;Auto-organize Downloads&quot; above to process files while running in
          background.
        </AlertBox>
      )}
    </SettingsCard>
  );
}

BackgroundModeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default BackgroundModeSection;
