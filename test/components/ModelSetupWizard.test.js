/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ModelSetupWizard from '../../src/renderer/components/ModelSetupWizard';
import { INSTALL_MODEL_PROFILES } from '../../src/shared/constants';

jest.mock('../../src/renderer/components/ui/AlertBox', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>
}));

jest.mock('../../src/renderer/components/ui/Button', () => ({
  __esModule: true,
  default: ({ children, ...props }) => <button {...props}>{children}</button>
}));

jest.mock('../../src/renderer/components/ui/Card', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>
}));

jest.mock('../../src/renderer/components/ui/SelectionCard', () => ({
  __esModule: true,
  default: ({ children, onSelect, ...props }) => (
    <button onClick={onSelect} {...props}>
      {children}
    </button>
  )
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  __esModule: true,
  Text: ({ children, ...props }) => <span {...props}>{children}</span>,
  Heading: ({ children }) => <h2>{children}</h2>
}));

describe('ModelSetupWizard', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete window.electronAPI;
  });

  test('times out stuck system checks and falls back to manual setup', async () => {
    jest.useFakeTimers();

    window.electronAPI = {
      llama: {
        getConfig: jest.fn(() => new Promise(() => {})),
        getModels: jest.fn(() => new Promise(() => {})),
        getDownloadStatus: jest.fn(() => new Promise(() => {}))
      }
    };

    render(<ModelSetupWizard onComplete={jest.fn()} onSkip={jest.fn()} />);

    expect(screen.getByText(/Preparing AI Setup/i)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(12050);
    });

    await waitFor(() => {
      expect(screen.getByText(/Choose AI Models/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        /AI check is taking longer than expected\. You can continue with manual setup/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Download Models/i)).toBeInTheDocument();
    expect(screen.getByText(/Continue with limited AI/i)).toBeInTheDocument();
  });

  test('times out stuck checks under StrictMode', async () => {
    jest.useFakeTimers();

    window.electronAPI = {
      llama: {
        getConfig: jest.fn(() => new Promise(() => {})),
        getModels: jest.fn(() => new Promise(() => {})),
        getDownloadStatus: jest.fn(() => new Promise(() => {}))
      }
    };

    render(
      <React.StrictMode>
        <ModelSetupWizard onComplete={jest.fn()} onSkip={jest.fn()} />
      </React.StrictMode>
    );

    expect(screen.getByText(/Preparing AI Setup/i)).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(12050);
    });

    await waitFor(() => {
      expect(screen.getByText(/Choose AI Models/i)).toBeInTheDocument();
    });
  });

  test('reacts to download completion/error progress events', async () => {
    const baseProfile = INSTALL_MODEL_PROFILES?.BASE_SMALL?.models || {};
    const embeddingModel = baseProfile.EMBEDDING;
    const textModel = baseProfile.TEXT_ANALYSIS;
    const visionModel = baseProfile.IMAGE_ANALYSIS;

    let progressListener;
    window.electronAPI = {
      llama: {
        getConfig: jest.fn(async () => ({
          embeddingModel,
          textModel,
          visionModel
        })),
        getModels: jest.fn(async () => ({ models: [] })),
        getDownloadStatus: jest.fn(async () => ({
          status: {
            downloads: [
              { filename: embeddingModel, progress: 10 },
              { filename: textModel, progress: 10 },
              { filename: visionModel, progress: 10 }
            ]
          }
        }))
      },
      events: {
        onOperationProgress: jest.fn((cb) => {
          progressListener = cb;
          return jest.fn();
        })
      }
    };

    render(<ModelSetupWizard onComplete={jest.fn()} onSkip={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Downloading Models/i)).toBeInTheDocument();
    });

    await act(async () => {
      progressListener({ type: 'model-download-error', model: textModel, error: 'network' });
    });
    await waitFor(() => {
      expect(screen.getByText(/Retry Failed Downloads/i)).toBeInTheDocument();
    });

    await act(async () => {
      progressListener({ type: 'model-download-complete', model: embeddingModel });
      progressListener({ type: 'model-download-complete', model: textModel });
      progressListener({ type: 'model-download-complete', model: visionModel });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Continue$/i })).toBeInTheDocument();
    });
  });

  test('uses nested getConfig payload when checking missing required models', async () => {
    const baseProfile = INSTALL_MODEL_PROFILES?.BASE_SMALL?.models || {};
    const embeddingModel = baseProfile.EMBEDDING;
    const textModel = baseProfile.TEXT_ANALYSIS;
    const visionModel = baseProfile.IMAGE_ANALYSIS;

    window.electronAPI = {
      llama: {
        getConfig: jest.fn(async () => ({
          success: true,
          config: {
            embeddingModel: 'custom-embed.gguf',
            textModel: 'custom-text.gguf',
            visionModel
          }
        })),
        getModels: jest.fn(async () => ({ models: [embeddingModel, textModel] })),
        getDownloadStatus: jest.fn(async () => ({ status: { downloads: [] } }))
      },
      events: {
        onOperationProgress: jest.fn(() => jest.fn())
      }
    };

    render(<ModelSetupWizard onComplete={jest.fn()} onSkip={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Choose AI Models/i)).toBeInTheDocument();
    });
  });

  test('does not mark downloads complete when backend only reports started', async () => {
    jest.useFakeTimers();
    const baseProfile = INSTALL_MODEL_PROFILES?.BASE_SMALL?.models || {};
    const embeddingModel = baseProfile.EMBEDDING;
    const textModel = baseProfile.TEXT_ANALYSIS;
    const visionModel = baseProfile.IMAGE_ANALYSIS;

    const getDownloadStatus = jest
      .fn()
      .mockResolvedValueOnce({ status: { downloads: [] } })
      .mockResolvedValueOnce({
        status: {
          downloads: [
            { filename: embeddingModel, progress: 1 },
            { filename: textModel, progress: 1 }
          ]
        }
      });

    window.electronAPI = {
      llama: {
        getConfig: jest.fn(async () => ({
          success: true,
          config: {
            embeddingModel,
            textModel,
            visionModel
          }
        })),
        getModels: jest
          .fn()
          .mockResolvedValueOnce({ models: [] })
          .mockResolvedValueOnce({ models: [] }),
        getDownloadStatus,
        downloadModel: jest.fn(async () => ({ success: true, started: true }))
      },
      events: {
        onOperationProgress: jest.fn(() => jest.fn())
      }
    };

    render(<ModelSetupWizard onComplete={jest.fn()} onSkip={jest.fn()} />);

    await act(async () => {
      jest.advanceTimersByTime(7100);
    });

    const manualSetupButton = screen.queryByRole('button', { name: /Open manual setup/i });
    if (manualSetupButton) {
      fireEvent.click(manualSetupButton);
    }

    await act(async () => {
      // Ensure any pending timeout-driven fallback can resolve to the select step.
      jest.advanceTimersByTime(12050);
    });
    expect(screen.getByText(/Choose AI Models/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Download Models/i }));

    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.getByText(/Downloading Models/i)).toBeInTheDocument();
    expect(screen.queryByText(/Setup Complete!/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with limited AI/i })).toBeInTheDocument();
  });
});
