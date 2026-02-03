import React from 'react';
import PropTypes from 'prop-types';
import Card from '../ui/Card';
import Select from '../ui/Select';
import SettingRow from './SettingRow';
import { Text } from '../ui/Typography';

function EmbeddingBehaviorSection({ settings, setSettings }) {
  const timing = settings?.embeddingTiming || 'during_analysis';
  const policy = settings?.defaultEmbeddingPolicy || 'embed';

  return (
    <Card variant="default" className="space-y-5">
      <div>
        <Text variant="tiny" className="font-semibold uppercase tracking-wide text-system-gray-500">
          Embedding behavior
        </Text>
        <Text variant="small" className="text-system-gray-600">
          Control when local embeddings are created, and set the default opt-out behavior for new
          files.
        </Text>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingRow
          layout="col"
          label="Embedding timing"
          description="Choose whether to embed during analysis or only after files are organized."
        >
          <Select
            value={timing}
            onChange={(e) => setSettings((prev) => ({ ...prev, embeddingTiming: e.target.value }))}
          >
            <option value="during_analysis">During analysis (default)</option>
            <option value="after_organize">After organize/move</option>
            <option value="manual">Manual only</option>
          </Select>
        </SettingRow>

        <SettingRow
          layout="col"
          label="Default embedding policy"
          description="Applies to new items. You can override per file."
        >
          <Select
            value={policy}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, defaultEmbeddingPolicy: e.target.value }))
            }
          >
            <option value="embed">Embed locally</option>
            <option value="web_only">Web-only (do not embed locally)</option>
            <option value="skip">Skip embedding</option>
          </Select>
        </SettingRow>
      </div>
    </Card>
  );
}

EmbeddingBehaviorSection.propTypes = {
  settings: PropTypes.object,
  setSettings: PropTypes.func.isRequired
};

export default EmbeddingBehaviorSection;
