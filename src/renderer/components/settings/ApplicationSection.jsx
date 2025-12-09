import React from 'react';
import PropTypes from 'prop-types';

/**
 * Application settings section (launch on startup, etc.)
 */
function ApplicationSection({ settings, setSettings }) {
  return (
    <div className="space-y-6">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          id="launchOnStartup"
          checked={!!settings.launchOnStartup}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              launchOnStartup: e.target.checked,
            }))
          }
          className="form-checkbox accent-stratosort-blue"
        />
        <span className="text-sm text-system-gray-700">
          Launch StratoSort on system startup
        </span>
      </label>
    </div>
  );
}

ApplicationSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
};

export default ApplicationSection;
