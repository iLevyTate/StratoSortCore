import React, { useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { RefreshCw, Download, Upload, Trash2, RotateCcw, Clock } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import StateMessage from '../ui/StateMessage';
import { logger } from '../../../shared/logger';
import { Text } from '../ui/Typography';

/**
 * Settings backup/restore section with import/export functionality
 */
function SettingsBackupSection({ addNotification }) {
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isRestoring, setIsRestoring] = useState(null);
  const [isDeleting, setIsDeleting] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  logger.setContext('SettingsBackupSection');

  const loadBackups = useCallback(async () => {
    if (!window?.electronAPI?.settings?.listBackups) return;
    setIsLoading(true);
    try {
      const res = await window.electronAPI.settings.listBackups();
      if (res?.success && Array.isArray(res.backups)) {
        setBackups(res.backups);
      } else {
        setBackups([]);
      }
    } catch (e) {
      logger.debug('[SettingsBackupSection] listBackups failed', { error: e?.message });
      setBackups([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleCreateBackup = useCallback(async () => {
    if (!window?.electronAPI?.settings?.createBackup) return;
    setIsCreating(true);
    try {
      const res = await window.electronAPI.settings.createBackup();
      if (res?.success) {
        addNotification('Backup created successfully', 'success');
        loadBackups();
      } else {
        addNotification(res?.error || 'Failed to create backup', 'error');
      }
    } catch {
      addNotification('Failed to create backup', 'error');
    } finally {
      setIsCreating(false);
    }
  }, [addNotification, loadBackups]);

  const handleRestoreBackup = useCallback(
    async (backupPath) => {
      if (!window?.electronAPI?.settings?.restoreBackup) return;
      setIsRestoring(backupPath);
      try {
        const res = await window.electronAPI.settings.restoreBackup(backupPath);
        if (res?.success) {
          addNotification('Backup restored. Reload to apply changes.', 'success');
        } else {
          addNotification(res?.error || 'Failed to restore backup', 'error');
        }
      } catch {
        addNotification('Failed to restore backup', 'error');
      } finally {
        setIsRestoring(null);
      }
    },
    [addNotification]
  );

  const handleDeleteBackup = useCallback(
    async (backupPath) => {
      if (!window?.electronAPI?.settings?.deleteBackup) return;
      setIsDeleting(backupPath);
      try {
        const res = await window.electronAPI.settings.deleteBackup(backupPath);
        if (res?.success) {
          addNotification('Backup deleted', 'success');
          loadBackups();
        } else {
          addNotification(res?.error || 'Failed to delete backup', 'error');
        }
      } catch {
        addNotification('Failed to delete backup', 'error');
      } finally {
        setIsDeleting(null);
      }
    },
    [addNotification, loadBackups]
  );

  const handleExport = useCallback(async () => {
    if (!window?.electronAPI?.settings?.export) return;
    setIsExporting(true);
    try {
      const res = await window.electronAPI.settings.export();
      if (res?.success) {
        addNotification('Settings exported successfully', 'success');
      } else if (res?.canceled) {
        // User canceled, no notification needed
      } else {
        addNotification(res?.error || 'Failed to export settings', 'error');
      }
    } catch {
      addNotification('Failed to export settings', 'error');
    } finally {
      setIsExporting(false);
    }
  }, [addNotification]);

  const handleImport = useCallback(async () => {
    if (!window?.electronAPI?.settings?.import) return;
    setIsImporting(true);
    try {
      const res = await window.electronAPI.settings.import();
      if (res?.success) {
        addNotification('Settings imported. Reload to apply changes.', 'success');
      } else if (res?.canceled) {
        // User canceled, no notification needed
      } else {
        addNotification(res?.error || 'Failed to import settings', 'error');
      }
    } catch {
      addNotification('Failed to import settings', 'error');
    } finally {
      setIsImporting(false);
    }
  }, [addNotification]);

  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="block text-sm font-medium text-system-gray-700 mb-2">
            Settings Backup & Restore
          </label>
          <Text variant="tiny" className="text-system-gray-500">
            Create backups of your settings or export/import to share across devices.
          </Text>
        </div>
        <IconButton
          icon={<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
          size="sm"
          variant="secondary"
          onClick={loadBackups}
          aria-label="Refresh backup list"
          title="Refresh"
          disabled={isLoading}
        />
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleCreateBackup}
          variant="secondary"
          disabled={isCreating}
          size="sm"
          className="flex items-center gap-1.5"
        >
          <Clock className="w-3.5 h-3.5" />
          {isCreating ? 'Creating...' : 'Create Backup'}
        </Button>
        <Button
          onClick={handleExport}
          variant="secondary"
          disabled={isExporting}
          size="sm"
          className="flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          {isExporting ? 'Exporting...' : 'Export to File'}
        </Button>
        <Button
          onClick={handleImport}
          variant="secondary"
          disabled={isImporting}
          size="sm"
          className="flex items-center gap-1.5"
        >
          <Upload className="w-3.5 h-3.5" />
          {isImporting ? 'Importing...' : 'Import from File'}
        </Button>
      </div>

      {/* Backup List */}
      {backups.length > 0 && (
        <div className="space-y-2">
          <Text as="label" variant="tiny" className="block font-medium text-system-gray-600">
            Available Backups ({backups.length})
          </Text>
          <div className="max-h-40 overflow-y-auto space-y-1.5 border border-system-gray-200 rounded-lg p-2 bg-system-gray-50">
            {backups.map((backup) => (
              <div
                key={backup.path || backup.name}
                className="flex items-center justify-between gap-2 p-2 bg-white rounded border border-system-gray-100"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-system-gray-700 truncate">
                    {backup.name || 'Backup'}
                  </div>
                  <Text variant="tiny" className="text-system-gray-500">
                    {formatDate(backup.timestamp || backup.created)}
                  </Text>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    icon={<RotateCcw className="w-3.5 h-3.5" />}
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRestoreBackup(backup.path)}
                    aria-label="Restore this backup"
                    title="Restore"
                    disabled={isRestoring === backup.path}
                  />
                  <IconButton
                    icon={<Trash2 className="w-3.5 h-3.5" />}
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteBackup(backup.path)}
                    aria-label="Delete this backup"
                    title="Delete"
                    disabled={isDeleting === backup.path}
                    className="text-stratosort-danger hover:text-stratosort-danger/80"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {backups.length === 0 && !isLoading && (
        <StateMessage
          icon={Clock}
          tone="neutral"
          size="sm"
          align="left"
          title="No backups found"
          description="Create one to save your current settings."
          className="py-2"
          contentClassName="max-w-sm"
        />
      )}
    </div>
  );
}

SettingsBackupSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default SettingsBackupSection;
