import React, { useEffect, useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import { logger } from '../../../shared/logger';
import { useAppSelector } from '../../store/hooks';

/**
 * Embedding rebuild section for folder and file embeddings
 */
function EmbeddingRebuildSection({ addNotification }) {
  const [isRebuildingFolders, setIsRebuildingFolders] = useState(false);
  const [isRebuildingFiles, setIsRebuildingFiles] = useState(false);
  const [isFullRebuilding, setIsFullRebuilding] = useState(false);
  const [isReanalyzingAll, setIsReanalyzingAll] = useState(false);
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isAnalyzing = useAppSelector((state) => Boolean(state?.analysis?.isAnalyzing));
  const analysisProgress = useAppSelector((state) => state?.analysis?.analysisProgress);

  logger.setContext('EmbeddingRebuildSection');

  const refreshStats = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.getStats) return;
    setIsLoadingStats(true);
    try {
      const res = await window.electronAPI.embeddings.getStats();
      // FIX: Better logging to diagnose embedding count issues
      logger.debug('[EmbeddingRebuildSection] getStats response', {
        success: res?.success,
        files: res?.files,
        folders: res?.folders,
        error: res?.error
      });
      if (res && res.success) {
        setStats({
          files: typeof res.files === 'number' ? res.files : 0,
          folders: typeof res.folders === 'number' ? res.folders : 0,
          initialized: Boolean(res.initialized),
          serverUrl: res.serverUrl || '',
          // FIX: Pass through needsFileEmbeddingRebuild and analysisHistory for proper display
          needsFileEmbeddingRebuild: res.needsFileEmbeddingRebuild,
          analysisHistory: res.analysisHistory,
          embeddingIndex: res.embeddingIndex,
          activeEmbeddingModel: res.activeEmbeddingModel,
          embeddingModelMismatch: Boolean(res.embeddingModelMismatch)
        });
      } else {
        logger.warn('[EmbeddingRebuildSection] getStats returned failure', { error: res?.error });
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
    // Avoid unhandled promise rejections and ensure the interval gets cleared if refresh fails unexpectedly.
    refreshStats().catch((err) => {
      logger.debug('[EmbeddingRebuildSection] Initial stats refresh failed', {
        error: err?.message
      });
    });

    // FIX: Auto-refresh stats periodically while component is mounted
    // This ensures the count updates after embeddings are added
    const intervalId = setInterval(() => {
      refreshStats().catch((err) => {
        logger.debug('[EmbeddingRebuildSection] Periodic stats refresh failed; stopping refresh', {
          error: err?.message
        });
        clearInterval(intervalId);
      });
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(intervalId);
  }, [refreshStats]);

  const statsLabel = useMemo(() => {
    if (isLoadingStats && !stats) return 'Loading embeddings status...';
    if (!stats) return 'Embeddings status unavailable - check Ollama connection';
    if (stats.embeddingModelMismatch) {
      const indexed = stats.embeddingIndex?.model ? `${stats.embeddingIndex.model}` : 'unknown';
      const active = stats.activeEmbeddingModel ? `${stats.activeEmbeddingModel}` : 'unknown';
      return `Embedding model mismatch: indexed with ${indexed}, configured ${active}. Run Full Rebuild to apply.`;
    }
    // FIX M-5: Show helpful context when embeddings are 0 but files have been analyzed
    if (stats.needsFileEmbeddingRebuild) {
      const analyzed = stats.analysisHistory?.totalFiles || 0;
      return `${stats.folders} folder embeddings • ${stats.files} file embeddings (${analyzed} files analyzed - click Rebuild to index)`;
    }
    if (stats.files === 0 && stats.folders === 0) {
      return 'No embeddings yet - analyze files and add smart folders first';
    }
    return `${stats.folders} folder embeddings • ${stats.files} file embeddings`;
  }, [stats, isLoadingStats]);

  const handleRebuildFolders = useCallback(async () => {
    try {
      setIsRebuildingFolders(true);
      const res = await window.electronAPI.embeddings.rebuildFolders();
      if (res?.success) {
        const count = res.folders || 0;
        addNotification(
          count > 0
            ? `Rebuilt ${count} folder embeddings`
            : 'No folders to rebuild. Add smart folders first.',
          count > 0 ? 'success' : 'info'
        );
      } else {
        // Provide actionable error message
        const errorMsg = res?.error || '';
        if (errorMsg.includes('Ollama') || errorMsg.includes('ECONNREFUSED')) {
          addNotification('Ollama not running. Start Ollama and try again.', 'error');
        } else if (errorMsg.includes('ChromaDB')) {
          addNotification('ChromaDB unavailable. Check Settings or restart the app.', 'error');
        } else {
          addNotification('Rebuild failed. Check Ollama connection in Settings.', 'error');
        }
      }
    } catch (e) {
      addNotification('Rebuild failed. Check Ollama is running.', 'error');
    } finally {
      setIsRebuildingFolders(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  const handleRebuildFiles = useCallback(async () => {
    try {
      setIsRebuildingFiles(true);
      const res = await window.electronAPI.embeddings.rebuildFiles();
      if (res?.success) {
        const count = res.files || 0;
        const totalUnique = typeof res.totalUniqueFiles === 'number' ? res.totalUniqueFiles : null;
        addNotification(
          count > 0
            ? totalUnique != null && totalUnique > 0
              ? `Indexed ${count} of ${totalUnique} files for semantic search`
              : `Indexed ${count} files for semantic search`
            : 'No analyzed files found. Analyze files in Discover first.',
          count > 0 ? 'success' : 'info'
        );
      } else {
        // Provide actionable error message
        const errorMsg = res?.error || '';
        if (errorMsg.includes('Ollama') || errorMsg.includes('ECONNREFUSED')) {
          addNotification('Ollama not running. Start Ollama and try again.', 'error');
        } else if (errorMsg.includes('ChromaDB')) {
          addNotification('ChromaDB unavailable. Check Settings or restart the app.', 'error');
        } else {
          addNotification('Indexing failed. Check Ollama connection in Settings.', 'error');
        }
      }
    } catch (e) {
      addNotification('Indexing failed. Check Ollama is running.', 'error');
    } finally {
      setIsRebuildingFiles(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  const handleFullRebuild = useCallback(async () => {
    try {
      setIsFullRebuilding(true);
      addNotification('Starting full rebuild... This may take a while.', 'info');
      const res = await window.electronAPI.embeddings.fullRebuild();
      if (res?.success) {
        const folders = res.folders || 0;
        const files = res.files || 0;
        const chunks = res.chunks || 0;
        addNotification(
          `Full rebuild complete: ${folders} folders, ${files} files, ${chunks} chunks${res.model ? ` (model: ${res.model})` : ''}`,
          'success'
        );
      } else {
        // Provide actionable error message
        const errorMsg = res?.error || '';
        if (errorMsg.includes('Ollama') || errorMsg.includes('ECONNREFUSED')) {
          addNotification('Ollama not running. Start Ollama and try again.', 'error');
        } else if (errorMsg.includes('ChromaDB')) {
          addNotification('ChromaDB unavailable. Check Settings or restart the app.', 'error');
        } else if (errorMsg.includes('MODEL_NOT_AVAILABLE')) {
          addNotification(
            `Embedding model not available. Pull it first: ${res.model || 'nomic-embed-text'}`,
            'error'
          );
        } else {
          addNotification('Full rebuild failed. Check Ollama connection in Settings.', 'error');
        }
      }
    } catch (e) {
      addNotification('Full rebuild failed. Check Ollama is running.', 'error');
    } finally {
      setIsFullRebuilding(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  const handleReanalyzeAll = useCallback(async () => {
    try {
      setIsReanalyzingAll(true);
      addNotification('Starting reanalysis of all files... This may take a while.', 'info');
      const res = await window.electronAPI.embeddings.reanalyzeAll();
      if (res?.success) {
        addNotification(
          `Queued ${res.queued} files for reanalysis. Analysis will run in the background.`,
          'success'
        );
      } else {
        const errorMsg = res?.error || '';
        if (errorMsg.includes('Ollama') || errorMsg.includes('ECONNREFUSED')) {
          addNotification('Ollama not running. Start Ollama and try again.', 'error');
        } else if (errorMsg.includes('WATCHER_NOT_AVAILABLE')) {
          addNotification('Configure smart folders first before reanalyzing.', 'error');
        } else if (errorMsg.includes('MODEL_NOT_AVAILABLE')) {
          addNotification(
            `Embedding model not available. Pull it first: ${res.model || 'nomic-embed-text'}`,
            'error'
          );
        } else {
          addNotification(
            res?.error || 'Reanalyze failed. Check Ollama connection in Settings.',
            'error'
          );
        }
      }
    } catch (e) {
      addNotification('Reanalyze failed. Check Ollama is running.', 'error');
    } finally {
      setIsReanalyzingAll(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  const analysisIsActive = Boolean(isAnalyzing && (analysisProgress?.total || 0) > 0);
  const analysisCurrent = Number.isFinite(analysisProgress?.current) ? analysisProgress.current : 0;
  const analysisTotal = Number.isFinite(analysisProgress?.total) ? analysisProgress.total : 0;

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Embeddings maintenance
        </label>
        <p className="text-xs text-system-gray-500">
          {statsLabel}
          {stats?.serverUrl ? ` • ${stats.serverUrl}` : ''}
        </p>
        <p className="text-xs text-system-gray-400 mt-1">
          When changing embedding models, use <strong>Rebuild All Embeddings</strong> to update
          everything. This preserves your analysis data but regenerates the search index.
        </p>
        {analysisIsActive && (
          <p className="text-xs text-system-gray-500 mt-2">
            Background analysis running: {analysisCurrent}/{analysisTotal} files
          </p>
        )}
      </div>

      {/* Primary Action: Full Rebuild */}
      <div className="pt-2">
        <Button
          onClick={handleFullRebuild}
          variant="primary"
          disabled={
            isFullRebuilding || isRebuildingFolders || isRebuildingFiles || isReanalyzingAll
          }
          isLoading={isFullRebuilding}
          type="button"
          title="Clear all embeddings and rebuild everything with current model"
          size="sm"
          className="shrink-0 w-full sm:w-auto"
        >
          {isFullRebuilding ? 'Rebuilding All Embeddings…' : 'Rebuild All Embeddings'}
        </Button>
        <p className="text-xs text-system-gray-500 mt-2">
          Use this after changing the embedding model setting. It updates folder matches, file
          search, and sorting.
        </p>
      </div>

      {/* Advanced Options Toggle */}
      <div className="pt-4 border-t border-system-gray-100">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 font-medium focus:outline-none"
        >
          {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
          <svg
            className={`w-3 h-3 transform transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4 pl-4 border-l-2 border-system-gray-100">
            {/* Partial Rebuilds */}
            <div>
              <label className="block text-xs font-medium text-system-gray-700 mb-2">
                Partial Updates (Use only for specific troubleshooting)
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={handleRebuildFolders}
                  variant="secondary"
                  disabled={isRebuildingFolders || isFullRebuilding}
                  isLoading={isRebuildingFolders}
                  type="button"
                  title="Rebuild folder embeddings"
                  size="sm"
                  className="shrink-0"
                >
                  {isRebuildingFolders ? 'Rebuilding…' : 'Rebuild Folders Only'}
                </Button>
                <Button
                  onClick={handleRebuildFiles}
                  variant="secondary"
                  disabled={isRebuildingFiles || isFullRebuilding}
                  isLoading={isRebuildingFiles}
                  type="button"
                  title="Rebuild file embeddings from analysis history"
                  size="sm"
                  className="shrink-0"
                >
                  {isRebuildingFiles ? 'Rebuilding…' : 'Rebuild Files Only'}
                </Button>
              </div>
            </div>

            {/* Reanalyze All (Destructive) */}
            <div className="pt-2 border-t border-system-gray-100">
              <label className="block text-xs font-medium text-red-700 mb-2">Danger Zone</label>
              <p className="text-xs text-system-gray-500 mb-2">
                <strong>Reanalyze All Files</strong> will delete all analysis history and re-process
                every file with the LLM. Use this only if you changed the <em>Text/Vision Model</em>{' '}
                (not just the embedding model).
              </p>
              <Button
                onClick={handleReanalyzeAll}
                variant="danger"
                disabled={
                  isReanalyzingAll ||
                  analysisIsActive ||
                  isFullRebuilding ||
                  isRebuildingFolders ||
                  isRebuildingFiles
                }
                isLoading={isReanalyzingAll || analysisIsActive}
                type="button"
                title="Clear all data and reanalyze every file with current AI models"
                size="sm"
                className="shrink-0"
              >
                {isReanalyzingAll
                  ? 'Starting Reanalysis…'
                  : analysisIsActive
                    ? `Reanalyzing… ${analysisCurrent}/${analysisTotal}`
                    : 'Reanalyze All Files (Slow)'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

EmbeddingRebuildSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default EmbeddingRebuildSection;
