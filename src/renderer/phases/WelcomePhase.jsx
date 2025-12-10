import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { PHASES } from '../../shared/constants';
import { useAppDispatch } from '../store/hooks';
import { setPhase } from '../store/slices/uiSlice';
import Button from '../components/ui/Button';
import Modal from '../components/Modal';

// Inline SVG Icons
const RocketIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
    />
  </svg>
);

const FolderOpenIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"
    />
  </svg>
);

const SettingsIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);

const SearchIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
    />
  </svg>
);

const SparklesIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
    />
  </svg>
);

const FolderCheckIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13l2 2 4-4" />
  </svg>
);

function WelcomePhase() {
  const dispatch = useAppDispatch();
  const [showFlowsModal, setShowFlowsModal] = useState(false);

  const actions = {
    advancePhase: (phase) => dispatch(setPhase(phase))
  };

  const flowSteps = [
    {
      icon: SearchIcon,
      title: 'Discover',
      copy: 'Drop folders, run system scans, or watch Downloads automatically.'
    },
    {
      icon: SparklesIcon,
      title: 'Analyze',
      copy: 'Local AI reads file contents, context, and prior choices.'
    },
    {
      icon: FolderCheckIcon,
      title: 'Organize',
      copy: 'Approve suggestions, rename intelligently, undo instantly.'
    }
  ];

  return (
    <div className="phase-container bg-system-gray-50/40">
      <section className="container-responsive flex flex-col flex-1 min-h-0 justify-center py-6 md:py-8">
        {/* Main content wrapper - centers vertically and limits max width */}
        <div className="flex flex-col gap-6 md:gap-8 max-w-2xl mx-auto w-full">
          {/* Header - compact and centered */}
          <header className="text-center space-y-2">
            <p className="text-xs md:text-sm font-medium uppercase tracking-[0.25em] text-system-gray-500">
              Intelligent file orchestration
            </p>
            <h1 id="welcome-heading" className="heading-primary" aria-level="1">
              <RocketIcon
                className="inline-block animate-float text-stratosort-blue w-7 h-7 md:w-8 md:h-8 mr-2 align-middle"
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
            <div className="flex flex-col" style={{ gap: 'var(--spacing-default)' }}>
              {/* Primary Action - Organize */}
              <div className="flex flex-col" style={{ gap: 'var(--spacing-cozy)' }}>
                <Button
                  onClick={() => actions.advancePhase(PHASES.DISCOVER)}
                  variant="primary"
                  className="w-full justify-center text-base"
                  style={{ padding: 'var(--button-padding-lg)' }}
                  aria-describedby="organize-help"
                >
                  <FolderOpenIcon className="w-5 h-5 mr-2" />
                  Organize files now
                </Button>
                <p id="organize-help" className="text-xs text-system-gray-500 text-center">
                  Start scanning with smart defaults
                </p>
              </div>

              <div className="border-t border-border-soft/50" />

              {/* Secondary Action - Configure */}
              <div className="flex flex-col" style={{ gap: 'var(--spacing-cozy)' }}>
                <Button
                  onClick={() => actions.advancePhase(PHASES.SETUP)}
                  variant="secondary"
                  className="w-full justify-center"
                  aria-describedby="setup-help"
                >
                  <SettingsIcon className="w-4 h-4 mr-2" />
                  Configure smart folders
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
        <div className="flex flex-col" style={{ gap: 'var(--spacing-default)' }}>
          <p className="text-sm text-system-gray-600">
            StratoSort uses a simple three-step flow to organize your files intelligently.
          </p>
          <div className="flex flex-col" style={{ gap: 'var(--spacing-cozy)' }}>
            {flowSteps.map((item, idx) => (
              <div
                key={item.title}
                className="flex items-start bg-system-gray-50 rounded-lg"
                style={{ padding: 'var(--spacing-default)', gap: 'var(--spacing-default)' }}
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-stratosort-blue/10 flex items-center justify-center">
                  <item.icon className="w-5 h-5 text-stratosort-blue" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center" style={{ gap: 'var(--spacing-compact)' }}>
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
                actions.advancePhase(PHASES.DISCOVER);
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

const iconPropTypes = {
  className: PropTypes.string
};

RocketIcon.propTypes = iconPropTypes;
FolderOpenIcon.propTypes = iconPropTypes;
SettingsIcon.propTypes = iconPropTypes;
SearchIcon.propTypes = iconPropTypes;
SparklesIcon.propTypes = iconPropTypes;
FolderCheckIcon.propTypes = iconPropTypes;

export default WelcomePhase;
