/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../src/renderer/store/hooks', () => ({
  useAppDispatch: jest.fn(() => jest.fn())
}));

jest.mock('../../src/renderer/contexts/NotificationContext', () => ({
  useNotification: jest.fn(() => ({ addNotification: jest.fn() }))
}));

jest.mock('../../src/renderer/store/slices/uiSlice', () => ({
  toggleSettings: jest.fn(() => ({ type: 'ui/toggleSettings' })),
  setPhase: jest.fn((phase) => ({ type: 'ui/setPhase', payload: phase }))
}));

jest.mock('../../src/renderer/components/ui', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Card: ({ children }) => <div data-testid="card">{children}</div>
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Heading: ({ children }) => <h1>{children}</h1>,
  Text: ({ children }) => <span>{children}</span>,
  Caption: ({ children }) => <small>{children}</small>
}));

jest.mock('../../src/renderer/components/ui/Modal', () => ({
  __esModule: true,
  default: ({ isOpen, children }) => (isOpen ? <div data-testid="modal">{children}</div> : null)
}));

jest.mock('../../src/renderer/components/layout', () => ({
  Stack: ({ children }) => <div>{children}</div>
}));

jest.mock('../../src/renderer/components/ModelSetupWizard', () => ({
  __esModule: true,
  default: () => <div data-testid="model-setup-wizard" />
}));

jest.mock('lucide-react', () => ({
  Rocket: () => <span />,
  FolderOpen: () => <span />,
  Settings: () => <span />,
  Search: () => <span />,
  Sparkles: () => <span />,
  FolderCheck: () => <span />
}));

import WelcomePhase from '../../src/renderer/phases/WelcomePhase';

describe('WelcomePhase', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    delete window.electronAPI;
    delete window.__STRATOSORT_FORCE_MODEL_WIZARD__;
    delete window.__STRATOSORT_DEBUG_MODE__;
    window.localStorage.removeItem('stratosort:debugMode');
    window.localStorage.removeItem('stratosort:forceModelWizard');
    window.history.replaceState({}, '', '/');
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('renders main content when Electron API is unavailable', async () => {
    window.electronAPI = undefined;
    render(<WelcomePhase />);

    await waitFor(() => {
      expect(screen.getByText(/Organize files now/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('model-setup-wizard')).not.toBeInTheDocument();
  });

  test('renders main content when getModels is missing', async () => {
    window.electronAPI = { llama: {} };
    render(<WelcomePhase />);

    await waitFor(() => {
      expect(screen.getByText(/Organize files now/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('model-setup-wizard')).not.toBeInTheDocument();
  });

  test('shows background downloading state when missing models are actively downloading', async () => {
    window.electronAPI = {
      llama: {
        getModels: jest.fn(async () => ({ models: ['unrelated.gguf'] })),
        getConfig: jest.fn(async () => ({
          success: true,
          config: {
            embeddingModel: 'embed-required.gguf',
            textModel: 'text-required.gguf'
          }
        })),
        getDownloadStatus: jest.fn(async () => ({
          success: true,
          status: {
            active: 1,
            downloads: [{ filename: 'embed-required.gguf', status: 'downloading' }]
          }
        }))
      }
    };

    render(<WelcomePhase />);

    await waitFor(() => {
      expect(screen.getByText(/Downloading AI Models/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('model-setup-wizard')).not.toBeInTheDocument();
  });

  test('shows model setup wizard when dev force flag is enabled', async () => {
    process.env.NODE_ENV = 'development';
    window.history.replaceState({}, '', '/?forceModelWizard=1');
    window.electronAPI = undefined;

    render(<WelcomePhase />);

    await waitFor(() => {
      expect(screen.getByTestId('model-setup-wizard')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Organize files now/i)).not.toBeInTheDocument();
  });
});
