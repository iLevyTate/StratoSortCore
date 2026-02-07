import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { AlertCircle, CheckCircle2, Cpu, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import Button from '../ui/Button';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
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
    if (!llamaHealth?.gpuBackend) return null;
    const backend = llamaHealth.gpuBackend;
    if (backend === 'metal') return 'Apple Metal GPU';
    if (backend === 'cuda') return 'NVIDIA CUDA GPU';
    if (backend === 'vulkan') return 'Vulkan GPU';
    if (backend === 'cpu' || backend === false) return 'CPU (no GPU detected)';
    return backend;
  }, [llamaHealth]);

  return (
    <Card variant="default" className="space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Text
            variant="tiny"
            className="font-semibold uppercase tracking-wide text-system-gray-500"
          >
            Local AI Engine
          </Text>
          <Text variant="small" className="text-system-gray-600">
            StratoSort uses on-device AI for complete privacy. No data leaves your computer.
          </Text>
        </div>
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
            className="text-system-gray-500 px-3 py-1 rounded-full bg-system-gray-100 border border-system-gray-200 whitespace-nowrap"
          >
            {modelCountLabel}
          </Text>
        </div>
      </div>

      {gpuInfo && (
        <SettingRow
          layout="col"
          label="GPU Acceleration"
          description="AI processing is accelerated using your device's GPU when available."
          className="space-y-2"
        >
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-system-gray-50 border border-system-gray-200">
            <Cpu className="w-5 h-5 text-system-gray-500" />
            <Text variant="small" className="font-medium">
              {gpuInfo}
            </Text>
          </div>
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
        <div className="p-4 bg-system-gray-50 rounded-lg border border-system-gray-200 space-y-2">
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
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded border border-system-gray-200 bg-white shadow-sm"
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
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {onDownloadModel && (
            <div className="pt-3 border-t border-system-gray-200">
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
        </div>
      )}
    </Card>
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
