import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle, Database, Info, FileText } from 'lucide-react';
import Select from '../ui/Select';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import SettingRow from './SettingRow';
import Modal from '../Modal';
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
  // Show the "model changed -> rebuild required" message only when the user explicitly changes
  // the dropdown (avoids confusing banners during initial settings/model hydration).
  const [embeddingModelChanged, setEmbeddingModelChanged] = useState(false);
  const [pendingModel, setPendingModel] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [stats, setStats] = useState(null);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      // Fetch stats for dialog
      if (window.electronAPI?.embeddings?.getStats) {
        window.electronAPI.embeddings
          .getStats()
          .then((s) => setStats(s))
          .catch((err) => logger.error('Failed to fetch stats', err));
      }
      return;
    }
    // If the model gets reset programmatically (rare), keep the banner visible only if it was
    // explicitly triggered by user interaction.
  }, [settings.embeddingModel]);

  const handleEmbeddingModelChange = (e) => {
    const newModel = e.target.value;
    if (newModel !== settings.embeddingModel) {
      setPendingModel(newModel);
      setShowConfirmDialog(true);
      // Refresh stats just in case
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
      // 1. Update settings
      setSettings((prev) => ({ ...prev, embeddingModel: pendingModel }));
      // 2. Trigger rebuild
      if (window.electronAPI?.embeddings?.fullRebuild) {
        await window.electronAPI.embeddings.fullRebuild();
      }
      // 3. Clear warnings since we just rebuilt
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
    <Card className="p-5 border border-system-gray-200 shadow-sm space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-system-gray-500">
            Default AI models
          </p>
          <p className="text-sm text-system-gray-600">
            Choose which Ollama models StratoSort uses for analysis, vision, and embeddings.
          </p>
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
            <div className="text-sm text-system-gray-500 italic p-3 bg-system-gray-50 rounded-lg border border-system-gray-100">
              No text models found. Pull a model like llama3.2 or mistral.
            </div>
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
            <div className="text-sm text-system-gray-500 italic p-3 bg-system-gray-50 rounded-lg border border-system-gray-100">
              No vision models found. Pull a model like llava or moondream for image analysis.
            </div>
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

              <div className="flex items-start gap-2 p-2 bg-system-blue/5 rounded-md border border-system-blue/10">
                <Info className="w-3.5 h-3.5 text-system-blue/70 mt-0.5 flex-shrink-0" />
                <p className="text-[11px] text-system-gray-600 leading-tight">
                  Different models use different vector dimensions. Changing the model requires
                  rebuilding your embeddings database.
                </p>
              </div>

              {embeddingModelChanged && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-700">
                    <span className="font-medium">Model changed.</span> Rebuild embeddings in AI
                    Configuration to apply.
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-system-gray-500 italic p-3 bg-system-gray-50 rounded-lg border border-system-gray-100">
              No embedding models available. Pull embeddinggemma (recommended) or mxbai-embed-large.
            </div>
          )}
        </SettingRow>
      </div>

      {/* Confirmation Dialog */}
      <Modal
        isOpen={showConfirmDialog}
        onClose={cancelChange}
        title="Change Embedding Model?"
        size="small"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
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
            <button
              onClick={confirmChangeAndRebuild}
              disabled={isRebuilding}
              className="w-full py-2 px-4 bg-system-blue text-white rounded-lg hover:bg-system-blue/90 font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isRebuilding ? 'Starting Rebuild...' : 'Change & Rebuild Now'}
            </button>

            <button
              onClick={confirmChangeOnly}
              disabled={isRebuilding}
              className="w-full py-2 px-4 bg-system-gray-100 text-system-gray-700 rounded-lg hover:bg-system-gray-200 font-medium transition-colors"
            >
              Change Only (Rebuild Later)
            </button>

            <button
              onClick={cancelChange}
              disabled={isRebuilding}
              className="w-full py-2 px-4 text-system-gray-500 hover:text-system-gray-700 hover:bg-system-gray-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
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
