import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle, Database, Info, FileText } from 'lucide-react';
import Select from '../ui/Select';
import StatusBadge from '../ui/StatusBadge';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import StateMessage from '../ui/StateMessage';
import { Text } from '../ui/Typography';
import { logger } from '../../../shared/logger';

const { getModel } = require('../../../shared/modelRegistry');

/**
 * Resolve the embedding dimension for a model name.
 * Primary: exact lookup in MODEL_CATALOG (GGUF filenames).
 * Fallback: partial-match known dimension prefixes.
 */
const DIMENSION_FALLBACKS = {
  'nomic-embed': 768,
  'mxbai-embed-large': 1024,
  embeddinggemma: 768,
  'all-minilm': 384,
  'bge-large': 1024,
  'snowflake-arctic-embed': 1024,
  gte: 768
};

function getEmbeddingDimensions(modelName) {
  if (!modelName) return null;
  // Exact registry lookup (GGUF filenames)
  const info = getModel(modelName);
  if (info?.dimensions) return info.dimensions;
  // Partial-match fallback for unknown models
  const lower = modelName.toLowerCase();
  const entries = Object.entries(DIMENSION_FALLBACKS).sort(([a], [b]) => b.length - a.length);
  for (const [prefix, dim] of entries) {
    if (lower.includes(prefix)) return dim;
  }
  return null;
}

/**
 * Model selection section for text, vision, and embedding models
 * Displays categorized model dropdowns with helpful messages when categories are empty
 */
