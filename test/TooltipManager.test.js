/**
 * Test file for TooltipManager component
 * Verifies that the null reference error fix works correctly
 */

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const React = require('react');
const { render, cleanup, fireEvent } = require('@testing-library/react');
const TooltipManager = require('../src/renderer/components/TooltipManager').default;

// Mock requestAnimationFrame and cancelAnimationFrame
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

describe('TooltipManager', () => {
  beforeEach(() => {
    // Clean up any previous test artifacts
    cleanup();
  });

  afterEach(() => {
    // Ensure cleanup after each test
    cleanup();
  });

  it('should handle rapid mount/unmount without throwing errors', async () => {
    // This test simulates the scenario where the component is rapidly mounted and unmounted
    // which was causing the null reference error

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    try {
      // Rapidly mount and unmount the component multiple times
      for (let i = 0; i < 5; i++) {
        const { unmount } = render(<TooltipManager />);

        // Simulate some mouse events before unmounting
        const testElement = document.createElement('div');
        testElement.setAttribute('title', 'Test tooltip');
        document.body.appendChild(testElement);

        // Fire mouseover event
        fireEvent.mouseOver(testElement);

        // Immediately unmount (simulating navigation or component change)
        unmount();

        // Try to fire more events after unmount (should not throw)
        fireEvent.mouseOut(testElement);
        fireEvent.focusIn(testElement);
        fireEvent.focusOut(testElement);

        // Clean up test element
        document.body.removeChild(testElement);
      }

      // Check that no errors were logged
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('should properly clean up refs on unmount', () => {
    const { unmount } = render(<TooltipManager />);

    // Create a test element with title
    const testElement = document.createElement('div');
    testElement.setAttribute('title', 'Test tooltip');
    document.body.appendChild(testElement);

    // Trigger tooltip show
    fireEvent.mouseOver(testElement);

    // Unmount the component
    unmount();

    // Verify that the tooltip DOM element is removed
    const tooltips = document.querySelectorAll('.tooltip-enhanced');
    expect(tooltips.length).toBe(0);

    // Clean up
    document.body.removeChild(testElement);
  });

  it('should handle null refs gracefully in event handlers', () => {
    const { unmount } = render(<TooltipManager />);

    // Create test element
    const testElement = document.createElement('div');
    testElement.setAttribute('title', 'Test tooltip');
    document.body.appendChild(testElement);

    // Start unmounting process
    unmount();

    // These events should not throw even with null refs
    expect(() => {
      fireEvent.mouseOver(testElement);
      fireEvent.mouseOut(testElement);
      fireEvent.focusIn(testElement);
      fireEvent.focusOut(testElement);
    }).not.toThrow();

    // Clean up
    if (testElement.parentNode) {
      document.body.removeChild(testElement);
    }
  });

  it('should handle visibility change events without errors', () => {
    const { unmount } = render(<TooltipManager />);
    expect(unmount).toBeDefined();

    // Simulate visibility change
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: true
    });

    // Fire visibility change event
    fireEvent(document, new Event('visibilitychange'));

    // Should not throw any errors
    unmount();

    // Reset document.hidden
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false
    });
  });
});
