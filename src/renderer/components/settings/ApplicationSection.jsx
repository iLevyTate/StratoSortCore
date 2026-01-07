import React from 'react';
import PropTypes from 'prop-types';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings }) {
  return (
    <div className="space-y-6">
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
    </div>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default ApplicationSection;
