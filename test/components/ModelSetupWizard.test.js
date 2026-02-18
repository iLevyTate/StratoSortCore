/**
 * @jest-environment jsdom
 */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ModelSetupWizard from '../../src/renderer/components/ModelSetupWizard';

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
      expect(screen.getByText(/AI Model Setup/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        /AI check is taking longer than expected\. You can continue with manual setup/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/Download Models/i)).toBeInTheDocument();
  });
});
