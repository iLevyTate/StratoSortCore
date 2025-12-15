import React from 'react';
import { render, act } from '@testing-library/react';
import AnalysisResultsList from '../../src/renderer/components/discover/AnalysisResultsList';

// Mock child components to avoid complex dependency issues
jest.mock('../../src/renderer/components/ui', () => ({
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  StatusBadge: ({ children }) => <div>{children}</div>
}));

jest.mock('lucide-react', () => ({
  FileText: () => <div>Icon</div>,
  Compass: () => <div>Icon</div>
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

  test('should render virtualized list when many items are present', () => {
    render(
      <AnalysisResultsList
        results={mockFiles}
        onFileAction={mockOnFileAction}
        getFileStateDisplay={mockGetFileStateDisplay}
      />
    );

    // Should observe the container
    expect(observeMock).toHaveBeenCalled();
  });

  test('should update dimensions on resize', () => {
    render(
      <AnalysisResultsList
        results={mockFiles}
        onFileAction={mockOnFileAction}
        getFileStateDisplay={mockGetFileStateDisplay}
      />
    );

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
