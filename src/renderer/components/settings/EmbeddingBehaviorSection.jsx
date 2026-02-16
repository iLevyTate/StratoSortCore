import React from 'react';
import PropTypes from 'prop-types';
import Select from '../ui/Select';
import Switch from '../ui/Switch';
import SettingRow from './SettingRow';
import SettingsCard from './SettingsCard';

function EmbeddingBehaviorSection({ settings, setSettings }) {
  const timing = settings?.embeddingTiming || 'during_analysis';
  const policy = settings?.defaultEmbeddingPolicy || 'embed';
  const scope = settings?.embeddingScope || 'all_analyzed';

  return (
    <SettingsCard
      title="Embedding behavior"
      description="Control when and which files get local embeddings for search, graph, and similarity."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SettingRow
          layout="col"
          label="Embedding Scope"
          description="Which analyzed files should be embedded and made searchable."
        >
          <Select
            value={scope}
            onChange={(e) => setSettings((prev) => ({ ...prev, embeddingScope: e.target.value }))}
            className="w-full"
          >
            <option value="all_analyzed">All analyzed files (recommended)</option>
            <option value="smart_folders_only">Smart folder files only</option>
          </Select>
        </SettingRow>

        <SettingRow
          layout="col"
          label="Embedding Timing"
          description="Choose whether to embed during analysis or only after files are organized."
        >
          <Select
            value={timing}
            onChange={(e) => setSettings((prev) => ({ ...prev, embeddingTiming: e.target.value }))}
            className="w-full"
          >
            <option value="during_analysis">During analysis (default)</option>
            <option value="after_organize">After organize/move</option>
            <option value="manual">Manual only</option>
          </Select>
        </SettingRow>

        <SettingRow
          layout="col"
          label="Default Embedding Policy"
          description="Applies to new items. You can override per file."
        >
          <Select
            value={policy}
            onChange={(e) =>
              setSettings((prev) => ({ ...prev, defaultEmbeddingPolicy: e.target.value }))
            }
            className="w-full"
          >
            <option value="embed">Embed locally</option>
            <option value="web_only">Web-only (do not embed locally)</option>
            <option value="skip">Skip embedding</option>
          </Select>
        </SettingRow>
      </div>

      <SettingRow
        label="Auto-generate Chunk Embeddings"
        description="Create fine-grained chunk embeddings during file analysis for deeper chat and document retrieval."
      >
        <Switch
          checked={settings?.autoChunkOnAnalysis !== false}
          onChange={(checked) => setSettings((prev) => ({ ...prev, autoChunkOnAnalysis: checked }))}
        />
      </SettingRow>
    </SettingsCard>
  );
}

EmbeddingBehaviorSection.propTypes = {
  settings: PropTypes.object,
  setSettings: PropTypes.func.isRequired
};

export default EmbeddingBehaviorSection;
