import React from 'react';
import PropTypes from 'prop-types';

function BackgroundModeSection({ settings, setSettings }) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="checkbox"
        checked={settings.backgroundMode}
        onChange={(e) =>
          setSettings((prev) => ({
            ...prev,
            backgroundMode: e.target.checked,
          }))
        }
        className="form-checkbox accent-stratosort-blue"
      />
      <span className="text-sm text-system-gray-700">
        Keep running in background
      </span>
    </label>
  );
}

BackgroundModeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
};

export default BackgroundModeSection;
