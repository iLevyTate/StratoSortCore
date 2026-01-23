import React, { useState, useEffect } from 'react';
import { Rocket, FolderOpen, Settings, Search, Sparkles, FolderCheck } from 'lucide-react';
import { PHASES } from '../../shared/constants';
import { useAppDispatch } from '../store/hooks';
import { setActiveModal, setPhase } from '../store/slices/uiSlice';
import { useNotification } from '../contexts/NotificationContext';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';

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
    <div className="phase-container bg-system-gray-50/40">
      <section className="container-responsive flex flex-col flex-1 min-h-0 justify-center py-8 md:py-10">
        {/* Main content wrapper - centers vertically and limits max width */}
        <div className="flex flex-col gap-6 md:gap-8 max-w-2xl mx-auto w-full">
          {/* Header - compact and centered */}
          <header className="text-center space-y-2">
            <p className="text-xs md:text-sm font-medium uppercase tracking-[0.25em] text-system-gray-500">
              Intelligent file orchestration
            </p>
            <h1 id="welcome-heading" className="heading-primary" aria-level="1">
              <Rocket
                className="inline-block animate-float text-stratosort-blue w-7 h-7 md:w-8 md:h-8 mr-3 align-middle"
                aria-label="rocket"
              />
              Welcome to <span className="text-gradient">StratoSort</span>
            </h1>
            <p className="text-sm md:text-base text-system-gray-600 leading-relaxed max-w-xl mx-auto">
              Let our local AI co-pilot study your workspace, understand every file, and deliver
              calm, glassy organization in minutes.
            </p>
          </header>

          {/* Primary Actions Card */}
          <div className="surface-panel w-full" role="navigation" aria-label="Primary actions">
            <div className="flex flex-col gap-4">
              {/* Primary Action - Organize */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => actions.advancePhase(PHASES?.DISCOVER ?? 'discover')}
                  variant="primary"
                  className="w-full justify-center text-base"
                  aria-describedby="organize-help"
                >
                  <FolderOpen className="w-5 h-5" />
                  <span>Organize files now</span>
                </Button>
                <p id="organize-help" className="text-xs text-system-gray-500 text-center">
                  Start scanning with smart defaults
                </p>
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
                  <Sparkles className="w-4 h-4" />
                  <span>Set up AI components (Ollama + ChromaDB)</span>
                </Button>
                <p id="ai-setup-help" className="text-xs text-system-gray-500 text-center">
                  Optional, runs in the background
                </p>
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
                  <Settings className="w-4 h-4" />
                  <span>Configure smart folders</span>
                </Button>
                <p id="setup-help" className="text-xs text-system-gray-500 text-center">
                  Set up destinations first
                </p>
              </div>
            </div>
          </div>

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
      </section>

      {/* Flows Modal */}
      <Modal
        isOpen={showFlowsModal}
        onClose={() => setShowFlowsModal(false)}
        title="How StratoSort Works"
        size="medium"
      >
        <div className="flex flex-col gap-default">
          <p className="text-sm text-system-gray-600">
            StratoSort uses a simple three-step flow to organize your files intelligently.
          </p>
          <div className="flex flex-col gap-cozy">
            {flowSteps.map((item, idx) => (
              <div
                key={item.title}
                className="flex items-start bg-system-gray-50 rounded-lg p-default gap-default"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-stratosort-blue/10 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-stratosort-blue" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-compact">
                    <span className="text-xs font-medium text-system-gray-400">Step {idx + 1}</span>
                  </div>
                  <p className="text-sm font-semibold text-system-gray-800">{item.title}</p>
                  <p className="text-xs text-system-gray-600 mt-1">{item.copy}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border-soft/50 pt-4">
            <Button
              onClick={() => {
                setShowFlowsModal(false);
                actions.advancePhase(PHASES?.DISCOVER ?? 'discover');
              }}
              variant="primary"
              className="w-full"
            >
              Get Started
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default WelcomePhase;
