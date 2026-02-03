/**
 * Tests for EmptySearchState component
 * Tests the different empty states for search UI
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import EmptySearchState from '../src/renderer/components/search/EmptySearchState';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('EmptySearchState', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  describe('No files indexed state', () => {
    test('shows warning when hasIndexedFiles is false', () => {
      render(<EmptySearchState hasIndexedFiles={false} />);

      expect(screen.getByText('No files indexed yet')).toBeInTheDocument();
      expect(
        screen.getByText(/Add Smart Folders.*eligible for indexing.*rebuild embeddings/i)
      ).toBeInTheDocument();
    });

    test('does not show search tips when no files indexed', () => {
      render(<EmptySearchState hasIndexedFiles={false} />);

      expect(screen.queryByText('Search Tips')).not.toBeInTheDocument();
    });
  });

  describe('No query state (with indexed files)', () => {
    test('shows search tips when no query', () => {
      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.getByText('Search Tips')).toBeInTheDocument();
    });

    test('shows search tips when query is empty string', () => {
      render(<EmptySearchState query="" hasIndexedFiles={true} />);

      expect(screen.getByText('Search Tips')).toBeInTheDocument();
    });

    test('shows search tips when query is too short', () => {
      render(<EmptySearchState query="a" hasIndexedFiles={true} />);

      expect(screen.getByText('Search Tips')).toBeInTheDocument();
    });

    test('displays helpful tip about natural language', () => {
      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.getByText(/vacation photos from beach/i)).toBeInTheDocument();
    });

    test('displays tip about file type search', () => {
      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.getByText(/PDF documents/i)).toBeInTheDocument();
    });

    test('displays tip about content description', () => {
      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.getByText(/spreadsheet with budget/i)).toBeInTheDocument();
    });
  });

  describe('Recent searches', () => {
    test('shows recent searches when available', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['test query', 'another search']));

      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
      expect(screen.getByText('test query')).toBeInTheDocument();
      expect(screen.getByText('another search')).toBeInTheDocument();
    });

    test('clicking recent search triggers onSearchClick', () => {
      const mockOnSearchClick = jest.fn();
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['test query']));

      render(<EmptySearchState hasIndexedFiles={true} onSearchClick={mockOnSearchClick} />);

      fireEvent.click(screen.getByText('test query'));

      expect(mockOnSearchClick).toHaveBeenCalledWith('test query');
    });

    test('limits recent searches to 5', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify(['one', 'two', 'three', 'four', 'five', 'six', 'seven'])
      );

      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.getByText('one')).toBeInTheDocument();
      expect(screen.getByText('five')).toBeInTheDocument();
      expect(screen.queryByText('six')).not.toBeInTheDocument();
    });

    test('handles empty localStorage gracefully', () => {
      localStorageMock.getItem.mockReturnValue(null);

      render(<EmptySearchState hasIndexedFiles={true} />);

      expect(screen.queryByText('Recent Searches')).not.toBeInTheDocument();
    });

    test('handles malformed localStorage data', () => {
      localStorageMock.getItem.mockReturnValue('not valid json');

      // Should not throw
      expect(() => {
        render(<EmptySearchState hasIndexedFiles={true} />);
      }).not.toThrow();
    });

    test('handles localStorage access throwing (private mode / denied)', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('localStorage not available');
      });

      expect(() => {
        render(<EmptySearchState hasIndexedFiles={true} />);
      }).not.toThrow();
    });
  });

  describe('No results state', () => {
    test('shows no results message when query provided but no results', () => {
      render(<EmptySearchState query="nonexistent" hasIndexedFiles={true} />);

      expect(screen.getByText(/No results for/i)).toBeInTheDocument();
      expect(screen.getByText(/"nonexistent"/)).toBeInTheDocument();
    });

    test('shows suggestions when no results', () => {
      render(<EmptySearchState query="nonexistent" hasIndexedFiles={true} />);

      expect(screen.getByText('Try searching for')).toBeInTheDocument();
      expect(screen.getByText('documents')).toBeInTheDocument();
      expect(screen.getByText('images')).toBeInTheDocument();
    });

    test('clicking suggestion triggers onSearchClick', () => {
      const mockOnSearchClick = jest.fn();

      render(
        <EmptySearchState
          query="nonexistent"
          hasIndexedFiles={true}
          onSearchClick={mockOnSearchClick}
        />
      );

      fireEvent.click(screen.getByText('documents'));

      expect(mockOnSearchClick).toHaveBeenCalledWith('documents');
    });

    test('shows alternative keywords hint', () => {
      render(<EmptySearchState query="test" hasIndexedFiles={true} />);

      expect(screen.getByText(/Try different keywords/i)).toBeInTheDocument();
    });
  });

  describe('Remove recent search', () => {
    test('can remove a recent search', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['test query', 'another search']));

      render(<EmptySearchState hasIndexedFiles={true} />);

      // Find the remove button (X icon) for 'test query'
      const removeButtons = screen.getAllByLabelText('Remove from history');
      expect(removeButtons.length).toBeGreaterThan(0);

      fireEvent.click(removeButtons[0]);

      // localStorage should be updated
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe('className prop', () => {
    test('applies custom className', () => {
      const { container } = render(
        <EmptySearchState hasIndexedFiles={false} className="custom-class" />
      );

      expect(container.firstChild).toHaveClass('custom-class');
    });
  });
});
