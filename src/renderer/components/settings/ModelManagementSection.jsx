import React from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Card from '../ui/Card';
import SettingRow from './SettingRow';
import { Text } from '../ui/Typography';

/**
 * Model management section for adding GGUF models
 */
function ModelManagementSection({ newModel, setNewModel, isAddingModel, onAddModel }) {
  return (
    <Card variant="default" className="space-y-5">
      <div>
        <Text variant="tiny" className="font-semibold uppercase tracking-wide text-system-gray-500">
          Model management
        </Text>
        <Text variant="small" className="text-system-gray-600">
          Download additional GGUF models by name.
        </Text>
      </div>

      <SettingRow
        layout="col"
        label="Add Model"
        description="Download new models from the model registry."
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
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
            size="md"
            className="w-full sm:w-auto justify-center"
          >
            {isAddingModel ? 'Adding…' : 'Add Model'}
          </Button>
        </div>
      </SettingRow>
    </Card>
  );
}

ModelManagementSection.propTypes = {
  newModel: PropTypes.string.isRequired,
  setNewModel: PropTypes.func.isRequired,
  isAddingModel: PropTypes.bool.isRequired,
  onAddModel: PropTypes.func.isRequired
};

export default ModelManagementSection;
