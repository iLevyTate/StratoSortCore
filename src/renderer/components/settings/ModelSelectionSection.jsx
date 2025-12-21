import React from 'react';
import PropTypes from 'prop-types';
import Select from '../ui/Select';

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
                {model}
              </option>
            ))}
          </Select>
        ) : (
          <div className="text-sm text-system-gray-500 italic p-2 bg-system-gray-50 rounded">
            No embedding models available. Pull mxbai-embed-large for semantic search.
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
