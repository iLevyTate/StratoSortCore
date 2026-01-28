import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { AlertCircle, CheckCircle2, Database, Link2, Loader2, RefreshCw } from 'lucide-react';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Card from '../ui/Card';
import StatusBadge from '../ui/StatusBadge';
import StateMessage from '../ui/StateMessage';
import { Text } from '../ui/Typography';
import SettingRow from './SettingRow';
import { SERVICE_URLS } from '../../../shared/configDefaults';

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
  const healthBadge = useMemo(() => {
    if (pullProgressText) {
      return {
        variant: 'info',
        icon: <Loader2 className="w-4 h-4 animate-spin" />,
        label: pullProgressText
      };
    }
    if (!ollamaHealth) {
      return {
        variant: 'info',
        icon: <Database className="w-4 h-4" />,
        label: 'Awaiting connection test'
      };
    }
    const isHealthy = ollamaHealth.status === 'healthy';
    return {
      variant: isHealthy ? 'success' : 'error',
      icon: isHealthy ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />,
      label: isHealthy
        ? `Healthy (${ollamaHealth.modelCount || 0} models)`
        : `Unhealthy${ollamaHealth.error ? `: ${ollamaHealth.error}` : ''}`
    };
  }, [ollamaHealth, pullProgressText]);

  const modelCountLabel = useMemo(() => {
    const count = ollamaHealth?.modelCount ?? ollamaModelLists?.all?.length ?? 0;
    if (!count) return 'No models detected';
    if (count === 1) return '1 model installed';
    return `${count} models installed`;
  }, [ollamaHealth, ollamaModelLists]);

  return (
    <Card variant="default" className="p-5 space-y-5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Text
            variant="tiny"
            className="font-semibold uppercase tracking-wide text-system-gray-500"
          >
            Ollama connection
          </Text>
          <Text variant="small" className="text-system-gray-600">
            Point StratoSort to your local Ollama API and refresh available models.
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={healthBadge.variant} className="whitespace-nowrap">
            <span className="flex items-center gap-2">
              {healthBadge.icon}
              <span className="truncate">{healthBadge.label}</span>
            </span>
          </StatusBadge>
          <Text
            as="div"
            variant="tiny"
            className="text-system-gray-500 px-3 py-1 rounded-full bg-system-gray-100 border border-system-gray-200 whitespace-nowrap"
          >
            {modelCountLabel}
          </Text>
        </div>
      </div>

      <SettingRow
        layout="col"
        label="Ollama Host URL"
        description="Typically http://localhost:11434. Update if you are running Ollama remotely or on a custom port."
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            type="text"
            value={settings.ollamaHost}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                ollamaHost: e.target.value
              }))
            }
            placeholder={SERVICE_URLS.OLLAMA_HOST}
            className="w-full"
          />
          <Button
            onClick={onTestConnection}
            variant="primary"
            type="button"
            title="Test Ollama connection"
            leftIcon={<Link2 className="w-4 h-4" />}
            size="md"
            className="w-full sm:w-auto justify-center"
          >
            Test Connection
          </Button>
        </div>
      </SettingRow>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={onRefreshModels}
          variant="secondary"
          type="button"
          title="Refresh models"
          disabled={isRefreshingModels}
          leftIcon={
            isRefreshingModels ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )
          }
          size="sm"
          className="min-w-[9rem] justify-center"
        >
          {isRefreshingModels ? 'Refreshing…' : 'Refresh Models'}
        </Button>
        <Button
          onClick={() => setShowAllModels((v) => !v)}
          variant="subtle"
          type="button"
          title="Toggle raw model list"
          size="sm"
          className="min-w-[9rem] justify-center"
        >
          {showAllModels ? 'Hide Models' : 'View All Models'}
        </Button>
        <Text
          as="div"
          variant="tiny"
          className="flex-1 min-w-[240px] text-system-gray-600 flex items-center gap-2"
        >
          {pullProgressText ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-system-gray-500" />
              <span className="truncate" title={pullProgressText}>
                {pullProgressText}
              </span>
            </>
          ) : (
            <span className="truncate">
              {ollamaHealth
                ? 'Connection status updated.'
                : 'Test connection to verify your Ollama instance.'}
            </span>
          )}
        </Text>
      </div>

      {showAllModels && (
        <div className="p-4 bg-system-gray-50 rounded-lg border border-system-gray-200 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Text variant="small" className="font-medium text-system-gray-700">
              All models from Ollama
            </Text>
            <Text variant="tiny" className="text-system-gray-500">
              {modelCountLabel}
            </Text>
          </div>
          {ollamaModelLists.all.length === 0 ? (
            <StateMessage
              icon={AlertCircle}
              tone="warning"
              size="sm"
              align="left"
              title="No models returned"
              description="Check your Ollama connection or refresh the model list."
              className="py-2"
              contentClassName="max-w-xs"
            />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {ollamaModelLists.all.map((m) => (
                <li
                  key={m}
                  className="font-mono px-3 py-2 rounded border border-system-gray-200 bg-white shadow-sm"
                >
                  {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
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
