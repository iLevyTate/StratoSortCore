import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';

/**
 * Model management section for adding and deleting Ollama models
 */
function ModelManagementSection({
  newModel,
  setNewModel,
  modelToDelete,
  setModelToDelete,
  ollamaModelLists,
  isAddingModel,
  isDeletingModel,
  onAddModel,
  onDeleteModel
}) {
  return (
    <div className="border-t border-system-gray-200 pt-6 mt-6 space-y-6">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">Add Model</label>
        <div className="flex gap-3">
          <Input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="model:tag"
            className="flex-1"
          />
          <Button
            onClick={onAddModel}
            variant="secondary"
            type="button"
            disabled={isAddingModel}
            title="Pull model"
          >
            {isAddingModel ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">Delete Model</label>
        <div className="flex gap-3">
          <Select
            value={modelToDelete}
            onChange={(e) => setModelToDelete(e.target.value)}
            className="flex-1"
          >
            <option value="" disabled>
              Select model
            </option>
            {ollamaModelLists.all.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
          <Button
            onClick={onDeleteModel}
            variant="danger"
            type="button"
            disabled={isDeletingModel || !modelToDelete}
            title="Delete model"
          >
            {isDeletingModel ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

ModelManagementSection.propTypes = {
  newModel: PropTypes.string.isRequired,
  setNewModel: PropTypes.func.isRequired,
  modelToDelete: PropTypes.string.isRequired,
  setModelToDelete: PropTypes.func.isRequired,
  ollamaModelLists: PropTypes.object.isRequired,
  isAddingModel: PropTypes.bool.isRequired,
  isDeletingModel: PropTypes.bool.isRequired,
  onAddModel: PropTypes.func.isRequired,
  onDeleteModel: PropTypes.func.isRequired
};

export default ModelManagementSection;
