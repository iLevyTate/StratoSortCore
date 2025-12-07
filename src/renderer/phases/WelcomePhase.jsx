import React from 'react';
import { PHASES } from '../../shared/constants';
import { useAppDispatch } from '../store/hooks';
import { setPhase } from '../store/slices/uiSlice';
import Button from '../components/ui/Button';

function WelcomePhase() {
  const dispatch = useAppDispatch();
  const actions = {
    advancePhase: (phase) => dispatch(setPhase(phase)),
  };

  return (
    <div className="h-[calc(100vh-var(--app-nav-height))] w-full overflow-hidden bg-system-gray-50/40">
      <section className="container-responsive gap-6 text-center py-6 flex flex-col h-full min-h-0 overflow-y-auto modern-scrollbar">
        <header className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-system-gray-400">
            Intelligent file orchestration
          </p>
          <h1 id="welcome-heading" className="heading-primary" aria-level="1">
            <span
              className="animate-float inline-block"
              role="img"
              aria-label="rocket"
            >
              🚀
            </span>{' '}
            Welcome to <span className="text-gradient">StratoSort</span>
          </h1>
          <p className="text-base text-system-gray-600 leading-relaxed max-w-2xl mx-auto">
            Let our local AI co-pilot study your workspace, understand every
            file, and deliver calm, glassy organization in minutes.
          </p>
        </header>

        <div
          className="mx-auto flex w-full max-w-xl flex-col gap-3.5 rounded-2xl bg-white/85 p-5 shadow-lg"
          role="navigation"
          aria-label="Primary actions"
        >
          <Button
            onClick={() => actions.advancePhase(PHASES.DISCOVER)}
            variant="primary"
            className="w-full justify-center text-base"
            aria-describedby="organize-help"
          >
            🗂️ Organize files now
          </Button>
          <p id="organize-help" className="text-xs text-system-gray-500">
            Start scanning immediately with smart defaults.
          </p>
          <Button
            onClick={() => actions.advancePhase(PHASES.SETUP)}
            variant="secondary"
            className="w-full justify-center text-base"
            aria-describedby="setup-help"
          >
            ⚙️ Configure smart folders
          </Button>
          <p id="setup-help" className="text-xs text-system-gray-500">
            Curate destinations and automation thresholds first.
          </p>
        </div>

        <div className="section-card">
          <h3 className="heading-tertiary text-center">
            How StratoSort flows:
          </h3>
          <div className="grid gap-6 text-sm text-system-gray-600 sm:grid-cols-3">
            {[
              {
                icon: '🔍',
                title: 'Discover',
                copy: 'Drop folders, run system scans, or watch Downloads automatically.',
              },
              {
                icon: '🧠',
                title: 'Analyze',
                copy: 'Local AI reads file contents, context, and prior choices.',
              },
              {
                icon: '📂',
                title: 'Organize',
                copy: 'Approve suggestions, rename intelligently, undo instantly.',
              },
            ].map((item, idx) => (
              <div
                key={item.title}
                className="rounded-2xl border border-border-soft/60 bg-white/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div
                  className="mb-4 text-3xl animate-bounce-subtle"
                  style={{ animationDelay: `${idx * 120}ms` }}
                >
                  {item.icon}
                </div>
                <p className="text-base font-semibold text-system-gray-800">
                  {item.title}
                </p>
                <p className="text-muted mt-1">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default WelcomePhase;
