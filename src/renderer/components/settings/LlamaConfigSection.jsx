import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { AlertCircle, CheckCircle2, Cpu, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import StatusBadge from '../ui/StatusBadge';
import SettingsCard from './SettingsCard';
import SettingsGroup from './SettingsGroup';
import StateMessage from '../ui/StateMessage';
import { Text } from '../ui/Typography';
import SettingRow from './SettingRow';

/**
 * Llama AI configuration section
 * Displays local model status and management for node-llama-cpp
 * No external server required - all processing is in-process
 */
function LlamaConfigSection({
  llamaHealth,
  isRefreshingModels = false,
  downloadProgress,
  modelList = [],
  showAllModels,
  setShowAllModels,
  onRefreshModels,
  onDownloadModel,
  onDeleteModel
}) {
  const healthBadge = useMemo(() => {
    if (downloadProgress) {
      return {
        variant: 'info',
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        label: `Downloading: ${downloadProgress.percent || 0}%`
      };
    }
    if (!llamaHealth) {
      return {
        variant: 'info',
        icon: <Cpu className="w-4 h-4" />,
        label: 'Initializing AI...'
      };
    }
    const isHealthy = llamaHealth.status === 'healthy' || llamaHealth.initialized;
    return {
      variant: isHealthy ? 'success' : 'error',
      icon: isHealthy ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />,
      label: isHealthy
        ? `Ready (${llamaHealth.gpuBackend || 'CPU'})`
        : `Error${llamaHealth.error ? `: ${llamaHealth.error}` : ''}`
    };
  }, [llamaHealth, downloadProgress]);

  const modelCountLabel = useMemo(() => {
    const count = modelList?.length ?? 0;
    if (!count) return 'No models downloaded';
    if (count === 1) return '1 model available';
    return `${count} models available`;
  }, [modelList]);

  const gpuInfo = useMemo(() => {
    const backend = llamaHealth?.gpuBackend;
    if (!backend) return null;
    if (backend === 'metal') return 'Apple Metal (GPU accelerated)';
    if (backend === 'cuda') return 'NVIDIA CUDA (GPU accelerated)';
    if (backend === 'vulkan') return 'Vulkan (GPU accelerated)';
    if (backend === 'cpu' || backend === false) return 'CPU only (no GPU backend)';
    return String(backend);
  }, [llamaHealth]);

  const detectedGpu = useMemo(() => {
    const detected = llamaHealth?.gpuDetected;
    if (!detected || typeof detected !== 'object') return null;
    return {
      name: detected.name || 'Unknown GPU',
      type: detected.type || null,
      vramMB: Number.isFinite(detected.vramMB) ? detected.vramMB : null
    };
  }, [llamaHealth]);

  const isCpuBackend =
    llamaHealth?.gpuBackend === 'cpu' ||
    llamaHealth?.gpuBackend === false ||
    !llamaHealth?.gpuBackend;

  return (
    <SettingsCard
      title="Local AI Engine"
      description="StratoSort uses on-device AI for complete privacy. No data leaves your computer."
      headerAction={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={healthBadge.variant} className="whitespace-nowrap">
            <span className="flex items-center gap-2">
              {healthBadge.icon}
              <span className="truncate">{healthBadge.label}</span>
            </span>
          </StatusBadge>
          <Text
            as="div"
            variant="tiny"
            className="text-system-gray-500 px-3 py-1 rounded-full bg-surface-muted border border-border-soft whitespace-nowrap"
          >
            {modelCountLabel}
          </Text>
        </div>
      }
    >
      {(gpuInfo || detectedGpu) && (
        <SettingRow
          layout="col"
          label="GPU Acceleration"
          description="AI processing is accelerated using your device's GPU when available."
          className="space-y-2"
        >
          <SettingsGroup gap="compact">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-system-gray-500" />
              <Text variant="small" className="font-medium">
                AI backend: {gpuInfo || 'Unknown'}
              </Text>
            </div>
            {detectedGpu && (
              <Text variant="tiny" className="text-system-gray-600">
                System GPU detected: {detectedGpu.name}
                {detectedGpu.vramMB ? ` (${detectedGpu.vramMB} MB VRAM)` : ''}
              </Text>
            )}
            {isCpuBackend && detectedGpu?.type && detectedGpu.type !== 'cpu' && (
              <Text variant="tiny" className="text-stratosort-warning">
                GPU detected but the AI backend is running on CPU. Update GPU drivers and ensure
                Vulkan/CUDA runtimes are installed.
              </Text>
            )}
          </SettingsGroup>
        </SettingRow>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onRefreshModels}
          variant="secondary"
          type="button"
          title="Refresh models"
          disabled={isRefreshingModels}
          leftIcon={
            isRefreshingModels ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )
          }
          size="sm"
          className="min-w-[9rem] justify-center"
        >
          {isRefreshingModels ? 'Refreshing…' : 'Refresh Models'}
        </Button>
        <Button
          onClick={() => setShowAllModels((v) => !v)}
          variant="subtle"
          type="button"
          title="Toggle model list"
          size="sm"
          className="min-w-[9rem] justify-center"
        >
          {showAllModels ? 'Hide Models' : 'View All Models'}
        </Button>
        <Text
          as="div"
          variant="tiny"
          className="flex-1 min-w-[240px] text-system-gray-600 flex items-center gap-2"
        >
          {downloadProgress ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-system-gray-500" />
              <span className="truncate" title={`Downloading ${downloadProgress.modelName}`}>
                {downloadProgress.modelName}: {downloadProgress.percent}%
              </span>
            </>
          ) : (
            <span className="truncate">
              {llamaHealth?.initialized
                ? 'AI engine ready. All processing happens locally.'
                : 'Initializing local AI engine...'}
            </span>
          )}
        </Text>
      </div>

      {showAllModels && (
        <SettingsGroup gap="compact">
          <div className="flex items-center justify-between gap-2">
            <Text variant="small" className="font-medium text-system-gray-700">
              Downloaded Models
            </Text>
            <Text variant="tiny" className="text-system-gray-500">
              {modelCountLabel}
            </Text>
          </div>
          {!modelList || modelList.length === 0 ? (
            <StateMessage
              icon={AlertCircle}
              tone="warning"
              size="sm"
              align="left"
              title="No models downloaded"
              description="Download models to enable AI features."
              className="py-2"
              contentClassName="max-w-xs"
            />
          ) : (
            <ul className="space-y-2">
              {modelList.map((model) => (
                <li
                  key={model.name || model.filename}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border-soft bg-white shadow-sm"
                >
                  <div className="flex-1 min-w-0">
                    <Text variant="small" className="font-mono truncate block">
                      {model.displayName || model.name || model.filename}
                    </Text>
                    <Text variant="tiny" className="text-system-gray-500">
                      {model.type} • {model.sizeMB ? `${model.sizeMB}MB` : 'Unknown size'}
                    </Text>
                  </div>
                  {onDeleteModel && (
                    <Button
                      onClick={() => onDeleteModel(model.name || model.filename)}
                      variant="ghost"
                      size="sm"
                      title="Delete model"
                      className="text-stratosort-danger hover:opacity-90"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {onDownloadModel && (
            <div className="pt-3 border-t border-border-soft">
              <Button
                onClick={onDownloadModel}
                variant="secondary"
                size="sm"
                leftIcon={<Download className="w-4 h-4" />}
              >
                Download Recommended Models
              </Button>
            </div>
          )}
        </SettingsGroup>
      )}
    </SettingsCard>
  );
}

LlamaConfigSection.propTypes = {
  llamaHealth: PropTypes.object,
  isRefreshingModels: PropTypes.bool,
  downloadProgress: PropTypes.object,
  modelList: PropTypes.array,
  showAllModels: PropTypes.bool.isRequired,
  setShowAllModels: PropTypes.func.isRequired,
  onRefreshModels: PropTypes.func.isRequired,
  onDownloadModel: PropTypes.func,
  onDeleteModel: PropTypes.func
};

export default LlamaConfigSection;
