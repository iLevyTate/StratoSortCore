import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import { Text } from '../ui/Typography';

function BackgroundModeSection({ settings, setSettings }) {
  return (
    <div className="space-y-6">
      <SettingRow
        label="Background Mode"
        description="Keep running in the background when the window is closed."
      >
        <Switch
          checked={settings.backgroundMode}
          onChange={(checked) =>
            setSettings((prev) => ({
              ...prev,
              backgroundMode: checked
            }))
          }
        />
      </SettingRow>

      {settings.backgroundMode && !settings.autoOrganize && (
        <div className="ml-0 pl-4 border-l-2 border-stratosort-warning/30">
          <Text variant="tiny" className="text-stratosort-warning">
            Enable &quot;Auto-organize Downloads&quot; above to process files while running in
            background.
          </Text>
        </div>
      )}
    </div>
  );
}

BackgroundModeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default BackgroundModeSection;
