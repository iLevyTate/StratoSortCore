import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import { Text } from '../ui/Typography';

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
        <div className="rounded-xl border border-stratosort-warning/20 bg-stratosort-warning/5 p-4">
          <Text variant="tiny" className="text-stratosort-warning">
            Enable &quot;Auto-organize Downloads&quot; above to process files while running in
            background.
          </Text>
        </div>
      )}
    </SettingsCard>
  );
}

BackgroundModeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default BackgroundModeSection;
