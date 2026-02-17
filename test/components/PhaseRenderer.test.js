/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockState;
const mockUseKeyboardShortcuts = jest.fn();

jest.mock('../../src/shared/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

jest.mock('../../src/renderer/store/hooks', () => ({
  useAppSelector: jest.fn((selector) => selector(mockState))
}));

jest.mock('../../src/renderer/hooks', () => ({
  useKeyboardShortcuts: jest.fn(() => mockUseKeyboardShortcuts())
}));

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>
  },
  useReducedMotion: jest.fn(() => false)
}));

jest.mock('../../src/renderer/components/PhaseErrorBoundary', () => ({
  __esModule: true,
  default: ({ phaseName, children }) => (
    <div data-testid={`phase-boundary-${phaseName.toLowerCase()}`}>{children}</div>
  )
}));

jest.mock('../../src/renderer/components/ui/LoadingSkeleton', () => ({
  LazyLoadingSpinner: ({ message }) => <div>{message}</div>,
  ModalLoadingOverlay: ({ message }) => <div>{message}</div>
}));

jest.mock('../../src/renderer/phases/WelcomePhase', () => ({
  __esModule: true,
  default: () => <div>WELCOME_PHASE</div>
}));
jest.mock('../../src/renderer/phases/SetupPhase', () => ({
  __esModule: true,
  default: () => <div>SETUP_PHASE</div>
}));
jest.mock('../../src/renderer/phases/DiscoverPhase', () => ({
  __esModule: true,
  default: () => <div>DISCOVER_PHASE</div>
}));
jest.mock('../../src/renderer/phases/OrganizePhase', () => ({
  __esModule: true,
  default: () => <div>ORGANIZE_PHASE</div>
}));
jest.mock('../../src/renderer/phases/CompletePhase', () => ({
  __esModule: true,
  default: () => <div>COMPLETE_PHASE</div>
}));
jest.mock('../../src/renderer/components/SettingsPanel', () => ({
  __esModule: true,
  default: () => <div>SETTINGS_PANEL</div>
}));

import PhaseRenderer from '../../src/renderer/components/PhaseRenderer';

describe('PhaseRenderer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = {
      ui: {
        currentPhase: 'welcome',
        showSettings: false
      }
    };
  });

  test('renders the current phase inside the matching boundary', async () => {
    mockState.ui.currentPhase = 'discover';

    render(<PhaseRenderer />);

    expect(await screen.findByText('DISCOVER_PHASE')).toBeInTheDocument();
    expect(screen.getByTestId('phase-boundary-discover')).toBeInTheDocument();
    expect(mockUseKeyboardShortcuts).toHaveBeenCalledTimes(1);
  });

  test('falls back to welcome phase when phase key is unknown', async () => {
    mockState.ui.currentPhase = 'unexpected-phase';

    render(<PhaseRenderer />);

    expect(await screen.findByText('WELCOME_PHASE')).toBeInTheDocument();
    expect(screen.getByTestId('phase-boundary-welcome')).toBeInTheDocument();
  });

  test('renders settings panel inside settings boundary when enabled', async () => {
    mockState.ui.currentPhase = 'setup';
    mockState.ui.showSettings = true;

    render(<PhaseRenderer />);

    expect(await screen.findByText('SETTINGS_PANEL')).toBeInTheDocument();
    expect(screen.getByTestId('phase-boundary-settings')).toBeInTheDocument();
  });
});
