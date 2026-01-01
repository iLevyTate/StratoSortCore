import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { AlertTriangle } from 'lucide-react';
import Select from '../ui/Select';

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
  // Track the initial embedding model to detect changes
  const initialEmbeddingModelRef = useRef(settings.embeddingModel);
  const [embeddingModelChanged, setEmbeddingModelChanged] = useState(false);

  // Detect when embedding model changes from initial value
  useEffect(() => {
    if (settings.embeddingModel !== initialEmbeddingModelRef.current) {
      setEmbeddingModelChanged(true);
    } else {
      setEmbeddingModelChanged(false);
    }
  }, [settings.embeddingModel]);
  const hasTextModels = textModelOptions.length > 0;
  const hasVisionModels = visionModelOptions.length > 0;
  const hasEmbeddingModels = embeddingModelOptions.length > 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {/* Text Model Selection */}
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Text Model
          <span className="ml-1 text-xs text-system-gray-500">
            ({textModelOptions.length} available)
          </span>
        </label>
        {hasTextModels ? (
          <Select
            value={settings.textModel}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                textModel: e.target.value
              }))
            }
          >
            {textModelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
        ) : (
          <div className="text-sm text-system-gray-500 italic p-2 bg-system-gray-50 rounded">
            No text models found. Pull a model like llama3.2 or mistral.
          </div>
        )}
      </div>

      {/* Vision Model Selection */}
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Vision Model
          <span className="ml-1 text-xs text-system-gray-500">
            ({visionModelOptions.length} available)
          </span>
        </label>
        {hasVisionModels ? (
          <Select
            value={settings.visionModel}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                visionModel: e.target.value
              }))
            }
          >
            {visionModelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
        ) : (
          <div className="text-sm text-system-gray-500 italic p-2 bg-system-gray-50 rounded">
            No vision models found. Pull a model like llava or moondream for image analysis.
          </div>
        )}
      </div>

      {/* Embedding Model Selection */}
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Embedding Model
          <span className="ml-1 text-xs text-system-gray-500">
            ({embeddingModelOptions.length} available)
          </span>
        </label>
        {hasEmbeddingModels ? (
          <>
            <Select
              value={settings.embeddingModel}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  embeddingModel: e.target.value
                }))
              }
            >
              {embeddingModelOptions.map((model) => (
                <option key={model} value={model}>
                  {model} ({EMBEDDING_DIMENSIONS[model] || '?'} dims)
                </option>
              ))}
            </Select>
            {embeddingModelChanged && (
              <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-md flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-700">
                  <span className="font-medium">Embedding model changed.</span> Rebuild embeddings
                  in AI Configuration to apply. Different models have different dimensions and are
                  not compatible.
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-system-gray-500 italic p-2 bg-system-gray-50 rounded">
            No embedding models available. Pull embeddinggemma (recommended) or mxbai-embed-large.
          </div>
        )}
      </div>
    </div>
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
