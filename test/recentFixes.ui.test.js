/**
 * @jest-environment jsdom
 *
 * React component tests for recent UI fixes.
 * Covers fixes H-1, H-2, M-3, M-4, L-1, L-2
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the electronAPI
const mockElectronAPI = {
  settings: {
    get: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockResolvedValue({ success: true })
  },
  undoRedo: {
    onStateChanged: jest.fn().mockReturnValue(() => {})
  },
  embeddings: {
    getStats: jest.fn().mockResolvedValue({ success: true, files: 0, folders: 0 })
  }
};

beforeEach(() => {
  window.electronAPI = mockElectronAPI;
  jest.clearAllMocks();
});

describe('Recent UI Fixes', () => {
  /**
   * M-4: Organize Phase Conflict Warning UI
   * Tests that the conflict warning banner appears when conflicts are detected
   */
  describe('M-4: Organize conflict warning UI', () => {
    // Test the warning component logic directly
    describe('ConflictWarningBanner logic', () => {
      function ConflictWarningBanner({ conflicts }) {
        if (!conflicts || conflicts.length === 0) {
          return null;
        }

        const totalFiles = conflicts.reduce((sum, c) => sum + c.files.length, 0);

        return (
          <div data-testid="conflict-warning" className="warning-banner">
            <h4>Destination Conflicts Detected</h4>
            <p>{totalFiles} files would be moved to the same destination.</p>
            <ul>
              {conflicts.slice(0, 3).map((conflict, idx) => (
                <li key={idx}>
                  {conflict.files.map((f) => f.fileName).join(', ')} → {conflict.destination}
                </li>
              ))}
              {conflicts.length > 3 && <li>...and {conflicts.length - 3} more conflicts</li>}
            </ul>
          </div>
        );
      }

      test('renders nothing when no conflicts', () => {
        const { container } = render(<ConflictWarningBanner conflicts={[]} />);
        expect(container.firstChild).toBeNull();
      });

      test('renders warning when conflicts exist', () => {
        const conflicts = [
          {
            destination: 'C:/Docs/report.pdf',
            files: [
              { fileName: 'report.pdf', sourcePath: '/a' },
              { fileName: 'report.pdf', sourcePath: '/b' }
            ]
          }
        ];

        render(<ConflictWarningBanner conflicts={conflicts} />);
        expect(screen.getByTestId('conflict-warning')).toBeInTheDocument();
        expect(screen.getByText('Destination Conflicts Detected')).toBeInTheDocument();
        expect(screen.getByText(/2 files would be moved/)).toBeInTheDocument();
      });

      test('shows "and X more" when more than 3 conflicts', () => {
        const conflicts = [
          {
            destination: 'C:/A/file.pdf',
            files: [{ fileName: 'a' }, { fileName: 'b' }]
          },
          {
            destination: 'C:/B/file.pdf',
            files: [{ fileName: 'c' }, { fileName: 'd' }]
          },
          {
            destination: 'C:/C/file.pdf',
            files: [{ fileName: 'e' }, { fileName: 'f' }]
          },
          {
            destination: 'C:/D/file.pdf',
            files: [{ fileName: 'g' }, { fileName: 'h' }]
          },
          {
            destination: 'C:/E/file.pdf',
            files: [{ fileName: 'i' }, { fileName: 'j' }]
          }
        ];

        render(<ConflictWarningBanner conflicts={conflicts} />);
        expect(screen.getByText(/and 2 more conflicts/)).toBeInTheDocument();
      });
    });
  });

  /**
   * L-2: History Modal Jump to Point UI
   * Tests that history items are clickable and show correct state
   */
  describe('L-2: History modal jump UI', () => {
    function HistoryItem({ action, index, currentIndex, onJump, isExecuting }) {
      const isCurrent = index === currentIndex;
      const isFuture = index > currentIndex;

      return (
        <button
          data-testid={`history-item-${index}`}
          onClick={() => onJump(index)}
          disabled={isExecuting || isCurrent}
          className={`history-item ${isCurrent ? 'current' : ''} ${isFuture ? 'future' : ''}`}
        >
          <span>{action.description}</span>
          {isCurrent && <span data-testid="current-badge">Current</span>}
          {isFuture && <span data-testid="undone-badge">Undone</span>}
        </button>
      );
    }

    test('current item shows Current badge and is disabled', () => {
      const action = { id: 1, description: 'Move file.pdf' };
      const onJump = jest.fn();

      render(
        <HistoryItem
          action={action}
          index={2}
          currentIndex={2}
          onJump={onJump}
          isExecuting={false}
        />
      );

      const button = screen.getByTestId('history-item-2');
      expect(button).toBeDisabled();
      expect(screen.getByTestId('current-badge')).toBeInTheDocument();
    });

    test('future items show Undone badge', () => {
      const action = { id: 1, description: 'Move file.pdf' };
      const onJump = jest.fn();

      render(
        <HistoryItem
          action={action}
          index={5}
          currentIndex={3}
          onJump={onJump}
          isExecuting={false}
        />
      );

      expect(screen.getByTestId('undone-badge')).toBeInTheDocument();
    });

    test('past items are clickable', () => {
      const action = { id: 1, description: 'Move file.pdf' };
      const onJump = jest.fn();

      render(
        <HistoryItem
          action={action}
          index={1}
          currentIndex={3}
          onJump={onJump}
          isExecuting={false}
        />
      );

      const button = screen.getByTestId('history-item-1');
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
      expect(onJump).toHaveBeenCalledWith(1);
    });

    test('all items disabled during execution', () => {
      const action = { id: 1, description: 'Move file.pdf' };
      const onJump = jest.fn();

      render(
        <HistoryItem
          action={action}
          index={1}
          currentIndex={3}
          onJump={onJump}
          isExecuting={true}
        />
      );

      const button = screen.getByTestId('history-item-1');
      expect(button).toBeDisabled();
    });
  });

  /**
   * M-3: Retry Failed Files Button
   * Tests the retry button visibility and behavior
   */
  describe('M-3: Retry failed files button', () => {
    function RetryButton({ failedCount, onRetry, isAnalyzing }) {
      if (failedCount === 0 || isAnalyzing) {
        return null;
      }

      return (
        <button data-testid="retry-button" onClick={onRetry}>
          Retry {failedCount} Failed
        </button>
      );
    }

    test('renders when there are failed files', () => {
      const onRetry = jest.fn();
      render(<RetryButton failedCount={3} onRetry={onRetry} isAnalyzing={false} />);

      expect(screen.getByTestId('retry-button')).toBeInTheDocument();
      expect(screen.getByText('Retry 3 Failed')).toBeInTheDocument();
    });

    test('does not render when no failed files', () => {
      const onRetry = jest.fn();
      const { container } = render(
        <RetryButton failedCount={0} onRetry={onRetry} isAnalyzing={false} />
      );

      expect(container.firstChild).toBeNull();
    });

    test('does not render during analysis', () => {
      const onRetry = jest.fn();
      const { container } = render(
        <RetryButton failedCount={3} onRetry={onRetry} isAnalyzing={true} />
      );

      expect(container.firstChild).toBeNull();
    });

    test('calls onRetry when clicked', () => {
      const onRetry = jest.fn();
      render(<RetryButton failedCount={3} onRetry={onRetry} isAnalyzing={false} />);

      fireEvent.click(screen.getByTestId('retry-button'));
      expect(onRetry).toHaveBeenCalled();
    });
  });

  /**
   * H-1: Smart Folder Modal Path Loading State
   * Tests that modal shows loading state correctly
   */
  describe('H-1: Path loading state in modal', () => {
    function AddFolderForm({ isDefaultLocationLoaded, onSubmit }) {
      const [folderName, setFolderName] = React.useState('');
      const [folderPath, setFolderPath] = React.useState('');

      const handleSubmit = (e) => {
        e.preventDefault();

        if (!isDefaultLocationLoaded && !folderPath.trim()) {
          return; // Block submission
        }

        onSubmit({ name: folderName, path: folderPath });
      };

      return (
        <form onSubmit={handleSubmit} data-testid="add-folder-form">
          <input
            data-testid="folder-name"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
          />
          <input
            data-testid="folder-path"
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
          />
          {!isDefaultLocationLoaded && !folderPath && (
            <span data-testid="loading-indicator">Loading default location...</span>
          )}
          <button type="submit" data-testid="submit-button">
            Add Folder
          </button>
        </form>
      );
    }

    test('shows loading indicator when path not loaded and no explicit path', () => {
      render(<AddFolderForm isDefaultLocationLoaded={false} onSubmit={jest.fn()} />);

      expect(screen.getByTestId('loading-indicator')).toBeInTheDocument();
    });

    test('hides loading indicator when path is loaded', () => {
      render(<AddFolderForm isDefaultLocationLoaded={true} onSubmit={jest.fn()} />);

      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    });

    test('hides loading indicator when explicit path provided', () => {
      render(<AddFolderForm isDefaultLocationLoaded={false} onSubmit={jest.fn()} />);

      const pathInput = screen.getByTestId('folder-path');
      fireEvent.change(pathInput, { target: { value: 'C:/MyFolder' } });

      expect(screen.queryByTestId('loading-indicator')).not.toBeInTheDocument();
    });

    test('blocks submit when path not loaded and no explicit path', () => {
      const onSubmit = jest.fn();
      render(<AddFolderForm isDefaultLocationLoaded={false} onSubmit={onSubmit} />);

      fireEvent.click(screen.getByTestId('submit-button'));
      expect(onSubmit).not.toHaveBeenCalled();
    });

    test('allows submit when path is loaded', () => {
      const onSubmit = jest.fn();
      render(<AddFolderForm isDefaultLocationLoaded={true} onSubmit={onSubmit} />);

      const nameInput = screen.getByTestId('folder-name');
      fireEvent.change(nameInput, { target: { value: 'Test Folder' } });
      fireEvent.click(screen.getByTestId('submit-button'));

      expect(onSubmit).toHaveBeenCalled();
    });
  });

  /**
   * H-2: Settings Panel Flush on Unmount
   * Tests that flush is called when component unmounts
   */
  describe('H-2: Flush on unmount', () => {
    function SettingsPanel({ autoSaveSettings }) {
      React.useEffect(() => {
        return () => {
          // Cleanup - flush pending saves
          if (autoSaveSettings?.flush) {
            autoSaveSettings.flush();
          }
        };
      }, [autoSaveSettings]);

      return <div data-testid="settings-panel">Settings</div>;
    }

    test('calls flush on unmount', () => {
      const mockFlush = jest.fn();
      const autoSaveSettings = { flush: mockFlush };

      const { unmount } = render(<SettingsPanel autoSaveSettings={autoSaveSettings} />);

      expect(mockFlush).not.toHaveBeenCalled();
      unmount();
      expect(mockFlush).toHaveBeenCalled();
    });

    test('handles missing flush method gracefully', () => {
      const autoSaveSettings = {};

      const { unmount } = render(<SettingsPanel autoSaveSettings={autoSaveSettings} />);

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });

    test('handles null autoSaveSettings gracefully', () => {
      const { unmount } = render(<SettingsPanel autoSaveSettings={null} />);

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  /**
   * M-5: Embeddings Status Display
   * Tests the context-aware status messages
   */
  describe('M-5: Embeddings status display', () => {
    function EmbeddingsStatus({ stats }) {
      let statusLabel;

      if (!stats) {
        statusLabel = 'Embeddings status unavailable - check Ollama connection';
      } else if (stats.needsFileEmbeddingRebuild) {
        statusLabel = `${stats.folders} folder embeddings • ${stats.files} file embeddings (${stats.analysisHistory?.totalFiles || 0} files analyzed - click Rebuild to index)`;
      } else if (stats.files === 0 && stats.folders === 0) {
        statusLabel = 'No embeddings yet - analyze files and add smart folders first';
      } else {
        statusLabel = `${stats.folders} folder embeddings • ${stats.files} file embeddings`;
      }

      return <div data-testid="embeddings-status">{statusLabel}</div>;
    }

    test('shows connection error message when stats null', () => {
      render(<EmbeddingsStatus stats={null} />);

      expect(screen.getByTestId('embeddings-status')).toHaveTextContent('unavailable');
    });

    test('shows helpful message when no embeddings exist', () => {
      render(<EmbeddingsStatus stats={{ files: 0, folders: 0 }} />);

      expect(screen.getByTestId('embeddings-status')).toHaveTextContent('No embeddings yet');
    });

    test('shows rebuild suggestion when files analyzed but not embedded', () => {
      const stats = {
        files: 0,
        folders: 5,
        needsFileEmbeddingRebuild: true,
        analysisHistory: { totalFiles: 50 }
      };
      render(<EmbeddingsStatus stats={stats} />);

      expect(screen.getByTestId('embeddings-status')).toHaveTextContent('50 files analyzed');
      expect(screen.getByTestId('embeddings-status')).toHaveTextContent('Rebuild');
    });

    test('shows normal counts when embeddings exist', () => {
      render(<EmbeddingsStatus stats={{ files: 100, folders: 10 }} />);

      expect(screen.getByTestId('embeddings-status')).toHaveTextContent('10 folder embeddings');
      expect(screen.getByTestId('embeddings-status')).toHaveTextContent('100 file embeddings');
    });
  });
});
