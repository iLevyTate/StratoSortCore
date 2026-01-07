import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Input from '../ui/Input';

/**
 * Model management section for adding Ollama models
 */
function ModelManagementSection({ newModel, setNewModel, isAddingModel, onAddModel }) {
  return (
    <div className="border-t border-system-gray-200 pt-6 mt-6">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">Add Model</label>
        <div className="flex flex-col sm:flex-row gap-3">
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
            size="sm"
            className="shrink-0"
          >
            {isAddingModel ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </div>
    </div>
  );
}

ModelManagementSection.propTypes = {
  newModel: PropTypes.string.isRequired,
  setNewModel: PropTypes.func.isRequired,
  isAddingModel: PropTypes.bool.isRequired,
  onAddModel: PropTypes.func.isRequired
};

export default ModelManagementSection;
