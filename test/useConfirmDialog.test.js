/**
 * Tests for useConfirmDialog hook
 * Tests confirmation dialog state management
 */

import React from 'react';
import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock Modal component with testable buttons
jest.mock('../src/renderer/components/Modal', () => ({
  ConfirmModal: ({ isOpen, onConfirm, onClose, title, confirmText, cancelText, variant }) => {
    if (!isOpen) return null;
    return (
      <div data-testid="confirm-modal">
        <h2>{title}</h2>
        <span data-testid="variant">{variant}</span>
        <button data-testid="confirm-btn" onClick={onConfirm}>
          {confirmText}
        </button>
        <button data-testid="cancel-btn" onClick={onClose}>
          {cancelText}
        </button>
      </div>
    );
  }
}));

// Import after mocks
import { useConfirmDialog } from '../src/renderer/hooks/useConfirmDialog';

describe('useConfirmDialog', () => {
  test('returns showConfirm function and ConfirmDialog component', () => {
    const { result } = renderHook(() => useConfirmDialog());

    expect(typeof result.current.showConfirm).toBe('function');
    expect(typeof result.current.ConfirmDialog).toBe('function');
  });

  test('ConfirmDialog returns null when not open', () => {
    const { result } = renderHook(() => useConfirmDialog());

    const dialog = result.current.ConfirmDialog();

    expect(dialog).toBeNull();
  });

  test('showConfirm returns a promise', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    let confirmPromise;
    act(() => {
      confirmPromise = result.current.showConfirm({
        title: 'Test',
        message: 'Are you sure?'
      });
    });

    expect(confirmPromise).toBeInstanceOf(Promise);
  });

  test('showConfirm opens dialog', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.showConfirm({
        title: 'Delete File',
        message: 'Are you sure?'
      });
    });

    // Dialog component should not be null now
    const DialogComponent = result.current.ConfirmDialog;
    render(<DialogComponent />);

    expect(screen.getByTestId('confirm-modal')).toBeDefined();
  });

  test('resolves with true when confirmed', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    let confirmPromise;
    act(() => {
      confirmPromise = result.current.showConfirm({
        title: 'Test',
        message: 'Confirm?'
      });
    });

    // Render the dialog and click confirm
    const DialogComponent = result.current.ConfirmDialog;
    render(<DialogComponent />);

    act(() => {
      fireEvent.click(screen.getByTestId('confirm-btn'));
    });

    const confirmResult = await confirmPromise;
    expect(confirmResult).toBe(true);
  });

  test('resolves with false when cancelled', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    let confirmPromise;
    act(() => {
      confirmPromise = result.current.showConfirm({
        title: 'Test',
        message: 'Confirm?'
      });
    });

    // Render the dialog and click cancel
    const DialogComponent = result.current.ConfirmDialog;
    render(<DialogComponent />);

    act(() => {
      fireEvent.click(screen.getByTestId('cancel-btn'));
    });

    const confirmResult = await confirmPromise;
    expect(confirmResult).toBe(false);
  });

  test('uses default options', async () => {
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.showConfirm({
        message: 'Just a message'
      });
    });

    // Render the dialog
    const DialogComponent = result.current.ConfirmDialog;
    render(<DialogComponent />);

    expect(screen.getByText('Confirm Action')).toBeDefined();
    expect(screen.getByText('Confirm')).toBeDefined();
    expect(screen.getByText('Cancel')).toBeDefined();
    expect(screen.getByTestId('variant').textContent).toBe('default');
  });
});
