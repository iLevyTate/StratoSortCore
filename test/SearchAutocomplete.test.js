/**
 * Tests for SearchAutocomplete component
 * Tests search suggestions, keyboard navigation, recent searches, and score display
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SearchAutocomplete, {
  addToRecentSearches,
  clearRecentSearches
} from '../src/renderer/components/search/SearchAutocomplete';

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

// Mock scrollIntoView which isn't available in jsdom
Element.prototype.scrollIntoView = jest.fn();

// Mock electronAPI
const mockSearch = jest.fn();
window.electronAPI = {
  embeddings: {
    search: mockSearch
  }
};

describe('SearchAutocomplete', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Basic rendering', () => {
    test('renders input with placeholder', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} placeholder="Search files..." />);

      expect(screen.getByPlaceholderText('Search files...')).toBeInTheDocument();
    });

    test('renders with custom aria-label', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} ariaLabel="File search" />);

      expect(screen.getByLabelText('File search')).toBeInTheDocument();
    });

    test('renders in disabled state', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} disabled />);

      // Input has role="combobox" for autocomplete functionality
      expect(screen.getByRole('combobox')).toBeDisabled();
    });

    test('renders with search icon', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} />);

      // Search icon should be present (Lucide renders as svg)
      const container = screen.getByRole('combobox').closest('div');
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('Input handling', () => {
    test('calls onChange when typing', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} />);

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'test' } });

      expect(onChange).toHaveBeenCalledWith('test');
    });

    test('calls onSearch when pressing Enter', () => {
      const onChange = jest.fn();
      const onSearch = jest.fn();
      render(<SearchAutocomplete value="test query" onChange={onChange} onSearch={onSearch} />);

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

      expect(onSearch).toHaveBeenCalledWith('test query');
    });

    test('calls onSearch even with short query (component allows any length)', () => {
      // Note: The component allows onSearch to be called with any query length
      // The handler should validate the query length if needed
      const onChange = jest.fn();
      const onSearch = jest.fn();
      render(<SearchAutocomplete value="a" onChange={onChange} onSearch={onSearch} />);

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

      // Component calls onSearch regardless of query length
      expect(onSearch).toHaveBeenCalledWith('a');
    });
  });

  describe('File suggestions with debouncing', () => {
    test('fetches suggestions after debounce delay', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: [
          {
            id: 'file1',
            metadata: { name: 'document.pdf', path: '/path/to/document.pdf' },
            score: 0.95
          }
        ]
      });

      const onChange = jest.fn();
      render(<SearchAutocomplete value="doc" onChange={onChange} />);

      // Wait for debounce (200ms)
      act(() => {
        jest.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalledWith('doc', { topK: 5, mode: 'hybrid' });
      });
    });

    test('does not fetch suggestions for short queries', async () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="a" onChange={onChange} />);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      expect(mockSearch).not.toHaveBeenCalled();
    });

    test('cancels previous fetch when query changes', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: []
      });

      const onChange = jest.fn();
      const { rerender } = render(<SearchAutocomplete value="doc" onChange={onChange} />);

      // Start first debounce
      act(() => {
        jest.advanceTimersByTime(100);
      });

      // Change query before debounce completes
      rerender(<SearchAutocomplete value="document" onChange={onChange} />);

      // Complete debounce for new query
      act(() => {
        jest.advanceTimersByTime(200);
      });

      await waitFor(() => {
        // Should only search with the final query
        expect(mockSearch).toHaveBeenCalledWith('document', expect.any(Object));
      });
    });
  });

  describe('Keyboard navigation', () => {
    test('handles arrow key navigation without crashing', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: [
          { id: 'file1', metadata: { name: 'doc1.pdf' }, score: 0.9 },
          { id: 'file2', metadata: { name: 'doc2.pdf' }, score: 0.8 }
        ]
      });

      const onChange = jest.fn();
      render(<SearchAutocomplete value="doc" onChange={onChange} />);

      // Wait for suggestions
      act(() => {
        jest.advanceTimersByTime(200);
      });

      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalled();
      });

      // Focus input and navigate - should not throw
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      // Component should still be functional
      expect(input).toBeInTheDocument();
    });

    test('closes suggestions with Escape', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: [{ id: 'file1', metadata: { name: 'doc1.pdf' }, score: 0.9 }]
      });

      const onChange = jest.fn();
      render(<SearchAutocomplete value="doc" onChange={onChange} />);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      // Wait for suggestions to appear
      await waitFor(() => {
        expect(mockSearch).toHaveBeenCalled();
      });

      // Press Escape
      fireEvent.keyDown(input, { key: 'Escape' });

      // Dropdown should close
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('Recent searches', () => {
    test('shows recent searches when focused with no query', () => {
      localStorageMock.getItem.mockReturnValue(
        JSON.stringify(['previous search', 'another query'])
      );

      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} />);

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByText('previous search')).toBeInTheDocument();
      expect(screen.getByText('another query')).toBeInTheDocument();
    });

    test('clicking recent search fills input', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['old search']));

      const onChange = jest.fn();
      const onSearch = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} onSearch={onSearch} />);

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      fireEvent.click(screen.getByText('old search'));

      expect(onChange).toHaveBeenCalledWith('old search');
    });

    test('removes recent search when clicking X', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['to remove', 'to keep']));

      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} />);

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      // Click the remove button for 'to remove'
      const removeButton = screen.getAllByLabelText('Remove from history')[0];
      fireEvent.click(removeButton);

      // Should save updated list without 'to remove'
      expect(localStorageMock.setItem).toHaveBeenCalled();
    });
  });

  describe('Score display', () => {
    test('displays score as percentage for file suggestions', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: [{ id: 'file1', metadata: { name: 'doc.pdf' }, score: 0.95 }]
      });

      const onChange = jest.fn();
      render(<SearchAutocomplete value="doc" onChange={onChange} />);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      await waitFor(() => {
        expect(screen.getByText('95%')).toBeInTheDocument();
      });
    });

    test('clamps score to 0-1 range (score > 1)', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: [{ id: 'file1', metadata: { name: 'doc.pdf' }, score: 1.5 }]
      });

      const onChange = jest.fn();
      render(<SearchAutocomplete value="doc" onChange={onChange} />);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      await waitFor(() => {
        // Score 1.5 should be clamped to 1.0 = 100%
        expect(screen.getByText('100%')).toBeInTheDocument();
      });
    });

    test('clamps score to 0-1 range (negative score)', async () => {
      mockSearch.mockResolvedValue({
        success: true,
        results: [{ id: 'file1', metadata: { name: 'doc.pdf' }, score: -0.5 }]
      });

      const onChange = jest.fn();
      render(<SearchAutocomplete value="doc" onChange={onChange} />);

      act(() => {
        jest.advanceTimersByTime(200);
      });

      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      await waitFor(() => {
        // Score -0.5 should be clamped to 0 = 0%
        expect(screen.getByText('0%')).toBeInTheDocument();
      });
    });
  });

  describe('Utility functions', () => {
    test('addToRecentSearches adds query to storage', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['existing']));

      addToRecentSearches('new search');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'stratosort-recent-searches',
        expect.stringContaining('new search')
      );
    });

    test('addToRecentSearches ignores short queries', () => {
      addToRecentSearches('a');

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    test('addToRecentSearches moves duplicate to front', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['first', 'duplicate', 'last']));

      addToRecentSearches('duplicate');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'stratosort-recent-searches',
        JSON.stringify(['duplicate', 'first', 'last'])
      );
    });

    test('clearRecentSearches removes storage', () => {
      clearRecentSearches();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('stratosort-recent-searches');
    });
  });

  describe('Click outside behavior', () => {
    test('closes suggestions when clicking outside', () => {
      localStorageMock.getItem.mockReturnValue(JSON.stringify(['recent search']));

      const onChange = jest.fn();
      render(
        <div>
          <SearchAutocomplete value="" onChange={onChange} />
          <button data-testid="outside">Outside</button>
        </div>
      );

      // Focus to show suggestions
      const input = screen.getByRole('combobox');
      fireEvent.focus(input);

      expect(screen.getByText('recent search')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(screen.getByTestId('outside'));

      expect(screen.queryByText('recent search')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    test('has proper ARIA attributes', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="test" onChange={onChange} ariaLabel="File search" />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-label', 'File search');
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
    });

    test('shows keyboard shortcut hint', () => {
      const onChange = jest.fn();
      render(<SearchAutocomplete value="" onChange={onChange} />);

      // Should show keyboard shortcut hint (Ctrl/Cmd + K)
      expect(screen.getByText(/⌘K|Ctrl\+K/)).toBeInTheDocument();
    });
  });
});
