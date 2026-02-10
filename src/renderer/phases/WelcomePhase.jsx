import React, { useState, useEffect, useCallback } from 'react';
import { Rocket, FolderOpen, Settings, Search, Sparkles, FolderCheck } from 'lucide-react';
import { PHASES, AI_DEFAULTS } from '../../shared/constants';
import { useAppDispatch } from '../store/hooks';
import { toggleSettings, setPhase } from '../store/slices/uiSlice';
import { useNotification } from '../contexts/NotificationContext';
import { Button, Card } from '../components/ui';
import { Heading, Text } from '../components/ui/Typography';
import Modal from '../components/ui/Modal';
import { Stack } from '../components/layout';
import ModelSetupWizard from '../components/ModelSetupWizard';

function WelcomePhase() {
  const dispatch = useAppDispatch();
  const { addNotification } = useNotification();
  const [showFlowsModal, setShowFlowsModal] = useState(false);
  const [modelCheckState, setModelCheckState] = useState('loading'); // 'loading' | 'missing' | 'ready'

  // Check if required AI models are downloaded
  useEffect(() => {
    let cancelled = false;
    async function checkModels() {
      try {
        const getModels = window?.electronAPI?.llama?.getModels;
        const getConfig = window?.electronAPI?.llama?.getConfig;
        if (typeof getModels !== 'function') {
          if (!cancelled) setModelCheckState('ready');
          return;
        }
        const [modelsResponse, configResponse] = await Promise.all([
          getModels(),
          typeof getConfig === 'function' ? getConfig() : Promise.resolve(null)
        ]);
        if (cancelled) return;

        // getModels() returns { models: string[], categories, selected, ... }
        const modelNames = Array.isArray(modelsResponse?.models)
          ? modelsResponse.models
          : Array.isArray(modelsResponse)
            ? modelsResponse.map((m) => m.name || m.filename || '')
            : [];
        const available = new Set(modelNames.map((n) => String(n)));

        // getConfig() returns { success, config: { textModel, ... } }
        const config = configResponse?.config || configResponse;
        const required = [
          config?.embeddingModel || AI_DEFAULTS?.EMBEDDING?.MODEL,
          config?.textModel || AI_DEFAULTS?.TEXT?.MODEL
        ].filter(Boolean);
        const missing = required.filter((name) => !available.has(name));
        setModelCheckState(missing.length > 0 ? 'missing' : 'ready');
        if (modelsResponse?.requiresModelConfirmation) {
          addNotification(
            'Some saved AI model names are outdated. Review model selections in Settings.',
            'warning',
            6000,
            'model-corrections'
          );
        }
      } catch {
        // If the IPC call fails (service not ready), treat as ready and let
        // backgroundSetup handle downloads. Don't block the user.
        if (!cancelled) setModelCheckState('ready');
      }
    }
    checkModels();
    return () => {
      cancelled = true;
    };
  }, [addNotification]);

  const handleModelSetupComplete = useCallback(() => {
    setModelCheckState('ready');
    addNotification('AI models are ready. You can start organizing files.', 'success');
  }, [addNotification]);

  const handleModelSetupSkip = useCallback(() => {
    setModelCheckState('ready');
    addNotification(
      'Models will download in the background. Some AI features may be limited until complete.',
      'info'
    );
  }, [addNotification]);

  // FIX: Notify user if their previous session state was expired due to TTL
  useEffect(() => {
    if (window.__STRATOSORT_STATE_EXPIRED__) {
      const ageHours = window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__ || 24;
      addNotification(
        `Previous session (${ageHours}h old) was cleared to ensure fresh data. Your files are safe.`,
        'info'
      );
      // Clear flag so notification doesn't repeat
      delete window.__STRATOSORT_STATE_EXPIRED__;
      delete window.__STRATOSORT_STATE_EXPIRED_AGE_HOURS__;
    }
  }, [addNotification]);

  const actions = {
    advancePhase: (phase) => dispatch(setPhase(phase))
  };

  const flowSteps = [
    {
      icon: Search,
      title: 'Discover',
      copy: 'Drop folders, run system scans, or watch Downloads automatically.'
    },
    {
      icon: Sparkles,
      title: 'Analyze',
      copy: 'Local AI reads file contents, context, and prior choices.'
    },
    {
      icon: FolderCheck,
      title: 'Organize',
      copy: 'Approve suggestions, rename intelligently, undo instantly.'
    }
  ];

  // Show ModelSetupWizard when required models are missing
  if (modelCheckState === 'missing') {
    return (
      <div className="flex flex-col flex-1 min-h-0 justify-center py-12">
        <ModelSetupWizard onComplete={handleModelSetupComplete} onSkip={handleModelSetupSkip} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 justify-center py-12">
      {/* Main content wrapper - centers vertically and limits max width */}
      <div className="flex flex-col gap-10 max-w-3xl mx-auto w-full px-6">
        {/* Header - compact and centered */}
        <header className="text-center space-y-6">
          <Text
            variant="tiny"
            className="uppercase tracking-[0.25em] font-medium text-system-gray-500"
          >
            Intelligent file orchestration
          </Text>
          <Heading as="h1" variant="display" id="welcome-heading" className="leading-tight">
            <Rocket
              className="inline-block animate-float text-stratosort-blue w-10 h-10 md:w-12 md:h-12 mr-4 align-middle"
              aria-label="rocket"
            />
            Welcome to <span className="text-gradient">StratoSort</span>
          </Heading>
          <Text variant="lead" className="max-w-xl mx-auto text-system-gray-600">
            Let our local AI co-pilot study your workspace, understand every file, and deliver calm,
            glassy organization in minutes.
          </Text>
        </header>

        {/* Primary Actions Card */}
        <Card variant="hero" role="navigation" aria-label="Primary actions">
          <div className="flex flex-col">
            {/* Primary Action - Organize */}
            <div className="flex flex-col gap-3 items-center pb-8 border-b border-border-soft">
              <Button
                onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                variant="primary"
                size="lg"
                className="w-full max-w-md justify-center shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5"
                aria-describedby="organize-help"
              >
                <FolderOpen className="w-6 h-6 mr-3" />
                <span className="font-semibold text-lg">Organize files now</span>
              </Button>
              <Text
                variant="small"
                className="text-center text-system-gray-500 font-medium"
                id="organize-help"
              >
                Start scanning with smart defaults
              </Text>
            </div>

            {/* Secondary Actions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6">
              {/* Tertiary Action - AI / Model settings */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => dispatch(toggleSettings())}
                  variant="secondary"
                  className="w-full justify-center h-full py-4 bg-white/50 hover:bg-white/80"
                  aria-describedby="ai-setup-help"
                >
                  <Sparkles className="w-4 h-4 mr-2 text-stratosort-purple" />
                  <span>AI &amp; model settings</span>
                </Button>
                <Text
                  variant="tiny"
                  className="text-center text-system-gray-400"
                  id="ai-setup-help"
                >
                  Configure models and preferences
                </Text>
              </div>

              {/* Secondary Action - Configure */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => actions.advancePhase(PHASES?.SETUP ?? 'setup')}
                  variant="secondary"
                  className="w-full justify-center h-full py-4 bg-white/50 hover:bg-white/80"
                  aria-describedby="setup-help"
                >
                  <Settings className="w-4 h-4 mr-2 text-system-gray-600" />
                  <span>Configure smart folders</span>
                </Button>
                <Text variant="tiny" className="text-center text-system-gray-400" id="setup-help">
                  Set up destinations first
                </Text>
              </div>
            </div>
          </div>
        </Card>

        {/* How it works link */}
        <div className="text-center">
          <button
            onClick={() => setShowFlowsModal(true)}
            className="text-sm text-system-gray-500 hover:text-stratosort-blue transition-colors hover:underline underline-offset-4"
          >
            How does StratoSort work?
          </button>
        </div>
      </div>

      {/* Flows Modal */}
      <Modal
        isOpen={showFlowsModal}
        onClose={() => setShowFlowsModal(false)}
        title="How StratoSort Works"
        size="md"
        footer={
          <Stack gap="compact" className="w-full">
            <Button
              onClick={() => {
                setShowFlowsModal(false);
                actions.advancePhase(PHASES?.DISCOVER ?? 'discover');
              }}
              variant="primary"
              size="sm"
              className="w-full"
            >
              Get Started
            </Button>
          </Stack>
        }
      >
        <Stack gap="default">
          <Text variant="body">
            StratoSort uses a simple three-step flow to organize your files intelligently.
          </Text>
          <Stack gap="cozy">
            {flowSteps.map((item, idx) => (
              <div
                key={item.title}
                className="flex items-start bg-system-gray-50 rounded-lg p-4 gap-4"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-stratosort-blue/10 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-stratosort-blue" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Text
                      as="span"
                      variant="tiny"
                      className="font-medium text-system-gray-400 uppercase tracking-wider"
                    >
                      Step {idx + 1}
                    </Text>
                  </div>
                  <Heading as="h4" variant="h6" className="mb-1">
                    {item.title}
                  </Heading>
                  <Text variant="small">{item.copy}</Text>
                </div>
              </div>
            ))}
          </Stack>
        </Stack>
      </Modal>
    </div>
  );
}

export default WelcomePhase;
