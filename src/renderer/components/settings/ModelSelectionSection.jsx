import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle, Database, Info, FileText } from 'lucide-react';
import Select from '../ui/Select';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import SettingRow from './SettingRow';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Text } from '../ui/Typography';
import { logger } from '../../../shared/logger';

// Embedding model dimensions - used for dimension change warnings
const EMBEDDING_DIMENSIONS = {
  embeddinggemma: 768,
  'mxbai-embed-large': 1024,
  'nomic-embed-text': 768,
  'all-minilm': 384,
  'bge-large': 1024
};

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
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      if (window.electronAPI?.embeddings?.getStats) {
        window.electronAPI.embeddings
          .getStats()
          .then((s) => setStats(s))
          .catch((err) => logger.error('Failed to fetch stats', err));
      }
      return;
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
          .then((s) => setStats(s))
          .catch((err) => logger.error('Failed to fetch stats', err));
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
      setEmbeddingModelChanged(false);
    } catch (error) {
      logger.error('Failed to rebuild embeddings', error);
    } finally {
      setIsRebuilding(false);
      setShowConfirmDialog(false);
      setPendingModel(null);
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
    <Card variant="default" className="p-5 space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Text
            variant="tiny"
            className="font-semibold uppercase tracking-wide text-system-gray-500"
          >
            Default AI models
          </Text>
          <Text variant="small" className="text-system-gray-600">
            Choose which Ollama models StratoSort uses for analysis, vision, and embeddings.
          </Text>
        </div>
        <StatusBadge variant="info" className="whitespace-nowrap">
          <span className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Pulled from Ollama
          </span>
        </StatusBadge>
      </div>

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
            <Text
              variant="small"
              className="italic p-3 bg-system-gray-50 rounded-lg border border-system-gray-100 text-system-gray-500"
            >
              No text models found. Pull a model like llama3.2 or mistral.
            </Text>
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
            <Text
              variant="small"
              className="italic p-3 bg-system-gray-50 rounded-lg border border-system-gray-100 text-system-gray-500"
            >
              No vision models found. Pull a model like llava or moondream for image analysis.
            </Text>
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
                    {model} ({EMBEDDING_DIMENSIONS[model] || '?'} dims)
                  </option>
                ))}
              </Select>

              <div className="flex items-start gap-2 p-2 bg-stratosort-blue/5 rounded-md border border-stratosort-blue/10">
                <Info className="w-3.5 h-3.5 text-stratosort-blue/70 mt-0.5 flex-shrink-0" />
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
            <Text
              variant="small"
              className="italic p-3 bg-system-gray-50 rounded-lg border border-system-gray-100 text-system-gray-500"
            >
              No embedding models available. Pull embeddinggemma (recommended) or mxbai-embed-large.
            </Text>
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
            <div className="text-sm text-stratosort-warning">
              <p className="font-medium mb-1">This will invalidate existing embeddings.</p>
              <p>
                Switching from <strong>{settings.embeddingModel}</strong> to{' '}
                <strong>{pendingModel}</strong> changes the vector dimensions. You will need to
                rebuild the vector database to search existing files.
              </p>
            </div>
          </div>

          {stats &&
            (stats.files > 0 || stats.chunks > 0 || stats.analysisHistory?.totalFiles > 0) && (
              <div className="flex items-center gap-2 p-3 bg-system-gray-50 rounded-lg border border-system-gray-100 text-sm text-system-gray-600">
                <FileText className="w-4 h-4" />
                <span>
                  {stats.files || 0} files ({stats.chunks || 0} chunks) currently indexed.
                  {stats.analysisHistory?.totalFiles > 0 &&
                    ` (~${stats.analysisHistory.totalFiles} files in history)`}
                </span>
              </div>
            )}

          <div className="flex flex-col gap-2 pt-2">
            <Button
              onClick={confirmChangeAndRebuild}
              disabled={isRebuilding}
              variant="primary"
              className="w-full justify-center"
            >
              {isRebuilding ? 'Starting Rebuild...' : 'Change & Rebuild Now'}
            </Button>

            <Button
              onClick={confirmChangeOnly}
              disabled={isRebuilding}
              variant="secondary"
              className="w-full justify-center"
            >
              Change Only (Rebuild Later)
            </Button>

            <Button
              onClick={cancelChange}
              disabled={isRebuilding}
              variant="ghost"
              className="w-full justify-center"
            >
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
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
