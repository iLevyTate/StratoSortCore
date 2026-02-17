/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockDispatch = jest.fn();
let mockState = {};

jest.mock('../../src/renderer/store/hooks', () => ({
  useAppDispatch: jest.fn(() => mockDispatch),
  useAppSelector: jest.fn((selector) => selector(mockState))
}));

jest.mock('../../src/renderer/store/slices/uiSlice', () => ({
  setPhase: jest.fn((phase) => ({ type: 'ui/setPhase', payload: phase })),
  toggleSettings: jest.fn(() => ({ type: 'ui/toggleSettings' })),
  canTransitionTo: jest.fn(() => true)
}));

jest.mock('../../src/renderer/contexts/FloatingSearchContext', () => ({
  useFloatingSearch: jest.fn(() => ({
    isWidgetOpen: false,
    openWidget: jest.fn(),
    closeWidget: jest.fn()
  }))
}));

jest.mock('../../src/renderer/components/UpdateIndicator', () => ({
  __esModule: true,
  default: () => <div data-testid="update-indicator" />
}));

jest.mock('../../src/renderer/components/ui', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  IconButton: ({ icon, children, ...props }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  )
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Text: ({ as: Component = 'span', children, ...props }) => (
    <Component {...props}>{children}</Component>
  )
}));

jest.mock('../../src/renderer/utils/platform', () => ({
  isMac: false
}));

jest.mock('lucide-react', () => ({
  Home: (props) => <svg data-testid="icon-home" {...props} />,
  Settings: (props) => <svg data-testid="icon-settings" {...props} />,
  Search: (props) => <svg data-testid="icon-search" {...props} />,
  FolderOpen: (props) => <svg data-testid="icon-folder-open" {...props} />,
  CheckCircle2: (props) => <svg data-testid="icon-check" {...props} />,
  Loader2: (props) => <svg data-testid="icon-loader" {...props} />,
  Minus: (props) => <svg data-testid="icon-minus" {...props} />,
  Square: (props) => <svg data-testid="icon-square" {...props} />,
  X: (props) => <svg data-testid="icon-x" {...props} />
}));

import NavigationBar from '../../src/renderer/components/NavigationBar';

describe('NavigationBar regression guards', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockState = {
      ui: {
        currentPhase: 'welcome',
        isOrganizing: false,
        isLoading: false
      },
      analysis: {
        isAnalyzing: false
      },
      system: {
        health: {
          llama: 'online',
          vectorDb: 'online'
        }
      }
    };

    window.electronAPI = {
      llama: {
        testConnection: jest.fn().mockResolvedValue({ status: 'healthy' })
      },
      vectorDb: {
        healthCheck: jest.fn().mockResolvedValue({ healthy: true })
      },
      window: {
        isMaximized: jest.fn().mockResolvedValue(false),
        minimize: jest.fn(),
        toggleMaximize: jest.fn().mockResolvedValue(false),
        close: jest.fn()
      }
    };
  });

  afterEach(() => {
    delete window.electronAPI;
  });

  test('keeps center nav in non-blocking layer and side controls above it', () => {
    const { container } = render(<NavigationBar />);

    const centerLayer = container.querySelector(
      '.absolute.inset-0.flex.items-center.justify-center.pointer-events-none'
    );
    expect(centerLayer).toBeInTheDocument();

    const rightControls = container.querySelector('.ml-auto.flex.items-center.gap-2.z-20');
    expect(rightControls).toBeInTheDocument();
  });

  test('allows phase navigation click dispatch when not blocked', async () => {
    render(<NavigationBar />);

    const setupTab = screen.getByRole('button', { name: /setup/i });
    fireEvent.click(setupTab);

    await waitFor(() => {
      expect(
        mockDispatch.mock.calls.some(
          ([action]) => action && action.type === 'ui/setPhase' && action.payload === 'setup'
        )
      ).toBe(true);
    });
  });
});
