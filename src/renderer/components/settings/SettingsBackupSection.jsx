import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import PropTypes from 'prop-types';
import { RefreshCw, Download, Upload, Trash2, RotateCcw, Clock } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import SettingsCard from './SettingsCard';
import StateMessage from '../ui/StateMessage';
import { createLogger } from '../../../shared/logger';
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
  const isMountedRef = useRef(false);

  const logger = useMemo(() => createLogger('SettingsBackupSection'), []);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadBackups = useCallback(async () => {
    if (!window?.electronAPI?.settings?.listBackups) return;
    if (!isMountedRef.current) return;
    setIsLoading(true);
    try {
      const res = await window.electronAPI.settings.listBackups();
      if (!isMountedRef.current) return;
      if (res?.success && Array.isArray(res.backups)) {
        setBackups(res.backups);
      } else {
        setBackups([]);
      }
    } catch (e) {
      logger.debug('[SettingsBackupSection] listBackups failed', { error: e?.message });
      if (!isMountedRef.current) return;
      setBackups([]);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [logger]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleCreateBackup = useCallback(async () => {
    if (!window?.electronAPI?.settings?.createBackup) return;
    if (!isMountedRef.current) return;
    setIsCreating(true);
    try {
      const res = await window.electronAPI.settings.createBackup();
      if (!isMountedRef.current) return;
      if (res?.success) {
        addNotification('Backup created successfully', 'success');
        loadBackups();
      } else {
        addNotification(res?.error || 'Failed to create backup', 'error');
      }
    } catch {
      addNotification('Failed to create backup', 'error');
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
    }
  }, [addNotification, loadBackups]);

  const handleRestoreBackup = useCallback(
    async (backupPath) => {
      if (!window?.electronAPI?.settings?.restoreBackup) return;
      if (!isMountedRef.current) return;
      setIsRestoring(backupPath);
      try {
        const res = await window.electronAPI.settings.restoreBackup(backupPath);
        if (!isMountedRef.current) return;
        if (res?.success) {
          addNotification('Backup restored. Reload to apply changes.', 'success');
        } else {
          addNotification(res?.error || 'Failed to restore backup', 'error');
        }
      } catch {
        addNotification('Failed to restore backup', 'error');
      } finally {
        if (isMountedRef.current) {
          setIsRestoring(null);
        }
      }
    },
    [addNotification]
  );

  const handleDeleteBackup = useCallback(
    async (backupPath) => {
      if (!window?.electronAPI?.settings?.deleteBackup) return;
      if (!isMountedRef.current) return;
      setIsDeleting(backupPath);
      try {
        const res = await window.electronAPI.settings.deleteBackup(backupPath);
        if (!isMountedRef.current) return;
        if (res?.success) {
          addNotification('Backup deleted', 'success');
          loadBackups();
        } else {
          addNotification(res?.error || 'Failed to delete backup', 'error');
        }
      } catch {
        addNotification('Failed to delete backup', 'error');
      } finally {
        if (isMountedRef.current) {
          setIsDeleting(null);
        }
      }
    },
    [addNotification, loadBackups]
  );

  const handleExport = useCallback(async () => {
    if (!window?.electronAPI?.settings?.export) return;
    if (!isMountedRef.current) return;
    setIsExporting(true);
    try {
      const res = await window.electronAPI.settings.export();
      if (!isMountedRef.current) return;
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
      if (isMountedRef.current) {
        setIsExporting(false);
      }
    }
  }, [addNotification]);

  const handleImport = useCallback(async () => {
    if (!window?.electronAPI?.settings?.import) return;
    if (!isMountedRef.current) return;
    setIsImporting(true);
    try {
      const res = await window.electronAPI.settings.import();
      if (!isMountedRef.current) return;
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
      if (isMountedRef.current) {
        setIsImporting(false);
      }
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
    <SettingsCard
      title="Settings backup & restore"
      description="Create backups or export/import settings across devices."
      headerAction={
        <IconButton
          icon={<RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />}
          size="sm"
          variant="secondary"
          onClick={loadBackups}
          aria-label="Refresh backup list"
          title="Refresh"
          disabled={isLoading}
        />
      }
    >
      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={handleCreateBackup}
          variant="secondary"
          disabled={isCreating}
          size="sm"
          className="flex items-center gap-1.5"
        >
          <Clock className="w-4 h-4" />
          {isCreating ? 'Creating...' : 'Create Backup'}
        </Button>
        <Button
          onClick={handleExport}
          variant="secondary"
          disabled={isExporting}
          size="sm"
          className="flex items-center gap-1.5"
        >
          <Download className="w-4 h-4" />
          {isExporting ? 'Exporting...' : 'Export to File'}
        </Button>
        <Button
          onClick={handleImport}
          variant="secondary"
          disabled={isImporting}
          size="sm"
          className="flex items-center gap-1.5"
        >
          <Upload className="w-4 h-4" />
          {isImporting ? 'Importing...' : 'Import from File'}
        </Button>
      </div>

      {/* Backup List */}
      {backups.length > 0 && (
        <div className="space-y-2">
          <Text as="label" variant="tiny" className="block font-medium text-system-gray-600">
            Available Backups ({backups.length})
          </Text>
          <div className="max-h-40 overflow-y-auto space-y-1.5 border border-border-soft rounded-xl p-3 bg-surface-muted">
            {backups.map((backup) => (
              <div
                key={backup.path || backup.name}
                className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border-soft bg-white"
              >
                <div className="min-w-0 flex-1">
                  <Text variant="small" className="font-medium text-system-gray-700 truncate">
                    {backup.name || 'Backup'}
                  </Text>
                  <Text variant="tiny" className="text-system-gray-500">
                    {formatDate(backup.timestamp || backup.created)}
                  </Text>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    icon={<RotateCcw className="w-4 h-4" />}
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRestoreBackup(backup.path)}
                    aria-label="Restore this backup"
                    title="Restore"
                    disabled={isRestoring === backup.path}
                  />
                  <IconButton
                    icon={<Trash2 className="w-4 h-4" />}
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
    </SettingsCard>
  );
}

SettingsBackupSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default SettingsBackupSection;
