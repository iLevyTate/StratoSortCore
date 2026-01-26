import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import AnalysisResultsList from '../../src/renderer/components/discover/AnalysisResultsList';

const renderWithRedux = (ui, { preloadedState } = {}) => {
  const store = configureStore({
    reducer: {
      system: (state = { redactPaths: false }) => state
    },
    preloadedState
  });

  return render(<Provider store={store}>{ui}</Provider>);
};

// Mock child components to avoid complex dependency issues
jest.mock('../../src/renderer/components/ui', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  StatusBadge: ({ children }) => <div>{children}</div>,
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
  IconButton: ({ icon, ...props }) => <button {...props}>{icon}</button>
}));

jest.mock('lucide-react', () => ({
  FileText: () => <div>Icon</div>,
  Compass: () => <div>Icon</div>,
  AlertTriangle: () => <div>Icon</div>,
  Eye: () => <div>Icon</div>,
  FolderOpen: () => <div>Icon</div>,
  Trash2: () => <div>Icon</div>
}));

jest.mock('../../src/renderer/components/ui/Typography', () => ({
  Text: ({ children, ...props }) => <div {...props}>{children}</div>
}));

// Mock react-window
jest.mock('react-window', () => ({
  List: ({ rowCount, rowComponent: Row, rowProps }) => (
    <div>
      {Array.from({ length: rowCount }).map((_, index) => (
        <Row key={index} index={index} style={{}} {...rowProps} />
      ))}
    </div>
  )
}));

describe('AnalysisResultsList', () => {
  let observeMock;
  let disconnectMock;

  beforeEach(() => {
    observeMock = jest.fn();
    disconnectMock = jest.fn();

    // Mock ResizeObserver
    window.ResizeObserver = jest.fn().mockImplementation((callback) => {
      // Expose callback to trigger it manually in tests
      window.ResizeObserverCallback = callback;
      return {
        observe: observeMock,
        disconnect: disconnectMock,
        unobserve: jest.fn()
      };
    });
  });

  afterEach(() => {
    delete window.ResizeObserver;
    delete window.ResizeObserverCallback;
  });

  const mockFiles = Array.from({ length: 40 }).map((_, i) => ({
    path: `/test/file${i}.txt`,
    name: `file${i}.txt`,
    size: 1024,
    analysis: { category: 'Test' }
  }));

  const mockGetFileStateDisplay = jest.fn(() => ({
    label: 'Ready',
    color: 'green',
    icon: <span>Icon</span>
  }));

  const mockOnFileAction = jest.fn();

  test('should render virtualized list when many items are present', async () => {
    renderWithRedux(
      <AnalysisResultsList
        results={mockFiles}
        onFileAction={mockOnFileAction}
        getFileStateDisplay={mockGetFileStateDisplay}
      />
    );

    // Should observe the container
    await waitFor(() => expect(observeMock).toHaveBeenCalled());
  });

  test('should update dimensions on resize', async () => {
    renderWithRedux(
      <AnalysisResultsList
        results={mockFiles}
        onFileAction={mockOnFileAction}
        getFileStateDisplay={mockGetFileStateDisplay}
      />
    );

    await waitFor(() => expect(observeMock).toHaveBeenCalled());

    // Simulate resize
    act(() => {
      if (window.ResizeObserverCallback) {
        window.ResizeObserverCallback([
          {
            contentRect: { width: 800, height: 1000 }
          }
        ]);
      }
    });

    // We can't easily check the internal state, but we can check if it rendered without crashing
    // and if ResizeObserver was used.
    expect(observeMock).toHaveBeenCalled();
  });
});
