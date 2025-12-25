import React, { useEffect, useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { RefreshCw } from 'lucide-react';
import { logger } from '../../../shared/logger';

/**
 * Embedding rebuild section for folder and file embeddings
 */
function EmbeddingRebuildSection({ addNotification }) {
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  logger.setContext('EmbeddingRebuildSection');

  const refreshStats = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.getStats) return;
    setIsLoadingStats(true);
    try {
      const res = await window.electronAPI.embeddings.getStats();
      if (res && res.success) {
        setStats({
          files: typeof res.files === 'number' ? res.files : 0,
          folders: typeof res.folders === 'number' ? res.folders : 0,
          initialized: Boolean(res.initialized),
          serverUrl: res.serverUrl || ''
        });
      } else {
        setStats(null);
      }
    } catch (e) {
      logger.debug('[EmbeddingRebuildSection] getStats failed', { error: e?.message });
      setStats(null);
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const statsLabel = useMemo(() => {
    if (!stats) return 'Embeddings status unavailable';
    return `${stats.folders} folder embeddings • ${stats.files} file embeddings`;
  }, [stats]);

  const handleRebuildFolders = useCallback(async () => {
    try {
      setIsRebuildingFolders(true);
      const res = await window.electronAPI.embeddings.rebuildFolders();
      addNotification(
        res?.success
          ? `Rebuilt ${res.folders || 0} folder embeddings`
          : `Failed: ${res?.error || 'Unknown error'}`,
        res?.success ? 'success' : 'error'
      );
    } catch (e) {
      addNotification(`Failed: ${e.message}`, 'error');
    } finally {
      setIsRebuildingFolders(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  const handleRebuildFiles = useCallback(async () => {
    try {
      setIsRebuildingFiles(true);
      const res = await window.electronAPI.embeddings.rebuildFiles();
      addNotification(
        res?.success
          ? `Rebuilt ${res.files || 0} file embeddings`
          : `Failed: ${res?.error || 'Unknown error'}`,
        res?.success ? 'success' : 'error'
      );
    } catch (e) {
      addNotification(`Failed: ${e.message}`, 'error');
    } finally {
      setIsRebuildingFiles(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="block text-sm font-medium text-system-gray-700 mb-2">
            Embeddings maintenance
          </label>
          <p className="text-xs text-system-gray-500">
            {statsLabel}
            {stats?.serverUrl ? ` • ${stats.serverUrl}` : ''}
          </p>
        </div>
        <IconButton
          icon={<RefreshCw className={`w-4 h-4 ${isLoadingStats ? 'animate-spin' : ''}`} />}
          size="sm"
          variant="secondary"
          onClick={refreshStats}
          aria-label="Refresh embeddings stats"
          title="Refresh stats"
          disabled={isLoadingStats}
        />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          onClick={handleRebuildFolders}
          variant="secondary"
          disabled={isRebuildingFolders}
          type="button"
          title="Rebuild folder embeddings"
          size="sm"
          className="shrink-0"
        >
          {isRebuildingFolders ? 'Rebuilding…' : 'Rebuild Folder Embeddings'}
        </Button>
        <Button
          onClick={handleRebuildFiles}
          variant="secondary"
          disabled={isRebuildingFiles}
          type="button"
          title="Rebuild file embeddings from analysis history"
          size="sm"
          className="shrink-0"
        >
          {isRebuildingFiles ? 'Rebuilding…' : 'Rebuild File Embeddings'}
        </Button>
      </div>
    </div>
  );
}

EmbeddingRebuildSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default EmbeddingRebuildSection;
