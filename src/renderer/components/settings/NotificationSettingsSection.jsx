import React from 'react';
import PropTypes from 'prop-types';
import { Bell, Monitor, Smartphone, MessageSquare, AlertTriangle } from 'lucide-react';

/**
 * NotificationSettingsSection - Settings section for notification preferences
 * Controls where and when notifications are shown
 */
function NotificationSettingsSection({ settings, setSettings }) {
  const updateSetting = (key, value) => {
    setSettings((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const notificationMode = settings.notificationMode || 'both';

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <Bell className="w-5 h-5 text-stratosort-blue" />
        <h3 className="text-sm font-medium text-system-gray-900">Notification Settings</h3>
      </div>

      {/* Master notifications toggle */}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={settings.notifications !== false}
          onChange={(e) => updateSetting('notifications', e.target.checked)}
          className="form-checkbox accent-stratosort-blue"
        />
        <span className="text-sm text-system-gray-700">Enable notifications</span>
      </label>

      {/* Notification mode selection */}
      {settings.notifications !== false && (
        <div className="ml-6 space-y-3">
          <p className="text-xs text-system-gray-500">Where to show notifications:</p>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="notificationMode"
                value="both"
                checked={notificationMode === 'both'}
                onChange={() => updateSetting('notificationMode', 'both')}
                className="form-radio accent-stratosort-blue"
              />
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-system-gray-500" />
                <Smartphone className="w-4 h-4 text-system-gray-500" />
                <span className="text-sm text-system-gray-700">
                  App and system tray (Recommended)
                </span>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="notificationMode"
                value="ui"
                checked={notificationMode === 'ui'}
                onChange={() => updateSetting('notificationMode', 'ui')}
                className="form-radio accent-stratosort-blue"
              />
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-system-gray-500" />
                <span className="text-sm text-system-gray-700">App only (in-window toasts)</span>
              </div>
            </label>

            <label className="flex items-center gap-3">
              <input
                type="radio"
                name="notificationMode"
                value="tray"
                checked={notificationMode === 'tray'}
                onChange={() => updateSetting('notificationMode', 'tray')}
                className="form-radio accent-stratosort-blue"
              />
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-system-gray-500" />
                <span className="text-sm text-system-gray-700">System tray only</span>
              </div>
            </label>
          </div>

          {/* Notification types */}
          <div className="mt-4 pt-4 border-t border-system-gray-200 space-y-3">
            <p className="text-xs text-system-gray-500 font-medium">Notification types:</p>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.notifyOnAutoAnalysis !== false}
                onChange={(e) => updateSetting('notifyOnAutoAnalysis', e.target.checked)}
                className="form-checkbox accent-stratosort-blue"
              />
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-system-gray-500" />
                <span className="text-sm text-system-gray-700">Auto-analyzed files</span>
              </div>
            </label>
            <p className="text-xs text-system-gray-400 ml-6">
              Notify when files are analyzed by smart folder or download watchers
            </p>

            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.notifyOnLowConfidence !== false}
                onChange={(e) => updateSetting('notifyOnLowConfidence', e.target.checked)}
                className="form-checkbox accent-stratosort-blue"
              />
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-system-gray-700">Low confidence files</span>
              </div>
            </label>
            <p className="text-xs text-system-gray-400 ml-6">
              Notify when a file doesn&apos;t meet the confidence threshold for auto-organization
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

NotificationSettingsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default NotificationSettingsSection;
