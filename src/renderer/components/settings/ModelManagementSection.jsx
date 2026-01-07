import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingRow from './SettingRow';

/**
 * Model management section for adding Ollama models
 */
function ModelManagementSection({ newModel, setNewModel, isAddingModel, onAddModel }) {
  return (
    <div className="border-t border-system-gray-200 pt-6 mt-6">
      <SettingRow
        layout="col"
        label="Add Model"
        description="Download new models from the Ollama library."
      >
        <div className="flex flex-col sm:flex-row gap-3 max-w-2xl">
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
            size="md"
            className="shrink-0"
          >
            {isAddingModel ? 'Adding…' : 'Add Model'}
          </Button>
        </div>
      </SettingRow>
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
