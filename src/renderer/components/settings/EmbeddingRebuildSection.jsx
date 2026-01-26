import React, { useEffect, useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import { logger } from '../../../shared/logger';
import { useAppSelector } from '../../store/hooks';
import { Text } from '../ui/Typography';
import { Stack } from '../layout';

/**
 * Embedding rebuild section for folder and file embeddings
 */
function EmbeddingRebuildSection({ addNotification }) {
  const [isFullRebuilding, setIsFullRebuilding] = useState(false);
  const [isReanalyzingAll, setIsReanalyzingAll] = useState(false);
  const [stats, setStats] = useState(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [applyNamingOnReanalyze, setApplyNamingOnReanalyze] = useState(false);

  const isAnalyzing = useAppSelector((state) => Boolean(state?.analysis?.isAnalyzing));
  const analysisProgress = useAppSelector((state) => state?.analysis?.analysisProgress);

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
          serverUrl: res.serverUrl || '',
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
    let timerId;
    let errorCount = 0;
    let isMounted = true;

    const scheduleNext = () => {
      if (!isMounted) return;
      const delay = Math.min(5000 * 2 ** errorCount, 60000);

      timerId = setTimeout(() => {
        if (!isMounted) return;
        if (document.hidden) {
          scheduleNext();
          return;
        }

        refreshStats()
          .then(() => {
            if (isMounted) {
              errorCount = 0;
              scheduleNext();
            }
          })
          .catch((err) => {
            if (isMounted) {
              logger.debug('[EmbeddingRebuildSection] Stats refresh failed', {
                error: err?.message,
                nextRetryMs: delay * 2
              });
              errorCount++;
              scheduleNext();
            }
          });
      }, delay);
    };

    refreshStats()
      .catch((err) => {
        logger.debug('[EmbeddingRebuildSection] Initial stats refresh failed', {
          error: err?.message
        });
      })
      .finally(() => {
        if (isMounted) scheduleNext();
      });

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
    };
  }, [refreshStats]);

  const statsLabel = useMemo(() => {
    if (isLoadingStats && !stats) return 'Loading embeddings status...';
    if (!stats) return 'Embeddings status unavailable - check Ollama connection';
    if (stats.embeddingModelMismatch) {
      const indexed = stats.embeddingIndex?.model ? `${stats.embeddingIndex.model}` : 'unknown';
      const active = stats.activeEmbeddingModel ? `${stats.activeEmbeddingModel}` : 'unknown';
      return `Embedding model mismatch: indexed with ${indexed}, configured ${active}. Run Full Rebuild to apply.`;
    }
    if (stats.needsFileEmbeddingRebuild) {
      const analyzed = stats.analysisHistory?.totalFiles || 0;
      return `${stats.folders} folder embeddings • ${stats.files} file embeddings (${analyzed} files analyzed - click Rebuild to index)`;
    }
    if (stats.files === 0 && stats.folders === 0) {
      return 'No embeddings yet - analyze files and add smart folders first';
    }
    return `${stats.folders} folder embeddings • ${stats.files} file embeddings`;
  }, [stats, isLoadingStats]);

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
        const errorMsg = res?.error || '';
        if (errorMsg.includes('Ollama') || errorMsg.includes('ECONNREFUSED')) {
          addNotification('Ollama not running. Start Ollama and try again.', 'error');
        } else if (errorMsg.includes('ChromaDB')) {
          addNotification('ChromaDB unavailable. Check Settings or restart the app.', 'error');
        } else if (errorMsg.includes('MODEL_NOT_AVAILABLE')) {
          const modelLabel =
            res?.modelType === 'text'
              ? 'Text model'
              : res?.modelType === 'vision'
                ? 'Vision model'
                : 'Embedding model';
          addNotification(
            `${modelLabel} not available. Pull it first: ${res.model || 'nomic-embed-text'}`,
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
      const res = await window.electronAPI.embeddings.reanalyzeAll({
        applyNaming: applyNamingOnReanalyze
      });
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
  }, [addNotification, refreshStats, applyNamingOnReanalyze]);

  const analysisIsActive = Boolean(isAnalyzing && (analysisProgress?.total || 0) > 0);
  const analysisCurrent = Number.isFinite(analysisProgress?.current) ? analysisProgress.current : 0;
  const analysisTotal = Number.isFinite(analysisProgress?.total) ? analysisProgress.total : 0;

  return (
    <Stack gap="default">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Embeddings maintenance
        </label>
        <Text variant="small" className="text-system-gray-500">
          {statsLabel}
          {stats?.serverUrl ? ` • ${stats.serverUrl}` : ''}
        </Text>
        <Text variant="tiny" className="text-system-gray-400 mt-1">
          When changing embedding models, use <strong>Rebuild All Embeddings</strong> to update
          everything. This preserves your analysis data but regenerates the search index.
        </Text>
        {analysisIsActive && (
          <Text variant="tiny" className="text-system-gray-500 mt-2">
            Background analysis running: {analysisCurrent}/{analysisTotal} files
          </Text>
        )}
      </div>

      {/* Primary Action: Full Rebuild */}
      <div className="pt-2">
        <Button
          onClick={handleFullRebuild}
          variant="primary"
          disabled={isFullRebuilding || isReanalyzingAll}
          isLoading={isFullRebuilding}
          type="button"
          title="Clear all embeddings and rebuild everything with current model"
          size="sm"
          className="shrink-0 w-full sm:w-auto"
        >
          {isFullRebuilding ? 'Rebuilding All Embeddings…' : 'Rebuild All Embeddings'}
        </Button>
        <Text variant="tiny" className="text-system-gray-500 mt-2">
          Use this after changing the embedding model setting. It updates folder matches, file
          search, and sorting.
        </Text>
      </div>

      {/* Advanced Options Toggle */}
      <div className="pt-4 border-t border-system-gray-100">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-stratosort-blue hover:text-stratosort-blue/80 flex items-center gap-1 font-medium focus:outline-none"
        >
          <Text as="span" variant="tiny">
            {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
          </Text>
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
            {/* Reanalyze All (Destructive) */}
            <div className="pt-2 border-t border-system-gray-100">
              <Text
                as="label"
                variant="tiny"
                className="block font-medium text-stratosort-danger mb-2"
              >
                Danger Zone
              </Text>
              <Text variant="tiny" className="text-system-gray-500 mb-2">
                <strong>Reanalyze All Files</strong> will delete all analysis history and re-process
                every file with the LLM. Use this only if you changed the <em>Text/Vision Model</em>{' '}
                (not just the embedding model).
              </Text>
              <div className="mb-3">
                <div className="flex items-center gap-3">
                  <Switch
                    id="apply-naming-on-reanalyze"
                    checked={applyNamingOnReanalyze}
                    onChange={setApplyNamingOnReanalyze}
                    disabled={isReanalyzingAll || analysisIsActive || isFullRebuilding}
                  />
                  <label
                    htmlFor="apply-naming-on-reanalyze"
                    className="text-sm font-medium text-system-gray-700"
                  >
                    Apply naming conventions to files during reanalysis
                  </label>
                </div>
                <Text variant="tiny" className="text-system-gray-400 mt-1 ml-14">
                  When enabled, files will be renamed according to your naming convention settings.
                  When disabled, original file names will be preserved.
                </Text>
              </div>
              <Button
                onClick={handleReanalyzeAll}
                variant="danger"
                disabled={isReanalyzingAll || analysisIsActive || isFullRebuilding}
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
    </Stack>
  );
}

EmbeddingRebuildSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default EmbeddingRebuildSection;
