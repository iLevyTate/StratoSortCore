import React from 'react';
import PropTypes from 'prop-types';
import { Link2, RefreshCw } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';

/**
 * Ollama server configuration section
 * Handles host URL, connection testing, and health status display
 */
function OllamaConfigSection({
  settings,
  setSettings,
  ollamaHealth,
  isRefreshingModels,
  pullProgressText,
  showAllModels,
  setShowAllModels,
  ollamaModelLists,
  onTestConnection,
  onRefreshModels
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-system-gray-700 mb-2">
          Ollama Host URL
        </label>
        <div className="flex gap-3">
          <Input
            type="text"
            value={settings.ollamaHost}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                ollamaHost: e.target.value
              }))
            }
            placeholder="http://127.0.0.1:11434"
            className="flex-1"
          />
          <Button
            onClick={onTestConnection}
            variant="secondary"
            type="button"
            title="Test Ollama connection"
            leftIcon={<Link2 className="w-4 h-4" />}
          >
            Test
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={onRefreshModels}
          variant="secondary"
          type="button"
          title="Refresh models"
          disabled={isRefreshingModels}
          leftIcon={isRefreshingModels ? null : <RefreshCw className="w-4 h-4" />}
        >
          {isRefreshingModels ? 'Refreshing…' : 'Refresh Models'}
        </Button>
        <Button
          onClick={() => setShowAllModels((v) => !v)}
          variant="subtle"
          type="button"
          title="Toggle raw model list"
        >
          {showAllModels ? 'Hide Models' : 'View All Models'}
        </Button>
        {pullProgressText && (
          <span className="text-xs text-system-gray-600">{pullProgressText}</span>
        )}
        {ollamaHealth && (
          <span
            className={`text-xs ${ollamaHealth.status === 'healthy' ? 'text-green-600' : 'text-red-600'}`}
          >
            {ollamaHealth.status === 'healthy'
              ? `Healthy (${ollamaHealth.modelCount || 0} models)`
              : `Unhealthy${ollamaHealth.error ? `: ${ollamaHealth.error}` : ''}`}
          </span>
        )}
      </div>
      {showAllModels && (
        <div className="mt-4 p-4 bg-system-gray-50 rounded border border-system-gray-200 text-xs">
          <div className="mb-2 font-medium text-system-gray-700">All models from Ollama:</div>
          {ollamaModelLists.all.length === 0 ? (
            <div className="text-system-gray-500">No models returned</div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {ollamaModelLists.all.map((m) => (
                <li key={m} className="font-mono">
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

OllamaConfigSection.propTypes = {
  settings: PropTypes.object.isRequired,
  setSettings: PropTypes.func.isRequired,
  ollamaHealth: PropTypes.object,
  isRefreshingModels: PropTypes.bool.isRequired,
  pullProgressText: PropTypes.string,
  showAllModels: PropTypes.bool.isRequired,
  setShowAllModels: PropTypes.func.isRequired,
  ollamaModelLists: PropTypes.object.isRequired,
  onTestConnection: PropTypes.func.isRequired,
  onRefreshModels: PropTypes.func.isRequired
};

export default OllamaConfigSection;
