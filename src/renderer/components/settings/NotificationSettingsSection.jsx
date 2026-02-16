import React from 'react';
import PropTypes from 'prop-types';
import { Monitor, Smartphone, MessageSquare, AlertTriangle } from 'lucide-react';
import Switch from '../ui/Switch';
import SelectionCard from '../ui/SelectionCard';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import SettingsGroup from './SettingsGroup';
import { Caption, Text } from '../ui/Typography';

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
    <SettingsCard
      title="Notifications"
      description="Control where notifications appear and which events trigger them."
    >
      {/* Master notifications toggle */}
      <SettingRow
        label="Enable Notifications"
        description="Show notifications for important events and analysis results."
      >
        <Switch
          checked={settings.notifications !== false}
          onChange={(checked) => updateSetting('notifications', checked)}
        />
      </SettingRow>

      {/* Notification mode selection */}
      {settings.notifications !== false && (
        <SettingsGroup gap="spacious">
          <SettingRow
            layout="col"
            label="Display Mode"
            description="Choose where notifications should appear."
          >
            <div className="grid gap-4">
              <SelectionCard
                as="label"
                selected={notificationMode === 'both'}
                onSelect={() => updateSetting('notificationMode', 'both')}
                className="flex items-center gap-3 p-3"
              >
                <input
                  type="radio"
                  name="notificationMode"
                  value="both"
                  checked={notificationMode === 'both'}
                  onChange={() => updateSetting('notificationMode', 'both')}
                  className="form-radio text-stratosort-blue focus:ring-stratosort-blue"
                />
                <div className="flex items-center gap-2">
                  <Monitor
                    className={`w-4 h-4 ${notificationMode === 'both' ? 'text-stratosort-blue' : 'text-system-gray-500'}`}
                  />
                  <Smartphone
                    className={`w-4 h-4 ${notificationMode === 'both' ? 'text-stratosort-blue' : 'text-system-gray-500'}`}
                  />
                  <Text variant="small" className="font-medium text-system-gray-900">
                    App and system tray (Recommended)
                  </Text>
                </div>
              </SelectionCard>

              <SelectionCard
                as="label"
                selected={notificationMode === 'ui'}
                onSelect={() => updateSetting('notificationMode', 'ui')}
                className="flex items-center gap-3 p-3"
              >
                <input
                  type="radio"
                  name="notificationMode"
                  value="ui"
                  checked={notificationMode === 'ui'}
                  onChange={() => updateSetting('notificationMode', 'ui')}
                  className="form-radio text-stratosort-blue focus:ring-stratosort-blue"
                />
                <div className="flex items-center gap-2">
                  <Monitor
                    className={`w-4 h-4 ${notificationMode === 'ui' ? 'text-stratosort-blue' : 'text-system-gray-500'}`}
                  />
                  <Text variant="small" className="font-medium text-system-gray-900">
                    App only (in-window toasts)
                  </Text>
                </div>
              </SelectionCard>

              <SelectionCard
                as="label"
                selected={notificationMode === 'tray'}
                onSelect={() => updateSetting('notificationMode', 'tray')}
                className="flex items-center gap-3 p-3"
              >
                <input
                  type="radio"
                  name="notificationMode"
                  value="tray"
                  checked={notificationMode === 'tray'}
                  onChange={() => updateSetting('notificationMode', 'tray')}
                  className="form-radio text-stratosort-blue focus:ring-stratosort-blue"
                />
                <div className="flex items-center gap-2">
                  <Smartphone
                    className={`w-4 h-4 ${notificationMode === 'tray' ? 'text-stratosort-blue' : 'text-system-gray-500'}`}
                  />
                  <Text variant="small" className="font-medium text-system-gray-900">
                    System tray only
                  </Text>
                </div>
              </SelectionCard>
            </div>
          </SettingRow>

          <div className="pt-4 border-t border-border-soft">
            <Caption className="block mb-4">Notification events</Caption>
            <div className="space-y-4">
              <SettingRow
                label={
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-system-gray-500" />
                    <span>Auto-analyzed files</span>
                  </div>
                }
                description="Notify when files are analyzed by smart folder or download watchers."
              >
                <Switch
                  checked={settings.notifyOnAutoAnalysis !== false}
                  onChange={(checked) => updateSetting('notifyOnAutoAnalysis', checked)}
                />
              </SettingRow>

              <SettingRow
                label={
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-stratosort-warning" />
                    <span>Low confidence files</span>
                  </div>
                }
                description="Notify when a file doesn't meet the confidence threshold for auto-organization."
              >
                <Switch
                  checked={settings.notifyOnLowConfidence !== false}
                  onChange={(checked) => updateSetting('notifyOnLowConfidence', checked)}
                />
              </SettingRow>
            </div>
          </div>
        </SettingsGroup>
      )}
    </SettingsCard>
  );
}

NotificationSettingsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default NotificationSettingsSection;
