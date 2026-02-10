import React, { useEffect, useMemo, useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import { ChevronDown } from 'lucide-react';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import SettingsCard from './SettingsCard';
import SettingsGroup from './SettingsGroup';
import { createLogger } from '../../../shared/logger';
import { useAppSelector } from '../../store/hooks';
import { Text } from '../ui/Typography';

const { DEFAULT_AI_MODELS } = require('../../../shared/constants');
const logger = createLogger('EmbeddingRebuildSection');

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
  const isMountedRef = React.useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isAnalyzing = useAppSelector((state) => Boolean(state?.analysis?.isAnalyzing));
  const analysisProgress = useAppSelector((state) => state?.analysis?.analysisProgress);

  const refreshStats = useCallback(async () => {
    if (!window?.electronAPI?.embeddings?.getStats) return;
    if (isMountedRef.current) setIsLoadingStats(true);
    try {
      const res = await window.electronAPI.embeddings.getStats();
      if (isMountedRef.current) {
        if (res && res.success) {
          setStats({
            files: typeof res.files === 'number' ? res.files : 0,
            folders: typeof res.folders === 'number' ? res.folders : 0,
            initialized: Boolean(res.initialized),
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
      }
    } catch (e) {
      if (isMountedRef.current) {
        logger.debug('[EmbeddingRebuildSection] getStats failed', { error: e?.message });
        setStats(null);
      }
    } finally {
      if (isMountedRef.current) setIsLoadingStats(false);
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
    if (!stats) return 'Embeddings status unavailable - check AI engine status';
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
      if (!window?.electronAPI?.embeddings?.fullRebuild) {
        addNotification('Embedding API not available', 'error');
        return;
      }
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
        const code = res?.code || '';
        if (
          code === 'AI_ENGINE_UNAVAILABLE' ||
          errorMsg.includes('AI engine') ||
          errorMsg.includes('ECONNREFUSED')
        ) {
          addNotification('AI engine unavailable. Check models and try again.', 'error');
        } else if (code === 'VECTOR_DB_UNAVAILABLE' || code === 'VECTOR_DB_PENDING') {
          addNotification(
            'Vector DB is initializing. Please wait a moment and try again.',
            'error'
          );
        } else if (errorMsg.includes('Vector DB')) {
          addNotification('Vector DB unavailable. Check Settings or restart the app.', 'error');
        } else if (errorMsg.includes('MODEL_NOT_AVAILABLE')) {
          const modelLabel =
            res?.modelType === 'text'
              ? 'Text model'
              : res?.modelType === 'vision'
                ? 'Vision model'
                : 'Embedding model';
          addNotification(
            `${modelLabel} not available. Download it first: ${res.model || DEFAULT_AI_MODELS.EMBEDDING}`,
            'error'
          );
        } else {
          addNotification('Full rebuild failed. Check AI engine status in Settings.', 'error');
        }
      }
    } catch {
      addNotification('Full rebuild failed. Check AI engine status.', 'error');
    } finally {
      if (isMountedRef.current) setIsFullRebuilding(false);
      refreshStats();
    }
  }, [addNotification, refreshStats]);

  const handleReanalyzeAll = useCallback(async () => {
    try {
      if (isMountedRef.current) setIsReanalyzingAll(true);
      if (!window?.electronAPI?.embeddings?.reanalyzeAll) {
        addNotification('Embedding API not available', 'error');
        return;
      }
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
        const code = res?.code || '';
        if (
          code === 'AI_ENGINE_UNAVAILABLE' ||
          errorMsg.includes('AI engine') ||
          errorMsg.includes('ECONNREFUSED')
        ) {
          addNotification('AI engine unavailable. Check models and try again.', 'error');
        } else if (code === 'VECTOR_DB_UNAVAILABLE' || code === 'VECTOR_DB_PENDING') {
          addNotification(
            'Vector DB is initializing. Please wait a moment and try again.',
            'error'
          );
        } else if (errorMsg.includes('WATCHER_NOT_AVAILABLE')) {
          addNotification('Configure smart folders first before reanalyzing.', 'error');
        } else if (errorMsg.includes('MODEL_NOT_AVAILABLE')) {
          addNotification(
            `Embedding model not available. Download it first: ${res.model || DEFAULT_AI_MODELS.EMBEDDING}`,
            'error'
          );
        } else {
          addNotification(
            res?.error || 'Reanalyze failed. Check AI engine status in Settings.',
            'error'
          );
        }
      }
    } catch {
      addNotification('Reanalyze failed. Check AI engine status.', 'error');
    } finally {
      if (isMountedRef.current) setIsReanalyzingAll(false);
      refreshStats();
    }
  }, [addNotification, refreshStats, applyNamingOnReanalyze]);

  const analysisIsActive = Boolean(isAnalyzing && (analysisProgress?.total || 0) > 0);
  const analysisCurrent = Number.isFinite(analysisProgress?.current) ? analysisProgress.current : 0;
  const analysisTotal = Number.isFinite(analysisProgress?.total) ? analysisProgress.total : 0;

  return (
    <SettingsCard
      title="Embeddings maintenance"
      description="Rebuild embeddings and reanalyze files when models or indexing needs change."
    >
      <div className="space-y-6">
        <div>
          <Text variant="small" className="font-medium text-system-gray-700">
            Embeddings status
          </Text>
          <Text variant="small" className="text-system-gray-600">
            {statsLabel}
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
        <div className="pt-4 border-t border-border-soft">
          <Button
            onClick={() => setShowAdvanced(!showAdvanced)}
            variant="ghost"
            size="sm"
            rightIcon={
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
            }
            className="text-stratosort-blue hover:text-stratosort-blue/80"
          >
            {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
          </Button>

          {showAdvanced && (
            <SettingsGroup className="mt-4">
              {/* Reanalyze All (Destructive) */}
              <div>
                <Text
                  as="label"
                  variant="tiny"
                  className="block font-semibold uppercase tracking-wide text-stratosort-danger mb-2"
                >
                  Danger Zone
                </Text>
                <Text variant="tiny" className="text-system-gray-500 mb-2">
                  <strong>Reanalyze All Files</strong> will delete all analysis history and
                  re-process every file with the LLM. Use this only if you changed the{' '}
                  <em>Text/Vision Model</em> (not just the embedding model).
                </Text>
                <div className="mb-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="apply-naming-on-reanalyze"
                      checked={applyNamingOnReanalyze}
                      onChange={setApplyNamingOnReanalyze}
                      disabled={isReanalyzingAll || analysisIsActive || isFullRebuilding}
                    />
                    <Text
                      as="label"
                      htmlFor="apply-naming-on-reanalyze"
                      variant="small"
                      className="font-medium text-system-gray-700"
                    >
                      Apply naming conventions to files during reanalysis
                    </Text>
                  </div>
                  <Text variant="tiny" className="text-system-gray-400 mt-1 ml-14">
                    When enabled, files will be renamed according to your naming convention
                    settings. When disabled, original file names will be preserved.
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
            </SettingsGroup>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

EmbeddingRebuildSection.propTypes = {
  addNotification: PropTypes.func.isRequired
};

export default EmbeddingRebuildSection;
