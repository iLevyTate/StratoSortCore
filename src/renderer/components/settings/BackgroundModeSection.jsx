import React from 'react';
import PropTypes from 'prop-types';

function BackgroundModeSection({ settings, setSettings }) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.backgroundMode}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              backgroundMode: e.target.checked
            }))
          }
          className="form-checkbox accent-stratosort-blue"
        />
        <span className="text-sm text-system-gray-700">Keep running in background</span>
      </label>
      {settings.backgroundMode && !settings.autoOrganize && (
        <p className="ml-6 text-xs text-amber-600">
          Enable &quot;Automatically organize new downloads&quot; below to process files while
          running in background.
        </p>
      )}
    </div>
  );
}

BackgroundModeSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default BackgroundModeSection;
