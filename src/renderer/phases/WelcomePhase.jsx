import React, { useState, useEffect } from 'react';
import { Rocket, FolderOpen, Settings, Search, Sparkles, FolderCheck } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { useAppDispatch } from '../store/hooks';
import { setActiveModal, setPhase } from '../store/slices/uiSlice';
import { useNotification } from '../contexts/NotificationContext';
import { Button, Card } from '../components/ui';
import { Heading, Text } from '../components/ui/Typography';
import Modal from '../components/ui/Modal';
import { Stack } from '../components/layout';

function WelcomePhase() {
  const dispatch = useAppDispatch();
  const { addNotification } = useNotification();
  const [showFlowsModal, setShowFlowsModal] = useState(false);

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

  return (
    <div className="flex flex-col flex-1 min-h-0 justify-center py-10">
      {/* Main content wrapper - centers vertically and limits max width */}
      <div className="flex flex-col gap-8 max-w-2xl mx-auto w-full">
        {/* Header - compact and centered */}
        <header className="text-center space-y-4">
          <Text
            variant="tiny"
            className="uppercase tracking-[0.25em] font-medium text-system-gray-500"
          >
            Intelligent file orchestration
          </Text>
          <Heading as="h1" variant="display" id="welcome-heading">
            <Rocket
              className="inline-block animate-float text-stratosort-blue w-8 h-8 md:w-10 md:h-10 mr-3 align-middle"
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
          <Stack gap="relaxed">
            {/* Primary Action - Organize */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                variant="primary"
                size="md"
                className="w-full justify-center"
                aria-describedby="organize-help"
              >
                <FolderOpen className="w-5 h-5 mr-2" />
                <span>Organize files now</span>
              </Button>
              <Text variant="tiny" className="text-center text-system-gray-500" id="organize-help">
                Start scanning with smart defaults
              </Text>
            </div>

            <div className="border-t border-border-soft/50" />

            {/* Tertiary Action - AI setup */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => dispatch(setActiveModal('ai-deps'))}
                variant="secondary"
                className="w-full justify-center"
                aria-describedby="ai-setup-help"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                <span>Set up AI components (Ollama + ChromaDB)</span>
              </Button>
              <Text variant="tiny" className="text-center text-system-gray-500" id="ai-setup-help">
                Optional, runs in the background
              </Text>
            </div>

            <div className="border-t border-border-soft/50" />

            {/* Secondary Action - Configure */}
            <div className="flex flex-col gap-2">
              <Button
                onClick={() => actions.advancePhase(PHASES?.SETUP ?? 'setup')}
                variant="secondary"
                className="w-full justify-center"
                aria-describedby="setup-help"
              >
                <Settings className="w-4 h-4 mr-2" />
                <span>Configure smart folders</span>
              </Button>
              <Text variant="tiny" className="text-center text-system-gray-500" id="setup-help">
                Set up destinations first
              </Text>
            </div>
          </Stack>
        </Card>

        {/* How it works link */}
        <div className="text-center">
          <button
            onClick={() => setShowFlowsModal(true)}
            className="text-sm text-system-gray-500 hover:text-stratosort-blue transition-colors underline underline-offset-2"
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
