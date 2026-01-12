/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GraphTour from '../../src/renderer/components/search/GraphTour';

// Mock localStorage
const localStorageMock = {
  _store: {},
  getItem: jest.fn((key) => localStorageMock._store[key] || null),
  setItem: jest.fn((key, value) => {
    localStorageMock._store[key] = value;
  }),
  clear: function () {
    this._store = {};
  }
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('GraphTour', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    localStorageMock.clear();
    // Use mockReset to clear both call history AND mock implementation
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();
    // Restore the default implementation
    localStorageMock.getItem.mockImplementation((key) => localStorageMock._store[key] || null);
    localStorageMock.setItem.mockImplementation((key, value) => {
      localStorageMock._store[key] = value;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initial render', () => {
    it('should not render when isOpen is false', () => {
      render(<GraphTour isOpen={false} />);
      expect(screen.queryByText('Search for files')).not.toBeInTheDocument();
    });

    it('should show tour after delay when not seen before', () => {
      render(<GraphTour isOpen={true} />);

      // Tour should not be visible immediately
      expect(screen.queryByText('Search for files')).not.toBeInTheDocument();

      // Advance timers for the 500ms delay (wrapped in act)
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Tour should now be visible
      expect(screen.getByText('Search for files')).toBeInTheDocument();
    });

    it('should not show tour if already dismissed', () => {
      localStorageMock.getItem.mockReturnValue('true');

      render(<GraphTour isOpen={true} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.queryByText('Search for files')).not.toBeInTheDocument();
    });
  });

  describe('navigation', () => {
    const renderAndShow = () => {
      render(<GraphTour isOpen={true} />);
      act(() => {
        jest.advanceTimersByTime(500);
      });
    };

    it('should show first step initially', () => {
      renderAndShow();
      expect(screen.getByText('Search for files')).toBeInTheDocument();
      expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    });

    it('should navigate to next step when clicking Next', () => {
      renderAndShow();
      expect(screen.getByText('Search for files')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Next'));

      expect(screen.getByText('Explore clusters')).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
    });

    it('should navigate back when clicking Back', () => {
      renderAndShow();
      expect(screen.getByText('Search for files')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Next'));

      expect(screen.getByText('Explore clusters')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Back'));

      expect(screen.getByText('Search for files')).toBeInTheDocument();
    });

    it('should show Get Started button on last step', () => {
      renderAndShow();
      expect(screen.getByText('Search for files')).toBeInTheDocument();

      // Navigate to last step
      fireEvent.click(screen.getByText('Next'));
      fireEvent.click(screen.getByText('Next'));

      expect(screen.getByText('Navigate the graph')).toBeInTheDocument();
      expect(screen.getByText('Get Started')).toBeInTheDocument();
    });
  });

  describe('completion', () => {
    it('should save to localStorage when completed', () => {
      render(<GraphTour isOpen={true} />);
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Search for files')).toBeInTheDocument();

      // Navigate through all steps
      fireEvent.click(screen.getByText('Next'));
      fireEvent.click(screen.getByText('Next'));
      fireEvent.click(screen.getByText('Get Started'));

      expect(localStorageMock.setItem).toHaveBeenCalledWith('graphTourDismissed', 'true');
    });

    it('should call onComplete callback when completed', () => {
      const onComplete = jest.fn();
      render(<GraphTour isOpen={true} onComplete={onComplete} />);
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Search for files')).toBeInTheDocument();

      // Navigate through all steps
      fireEvent.click(screen.getByText('Next'));
      fireEvent.click(screen.getByText('Next'));
      fireEvent.click(screen.getByText('Get Started'));

      expect(onComplete).toHaveBeenCalled();
    });

    it('should save to localStorage when closed with checkbox checked', () => {
      render(<GraphTour isOpen={true} />);
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Search for files')).toBeInTheDocument();

      // The checkbox is checked by default, so clicking Close should persist
      fireEvent.click(screen.getByText('Close'));

      expect(localStorageMock.setItem).toHaveBeenCalledWith('graphTourDismissed', 'true');
    });

    it('should not save to localStorage when closed with checkbox unchecked', () => {
      render(<GraphTour isOpen={true} />);
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Search for files')).toBeInTheDocument();

      // Uncheck the "Don't show again" checkbox
      const checkbox = screen.getByRole('checkbox');
      fireEvent.click(checkbox);

      // Now close - should NOT save to localStorage
      fireEvent.click(screen.getByText('Close'));

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
  });

  describe('step indicators', () => {
    it('should navigate when clicking step dots', () => {
      render(<GraphTour isOpen={true} />);
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(screen.getByText('Search for files')).toBeInTheDocument();

      // Click the third step indicator
      const stepButtons = screen.getAllByRole('button', { name: /Go to step/i });
      fireEvent.click(stepButtons[2]); // 0-indexed

      expect(screen.getByText('Navigate the graph')).toBeInTheDocument();
    });
  });
});
