import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import Button from '../ui/Button';
import { Heading, Text } from '../ui/Typography';
// FIX: Import useSafeState to prevent state updates on unmounted components
import { useSafeState } from '../../utils/reactEdgeCaseUtils';
import { DEFAULT_AI_MODELS } from '../../../shared/constants';

export default function FirstRunWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  // FIX: Use useSafeState for hostOk to prevent React warning when async
  // testConnection returns after component unmounts
  const [hostOk, setHostOk] = useSafeState(null);
  const [pulling, setPulling] = useState(false);
  const [results, setResults] = useState([]);

  // Use centralized model defaults to ensure consistency
  const models = [
    {
      id: DEFAULT_AI_MODELS.TEXT_ANALYSIS,
      label: `Text model (${DEFAULT_AI_MODELS.TEXT_ANALYSIS})`,
      defaultChecked: true
    },
    {
      id: DEFAULT_AI_MODELS.IMAGE_ANALYSIS,
      label: `Vision model (${DEFAULT_AI_MODELS.IMAGE_ANALYSIS})`,
      defaultChecked: true
    },
    {
      id: DEFAULT_AI_MODELS.EMBEDDING,
      label: `Embeddings (${DEFAULT_AI_MODELS.EMBEDDING})`,
      defaultChecked: true
    }
  ];

  const [selectedModels, setSelectedModels] = useState(
    models.filter((m) => m.defaultChecked).map((m) => m.id)
  );
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const res = await window.electronAPI?.ollama?.testConnection?.();
        if (isActive) setHostOk(Boolean(res?.success));
      } catch {
        if (isActive) setHostOk(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [setHostOk]);

  const handlePull = async () => {
    try {
      setStep(1);
      setPulling(true);
      setProgress({ current: 0, total: selectedModels.length });
      setResults(selectedModels.map((id) => ({ model: id, status: 'queued' })));
      for (let i = 0; i < selectedModels.length; i += 1) {
        const model = selectedModels[i];
        setProgress({ current: i + 1, total: selectedModels.length });
        setResults((prev) =>
          prev.map((r) => (r.model === model ? { ...r, status: 'pulling' } : r))
        );
        try {
          const res = await window.electronAPI?.ollama?.pullModels?.([model]);
          const result = res?.results?.[0];
          if (result?.success) {
            setResults((prev) =>
              prev.map((r) => (r.model === model ? { ...r, status: 'ready' } : r))
            );
          } else {
            setResults((prev) =>
              prev.map((r) =>
                r.model === model
                  ? {
                      ...r,
                      status: `failed: ${result?.error || 'unknown error'}`
                    }
                  : r
              )
            );
          }
        } catch (error) {
          setResults((prev) =>
            prev.map((r) => (r.model === model ? { ...r, status: `failed: ${error.message}` } : r))
          );
        }
      }
    } finally {
      setPulling(false);
    }
  };

  if (hostOk === null) return null;

  if (hostOk) {
    return null; // Host ok; no wizard needed
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-modal">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl p-5">
        {step === 0 && (
          <div>
            <Heading as="h2" variant="h3" className="mb-8">
              Set up AI locally
            </Heading>
            <Text variant="small" className="mb-8">
              StratoSort uses Ollama to run models locally. We can pull the base models for you.
            </Text>
            <div className="space-y-2 mb-3">
              {models.map((m) => (
                <label key={m.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="model-pull"
                    value={m.id}
                    checked={selectedModels.includes(m.id)}
                    onChange={(e) => {
                      const { checked } = e.target;
                      setSelectedModels((prev) =>
                        checked ? [...prev, m.id] : prev.filter((id) => id !== m.id)
                      );
                    }}
                  />
                  <Text as="span" variant="small">
                    {m.label}
                  </Text>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button onClick={onComplete} variant="secondary">
                Skip
              </Button>
              <Button onClick={handlePull} disabled={pulling || selectedModels.length === 0}>
                {pulling ? 'Pulling…' : 'Pull models'}
              </Button>
            </div>
          </div>
        )}
        {step === 1 && (
          <div>
            <Heading as="h2" variant="h3" className="mb-8">
              {pulling ? `Pulling models (${progress.current}/${progress.total})` : 'Model setup'}
            </Heading>
            <div className="space-y-5">
              {results.map((r) => (
                <Text key={r.model} variant="small" className="text-system-gray-700">
                  <span className="inline-flex items-center gap-1">
                    {r.status === 'ready' ? (
                      <CheckCircle className="w-4 h-4 text-stratosort-success" />
                    ) : r.status.startsWith('failed') ? (
                      <AlertTriangle className="w-4 h-4 text-stratosort-warning" />
                    ) : (
                      <Clock className="w-4 h-4 text-stratosort-blue" />
                    )}
                    {r.model} {r.status === 'ready' ? 'ready' : r.status}
                  </span>
                </Text>
              ))}
            </div>
            {pulling && (
              <Text variant="small" className="mt-5">
                This may take a few minutes depending on your connection.
              </Text>
            )}
            <div className="flex items-center justify-end gap-2 mt-3">
              <Button onClick={onComplete} variant="primary" disabled={pulling}>
                Continue
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

FirstRunWizard.propTypes = {
  onComplete: PropTypes.func.isRequired
};

export { default as SmartFolderItem } from './SmartFolderItem';
export { default as AddSmartFolderModal } from './AddSmartFolderModal';
