import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';

/**
 * Model management section for adding GGUF models
 */
function ModelManagementSection({ newModel, setNewModel, isAddingModel, onAddModel }) {
  return (
    <SettingsCard title="Model management" description="Download additional GGUF models by name.">
      <SettingRow
        layout="col"
        label="Add Model"
        description="Download new models from the model registry."
      >
        <div className="settings-input-group">
          <Input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            placeholder="model:tag"
            className="w-full"
          />
          <Button
            onClick={onAddModel}
            variant="secondary"
            type="button"
            disabled={isAddingModel}
            title="Download model"
            size="sm"
            className="w-full sm:w-auto justify-center min-w-[9rem]"
          >
            {isAddingModel ? 'Adding…' : 'Add Model'}
          </Button>
        </div>
      </SettingRow>
    </SettingsCard>
  );
}

ModelManagementSection.propTypes = {
  newModel: PropTypes.string.isRequired,
  setNewModel: PropTypes.func.isRequired,
  isAddingModel: PropTypes.bool.isRequired,
  onAddModel: PropTypes.func.isRequired
};

export default ModelManagementSection;
