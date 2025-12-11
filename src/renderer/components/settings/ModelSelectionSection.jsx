import React from 'react';
import PropTypes from 'prop-types';
import Select from '../ui/Select';

/**
 * Model selection section for text, vision, and embedding models
 */
function ModelSelectionSection({
  settings,
  setSettings,
  textModelOptions,
  visionModelOptions,
  embeddingModelOptions
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">Text Model</label>
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
      </div>
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">Vision Model</label>
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
      </div>
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Embedding Model
        </label>
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
