import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Button from '../ui/Button';
// FIX: Import useSafeState to prevent state updates on unmounted components
import { useSafeState } from '../../utils/reactEdgeCaseUtils';

export default function FirstRunWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  // FIX: Use useSafeState for hostOk to prevent React warning when async
  // testConnection returns after component unmounts
  const [hostOk, setHostOk] = useSafeState(null);
  const [pulling, setPulling] = useState(false);
  const [results, setResults] = useState([]);

  const models = [
    {
      id: 'llama3.2:latest',
      label: 'Text model (llama3.2:latest)',
      defaultChecked: true
    },
    {
      id: 'llava:latest',
      label: 'Vision model (llava:latest)',
      defaultChecked: true
    },
    {
      id: 'mxbai-embed-large',
      label: 'Embeddings (mxbai-embed-large)',
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
            <h2 className="text-heading-2 mb-8">Set up AI locally</h2>
            <p className="text-body mb-8">
              StratoSort uses Ollama to run models locally. We can pull the base models for you.
            </p>
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
                  <span>{m.label}</span>
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
            <h2 className="text-heading-2 mb-8">
              {pulling ? `Pulling models (${progress.current}/${progress.total})` : 'Model setup'}
            </h2>
            <div className="space-y-5">
              {results.map((r) => (
                <div key={r.model} className="text-sm">
                  {r.status === 'ready' ? '✅' : r.status.startsWith('failed') ? '⚠️' : '⏳'}{' '}
                  {r.model} {r.status === 'ready' ? 'ready' : r.status}
                </div>
              ))}
            </div>
            {pulling && (
              <p className="text-body mt-5">
                This may take a few minutes depending on your connection.
              </p>
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
  onComplete: PropTypes.func
};

export { default as SmartFolderItem } from './SmartFolderItem';
export { default as AddSmartFolderModal } from './AddSmartFolderModal';