function ModelSelectionSection({
  settings,
  setSettings,
  textModelOptions,
  visionModelOptions,
  embeddingModelOptions
}) {
  const [embeddingModelChanged, setEmbeddingModelChanged] = useState(false);
  const [pendingModel, setPendingModel] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [stats, setStats] = useState(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const isMountedRef = React.useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (window.electronAPI?.embeddings?.getStats) {
      window.electronAPI.embeddings
        .getStats()
        .then((s) => {
          if (isMountedRef.current) setStats(s);
        })
        .catch((err) => {
          if (isMountedRef.current) logger.error('Failed to fetch stats', err);
        });
    }
  }, [settings.embeddingModel]);

  const handleEmbeddingModelChange = (e) => {
    const newModel = e.target.value;
    if (newModel !== settings.embeddingModel) {
      setPendingModel(newModel);
      setShowConfirmDialog(true);
      if (window.electronAPI?.embeddings?.getStats) {
        window.electronAPI.embeddings
          .getStats()
          .then((s) => {
            if (isMountedRef.current) setStats(s);
          })
          .catch((err) => {
            if (isMountedRef.current) logger.error('Failed to fetch stats', err);
          });
      }
    }
  };

  const confirmChangeAndRebuild = async () => {
    setIsRebuilding(true);
    try {
      setSettings((prev) => ({ ...prev, embeddingModel: pendingModel }));
      if (window.electronAPI?.embeddings?.fullRebuild) {
        await window.electronAPI.embeddings.fullRebuild();
      }
      if (isMountedRef.current) setEmbeddingModelChanged(false);
    } catch (error) {
      logger.error('Failed to rebuild embeddings', error);
    } finally {
      if (isMountedRef.current) {
        setIsRebuilding(false);
        setShowConfirmDialog(false);
        setPendingModel(null);
      }
    }
  };

  const confirmChangeOnly = () => {
    setSettings((prev) => ({ ...prev, embeddingModel: pendingModel }));
    setEmbeddingModelChanged(true);
    setShowConfirmDialog(false);
    setPendingModel(null);
  };

  const cancelChange = () => {
    setShowConfirmDialog(false);
    setPendingModel(null);
  };

  const hasTextModels = textModelOptions.length > 0;
  const hasVisionModels = visionModelOptions.length > 0;
  const hasEmbeddingModels = embeddingModelOptions.length > 0;

  return (
    <SettingsCard
      title="Default AI models"
      description="Choose which GGUF models StratoSort uses for analysis, vision, and embeddings."
      headerAction={
        <StatusBadge variant="info" className="whitespace-nowrap">
          <span className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Loaded locally
          </span>
        </StatusBadge>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Text Model Selection */}
        <SettingRow
          layout="col"
          label="Text Model"
          description={`${textModelOptions.length} available`}
          className="h-full"
        >
          {hasTextModels ? (
            <Select
              value={settings.textModel}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  textModel: e.target.value
                }))
              }
              className="w-full"
            >
              {textModelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          ) : (
            <StateMessage
              icon={FileText}
              tone="neutral"
              size="sm"
              align="left"
              title="No text models found"
              description="Download a text model from the Models tab."
              className="p-4 bg-surface-muted rounded-xl border border-border-soft"
              contentClassName="max-w-xs"
            />
          )}
        </SettingRow>

        {/* Vision Model Selection */}
        <SettingRow
          layout="col"
          label="Vision Model"
          description={`${visionModelOptions.length} available`}
          className="h-full"
        >
          {hasVisionModels ? (
            <Select
              value={settings.visionModel}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  visionModel: e.target.value
                }))
              }
              className="w-full"
            >
              {visionModelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          ) : (
            <StateMessage
              icon={Info}
              tone="neutral"
              size="sm"
              align="left"
              title="No vision models found"
              description="Download a vision model from the Models tab for image analysis."
              className="p-4 bg-surface-muted rounded-xl border border-border-soft"
              contentClassName="max-w-xs"
            />
          )}
        </SettingRow>

        {/* Embedding Model Selection */}
        <SettingRow
          layout="col"
          label="Embedding Model"
          description={`${embeddingModelOptions.length} available`}
          className="h-full"
        >
          {hasEmbeddingModels ? (
            <div className="space-y-3">
              <Select
                value={settings.embeddingModel}
                onChange={handleEmbeddingModelChange}
                className="w-full"
              >
                {embeddingModelOptions.map((model) => (
                  <option key={model} value={model}>
                    {model} ({getEmbeddingDimensions(model) || '?'} dims)
                  </option>
                ))}
              </Select>

              <div className="flex items-start gap-2 p-2 bg-stratosort-blue/5 rounded-md border border-stratosort-blue/10">
                <Info className="w-4 h-4 text-stratosort-blue/70 mt-0.5 flex-shrink-0" />
                <Text variant="tiny" className="text-system-gray-600 leading-tight">
                  Different models use different vector dimensions. Changing the model requires
                  rebuilding your embeddings database.
                </Text>
              </div>

              {embeddingModelChanged && (
                <div className="p-3 bg-stratosort-warning/10 border border-stratosort-warning/20 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-stratosort-warning flex-shrink-0 mt-0.5" />
                  <Text variant="tiny" className="text-stratosort-warning">
                    <span className="font-medium">Model changed.</span> Rebuild embeddings in AI
                    Configuration to apply.
                  </Text>
                </div>
              )}
            </div>
          ) : (
            <StateMessage
              icon={Database}
              tone="neutral"
              size="sm"
              align="left"
              title="No embedding models available"
              description="Pull embeddinggemma (recommended) or mxbai-embed-large."
              className="p-4 bg-surface-muted rounded-xl border border-border-soft"
              contentClassName="max-w-xs"
            />
          )}
        </SettingRow>
      </div>

      {/* Confirmation Dialog */}
      <Modal
        isOpen={showConfirmDialog}
        onClose={cancelChange}
        title="Change Embedding Model?"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-stratosort-warning/10 border border-stratosort-warning/20 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-stratosort-warning mt-0.5 flex-shrink-0" />
            <div>
              <Text variant="small" className="font-medium text-stratosort-warning mb-1">
                This will invalidate existing embeddings.
              </Text>
              <Text variant="small" className="text-stratosort-warning">
                Switching from <strong>{settings.embeddingModel}</strong> to{' '}
                <strong>{pendingModel}</strong> changes the vector dimensions. You will need to
                rebuild the vector database to search existing files.
              </Text>
            </div>
          </div>

          {stats &&
            (stats.files > 0 || stats.fileChunks > 0 || stats.analysisHistory?.totalFiles > 0) && (
              <div className="flex items-center gap-2 p-3 bg-surface-muted rounded-lg border border-border-soft">
                <FileText className="w-4 h-4" />
                <Text as="span" variant="small" className="text-system-gray-600">
                  {stats.files || 0} files ({stats.fileChunks || 0} chunks) currently indexed.
                  {stats.analysisHistory?.totalFiles > 0 &&
                    ` (~${stats.analysisHistory.totalFiles} files in history)`}
                </Text>
              </div>
            )}

          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={confirmChangeAndRebuild}
              disabled={isRebuilding}
              variant="primary"
              size="sm"
              className="w-full justify-center"
            >
              {isRebuilding ? 'Starting Rebuild...' : 'Change & Rebuild Now'}
            </Button>

            <Button
              onClick={confirmChangeOnly}
              disabled={isRebuilding}
              variant="secondary"
              size="sm"
              className="w-full justify-center"
            >
              Change Only (Rebuild Later)
            </Button>

            <Button
              onClick={cancelChange}
              disabled={isRebuilding}
              variant="ghost"
              size="sm"
              className="w-full justify-center"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsCard>
  );
}

ModelSelectionSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
  textModelOptions: PropTypes.array.isRequired,
  visionModelOptions: PropTypes.array.isRequired,
  embeddingModelOptions: PropTypes.array.isRequired
};

export default ModelSelectionSection;
