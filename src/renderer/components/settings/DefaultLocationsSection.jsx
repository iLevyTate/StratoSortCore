import React, { useCallback } from 'react';
import PropTypes from 'prop-types';
import { useSelector } from 'react-redux';
import { FolderOpen } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Card from '../ui/Card';
import SettingRow from './SettingRow';
import { Text } from '../ui/Typography';
import { selectRedactPaths } from '../../store/selectors';

/**
 * Default locations section for smart folder configuration
 */
function DefaultLocationsSection({ settings, setSettings }) {
  // PERF: Use memoized selector instead of inline Boolean coercion
  const redactPaths = useSelector(selectRedactPaths);

  const handleBrowse = useCallback(async () => {
    try {
      if (!window?.electronAPI?.files?.selectDirectory) return;
      const res = await window.electronAPI.files.selectDirectory();
      if (res?.success && res.path) {
        setSettings((prev) => ({
          ...prev,
          defaultSmartFolderLocation: res.path
        }));
      }
    } catch {
      // Ignore selection errors
    }
  }, [setSettings]);

  return (
    <Card variant="default" className="space-y-5">
      <div>
        <Text variant="tiny" className="font-semibold uppercase tracking-wide text-system-gray-500">
          Default locations
        </Text>
        <Text variant="small" className="text-system-gray-600">
          Choose where StratoSort creates new smart folders by default.
        </Text>
      </div>

      <SettingRow
        layout="col"
        label="Default Smart Folder Location"
        description="Where new smart folders will be created by default."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            type={redactPaths ? 'password' : 'text'}
            value={settings.defaultSmartFolderLocation || ''}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                defaultSmartFolderLocation: e.target.value
              }))
            }
            className="w-full"
            placeholder="Documents"
          />
          <Button
            onClick={handleBrowse}
            variant="secondary"
            type="button"
            title="Browse"
            aria-label="Browse for default folder"
            leftIcon={<FolderOpen className="w-4 h-4" />}
            size="md"
            className="w-full sm:w-auto justify-center"
          >
            Browse
          </Button>
        </div>
      </SettingRow>
    </Card>
  );
}

DefaultLocationsSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired
};

export default DefaultLocationsSection;
