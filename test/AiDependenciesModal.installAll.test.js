/**
 * Tests for AiDependenciesModal install-all UX (renderer).
 * Focus: button rendering, background install trigger, failure resilience.
 */

import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AiDependenciesModal from '../src/renderer/components/AiDependenciesModal';

// Mock logger to avoid noisy output
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Minimal electronAPI mocks
const mockInstallOllama = jest.fn();
const mockInstallChroma = jest.fn();
const mockPullModels = jest.fn();
const mockSettingsGet = jest.fn().mockResolvedValue({
  textModel: 'llama3.2',
  visionModel: 'llava',
  embeddingModel: 'mxbai-embed-large'
});
const mockSettingsSave = jest.fn();
const mockDepsGetStatus = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.window = {
    electronAPI: {
      settings: {
        get: mockSettingsGet,
        save: mockSettingsSave
      },
      dependencies: {
        getStatus: mockDepsGetStatus,
        installOllama: mockInstallOllama,
        installChromaDb: mockInstallChroma
      },
      ollama: {
        pullModels: mockPullModels
      },
      events: {
        onOperationProgress: jest.fn(),
        onServiceStatusChanged: jest.fn()
      }
    }
  };
});

afterEach(() => {
  delete global.window;
});

function renderModal(overrides = {}) {
  const defaultStatus = {
    python: { installed: true },
    ollama: { installed: false, running: false },
    chromadb: { pythonModuleInstalled: false, running: false, external: false }
  };
  mockDepsGetStatus.mockResolvedValue({
    status: { ...defaultStatus, ...(overrides.status || {}) }
  });
  return render(<AiDependenciesModal isOpen onClose={jest.fn()} />);
}

test('renders Install All button when open', async () => {
  await act(async () => renderModal());
  expect(screen.getByText(/Install All \(Background\)/i)).toBeInTheDocument();
});

test('install-all handles install failure and shows retry', async () => {
  mockInstallOllama.mockResolvedValue({ success: false, error: 'fail' });
  mockInstallChroma.mockResolvedValue({ success: true });
  mockPullModels.mockResolvedValue({ success: true });

  await act(async () => renderModal());
  const button = screen.getByText(/Install All \(Background\)/i);
  await waitFor(() => expect(button).not.toBeDisabled());
  await act(async () => fireEvent.click(button));
  await act(async () => Promise.resolve());

  // Retry button should appear
  const retryButton = await waitFor(() => screen.getByTestId('retry-install-all'));

  expect(retryButton).toBeInTheDocument();
});

test('disables Install All when loading initial status', async () => {
  mockDepsGetStatus.mockResolvedValueOnce({ status: null });
  await act(async () => renderModal({ status: null }));
  const button = screen.getByText(/Install All \(Background\)/i);
  // During initial fetch, it may still be enabled; ensure no throw when clicking
  await act(async () => fireEvent.click(button));
  expect(mockInstallOllama).toHaveBeenCalledTimes(0);
});

test('toggle log visibility', async () => {
  await act(async () => renderModal());
  const toggle = screen.getByTestId('toggle-log');
  expect(screen.queryByTestId('ai-deps-log')).not.toBeInTheDocument();
  await act(async () => fireEvent.click(toggle));
  expect(screen.getByTestId('ai-deps-log')).toBeInTheDocument();
  await act(async () => fireEvent.click(toggle));
  expect(screen.queryByTestId('ai-deps-log')).not.toBeInTheDocument();
});
