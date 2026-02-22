import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Rocket, FolderOpen, Settings, Search, Sparkles, FolderCheck, Loader2 } from 'lucide-react';
import { PHASES, AI_DEFAULTS } from '../../shared/constants';
import { useAppDispatch } from '../store/hooks';
import { toggleSettings, setPhase } from '../store/slices/uiSlice';
import { useNotification } from '../contexts/NotificationContext';
import { Button, Card } from '../components/ui';
import { Heading, Text, Caption } from '../components/ui/Typography';
import Modal from '../components/ui/Modal';
import { Stack } from '../components/layout';
import ModelSetupWizard from '../components/ModelSetupWizard';
import { isForceModelWizardEnabled } from '../utils/debugFlags';

const MODEL_CHECK_ESCAPE_MS = 8000;
const LOADING_STATUS_MESSAGES = [
  'Checking local model availability...',
  'Checking active background downloads...',
  'Preparing safe first-run defaults...'
];

function WelcomePhase() {
  const dispatch = useAppDispatch();
  const { addNotification } = useNotification();
  const [showFlowsModal, setShowFlowsModal] = useState(false);
  const [modelCheckState, setModelCheckState] = useState('loading'); // 'loading' | 'missing' | 'ready' | 'downloading'
  const modelCheckLockedRef = useRef(false);
  const [showLoadingEscape, setShowLoadingEscape] = useState(false);
  const [loadingStatusIndex, setLoadingStatusIndex] = useState(0);

  // Check if required AI models are downloaded
  // Retry once after delay when models list is empty - LlamaService may not be ready yet
  useEffect(() => {
    let cancelled = false;
    const RETRY_DELAY_MS = 1800;
    const forceModelWizard = isForceModelWizardEnabled();
    modelCheckLockedRef.current = false;

    function setModelCheckStateIfAllowed(nextState) {
      if (!cancelled && !modelCheckLockedRef.current) {
        setModelCheckState(nextState);
      }
    }

    if (forceModelWizard) {
      setModelCheckStateIfAllowed('missing');
      return () => {
        cancelled = true;
      };
    }

    async function getActiveMissingDownloadCount(missingModelNames = []) {
      const getStatus = window?.electronAPI?.llama?.getDownloadStatus;
      if (typeof getStatus !== 'function') return 0;
      try {
        const response = await getStatus();
        const downloads = Array.isArray(response?.status?.downloads)
          ? response.status.downloads
          : [];
        if (!Array.isArray(missingModelNames) || missingModelNames.length === 0) {
          return downloads.length;
        }
        const missing = new Set(missingModelNames);
        return downloads.filter((entry) => missing.has(entry?.filename)).length;
      } catch {
        // Download status is best-effort and should not mask missing model state.
        return 0;
      }
    }

    async function doCheck() {
      const getModels = window?.electronAPI?.llama?.getModels;
      const getConfig = window?.electronAPI?.llama?.getConfig;
      if (typeof getModels !== 'function') {
        setModelCheckStateIfAllowed('ready');
        return;
      }
      const [modelsResponse, configResponse] = await Promise.all([
        getModels(),
        typeof getConfig === 'function' ? getConfig() : Promise.resolve(null)
      ]);
      if (cancelled) return;

      const modelNames = Array.isArray(modelsResponse?.models)
        ? modelsResponse.models
        : Array.isArray(modelsResponse)
          ? modelsResponse.map((m) => m.name || m.filename || '')
          : [];
      const available = new Set(modelNames.map((n) => String(n)));

      const config = configResponse?.config || configResponse;
      const required = [
        config?.embeddingModel || AI_DEFAULTS?.EMBEDDING?.MODEL,
        config?.textModel || AI_DEFAULTS?.TEXT?.MODEL
      ].filter(Boolean);
      const missing = required.filter((name) => !available.has(name));

      if (missing.length === 0) {
        setModelCheckStateIfAllowed('ready');
        return;
      }

      // When required models are missing but available is empty, retry once
      // (LlamaService/filesystem may still be initializing)
      if (available.size === 0 && missing.length > 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        if (cancelled) return;
        const retryResponse = await getModels();
        if (cancelled) return;
        const retryNames = Array.isArray(retryResponse?.models)
          ? retryResponse.models
          : Array.isArray(retryResponse)
            ? retryResponse.map((m) => m.name || m.filename || '')
            : [];
        const retryAvailable = new Set(retryNames.map((n) => String(n)));
        const retryMissing = required.filter((name) => !retryAvailable.has(name));
        if (retryMissing.length > 0) {
          const activeCount = await getActiveMissingDownloadCount(retryMissing);
          setModelCheckStateIfAllowed(activeCount > 0 ? 'downloading' : 'missing');
        } else {
          setModelCheckStateIfAllowed('ready');
        }
        if (retryResponse?.requiresModelConfirmation) {
          addNotification(
            'Some saved AI model names are outdated. Review model selections in Settings.',
            'warning',
            6000,
            'model-corrections'
          );
        }
        return;
      }

      if (missing.length > 0) {
        const activeCount = await getActiveMissingDownloadCount(missing);
        setModelCheckStateIfAllowed(activeCount > 0 ? 'downloading' : 'missing');
      } else {
        setModelCheckStateIfAllowed('ready');
      }
      if (modelsResponse?.requiresModelConfirmation) {
        addNotification(
          'Some saved AI model names are outdated. Review model selections in Settings.',
          'warning',
          6000,
          'model-corrections'
        );
      }
    }

    async function checkModels() {
      try {
        await doCheck();
      } catch {
        setModelCheckStateIfAllowed('missing');
      }
    }
    checkModels();
    return () => {
      cancelled = true;
    };
  }, [addNotification]);

  const handleModelSetupComplete = useCallback(() => {
    modelCheckLockedRef.current = true;
    setModelCheckState('ready');
    addNotification('AI models are ready. You can start organizing files.', 'success');
  }, [addNotification]);

  const handleModelSetupSkip = useCallback(() => {
    modelCheckLockedRef.current = true;
    setModelCheckState('ready');
    addNotification(
      'Continuing with limited AI while models finish downloading in the background.',
      'info'
    );
  }, [addNotification]);

  const handleOpenModelSetup = useCallback(() => {
    modelCheckLockedRef.current = true;
    setModelCheckState('missing');
    addNotification('Opening model setup. You can continue with limited AI at any time.', 'info');
  }, [addNotification]);

  useEffect(() => {
    if (modelCheckState !== 'loading') {
      setShowLoadingEscape(false);
      setLoadingStatusIndex(0);
      return undefined;
    }

    const timer = setTimeout(() => {
      setShowLoadingEscape(true);
    }, MODEL_CHECK_ESCAPE_MS);

    return () => clearTimeout(timer);
  }, [modelCheckState]);

  useEffect(() => {
    if (modelCheckState !== 'loading') return undefined;

    const timer = setInterval(() => {
      setLoadingStatusIndex((prev) => (prev + 1) % LOADING_STATUS_MESSAGES.length);
    }, 2200);

    return () => clearInterval(timer);
  }, [modelCheckState]);

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

  if (modelCheckState === 'loading') {
    return (
      <div className="flex flex-col flex-1 min-h-0 justify-center py-12">
        <Card className="max-w-2xl mx-auto p-8 text-center border border-stratosort-blue/15 bg-gradient-to-b from-white to-stratosort-blue/5 animate-loading-fade">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stratosort-blue/10 mb-4">
              <Loader2 className="w-7 h-7 text-stratosort-blue animate-spin" />
            </div>
            <Heading as="h2" variant="h2">
              Preparing AI Setup
            </Heading>
            <Text className="text-system-gray-600 mt-2">
              Checking model availability and background downloads so your first run starts cleanly.
            </Text>
            <Text variant="tiny" className="text-system-gray-500 mt-2">
              {LOADING_STATUS_MESSAGES[loadingStatusIndex]}
            </Text>
          </div>
          {showLoadingEscape && (
            <div className="flex flex-col items-center gap-3">
              <Text variant="tiny" className="text-system-gray-500">
                Still checking models. Continue now or open setup manually.
              </Text>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button onClick={handleModelSetupSkip} variant="secondary">
                  Continue with limited AI
                </Button>
                <Button onClick={handleOpenModelSetup} variant="primary">
                  Open model setup
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // Use one setup flow for missing and active background downloads.
  if (modelCheckState === 'missing' || modelCheckState === 'downloading') {
    return (
      <div className="flex flex-col flex-1 min-h-0 justify-center py-12">
        <ModelSetupWizard onComplete={handleModelSetupComplete} onSkip={handleModelSetupSkip} />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 justify-center py-12">
      {/* Main content wrapper - centers vertically and limits max width */}
      <div className="flex flex-col gap-relaxed lg:gap-spacious max-w-3xl mx-auto w-full px-6">
        {/* Header - compact and centered */}
        <header className="text-center space-y-6">
          <Caption className="text-system-gray-500">Intelligent file orchestration</Caption>
          <Heading as="h1" variant="display" id="welcome-heading" className="leading-tight">
            <Rocket
              className="inline-block animate-float text-stratosort-blue w-10 h-10 md:w-12 md:h-12 mr-4 align-middle"
              aria-label="rocket"
            />
            Welcome to <span className="text-gradient">StratoSort</span>
          </Heading>
          <Text variant="lead" className="max-w-xl mx-auto">
            Let our local AI co-pilot study your workspace, understand every file, and deliver calm,
            glassy organization in minutes.
          </Text>
        </header>

        {/* Primary Actions Card */}
        <Card variant="hero" role="navigation" aria-label="Primary actions">
          <Stack gap="default">
            {/* Primary Action - Organize */}
            <div className="flex flex-col gap-3 items-center pb-6 border-b border-border-soft">
              <Button
                onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                variant="primary"
                size="lg"
                className="w-full max-w-md justify-center"
                aria-describedby="organize-help"
              >
                <FolderOpen className="w-5 h-5" />
                Organize files now
              </Button>
              <Text variant="small" className="text-center" id="organize-help">
                Start scanning with smart defaults
              </Text>
            </div>

            {/* Secondary Actions Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Tertiary Action - AI / Model settings */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => dispatch(toggleSettings())}
                  variant="secondary"
                  className="w-full justify-center h-full py-4"
                  aria-describedby="ai-setup-help"
                >
                  <Sparkles className="w-4 h-4 text-stratosort-purple" />
                  AI &amp; model settings
                </Button>
                <Text variant="tiny" className="text-center" id="ai-setup-help">
                  Configure models and preferences
                </Text>
              </div>

              {/* Secondary Action - Configure */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => actions.advancePhase(PHASES?.SETUP ?? 'setup')}
                  variant="secondary"
                  className="w-full justify-center h-full py-4"
                  aria-describedby="setup-help"
                >
                  <Settings className="w-4 h-4" />
                  Configure smart folders
                </Button>
                <Text variant="tiny" className="text-center" id="setup-help">
                  Set up destinations first
                </Text>
              </div>
            </div>
          </Stack>
        </Card>

        {/* How it works link */}
        <div className="text-center">
          <Button onClick={() => setShowFlowsModal(true)} variant="ghost" size="sm">
            How does StratoSort work?
          </Button>
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
                  <Caption className="block text-system-gray-400 mb-1">Step {idx + 1}</Caption>
                  <Heading as="h3" variant="h6" className="mb-1">
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
