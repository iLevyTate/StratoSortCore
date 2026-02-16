/**
 * Tests for useKeyboardShortcuts hook
 * Covers: undo/redo, settings toggle, escape, phase navigation, menu actions
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies before importing the hook
const mockDispatch = jest.fn();
const mockUndo = jest.fn().mockResolvedValue(undefined);
const mockRedo = jest.fn().mockResolvedValue(undefined);
const mockAddNotification = jest.fn();
let mockCurrentPhase = 'discover';
let mockShowSettings = false;
let mockCanUndo = true;
let mockCanRedo = true;

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }))
}));

jest.mock('../src/renderer/store/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: (selector) =>
    selector({
      ui: {
        currentPhase: mockCurrentPhase,
        showSettings: mockShowSettings
      }
    })
}));

jest.mock('../src/renderer/store/slices/uiSlice', () => ({
  toggleSettings: jest.fn(() => ({ type: 'ui/toggleSettings' })),
  setPhase: jest.fn((phase) => ({ type: 'ui/setPhase', payload: phase })),
  canTransitionTo: jest.fn(() => true)
}));

jest.mock('../src/renderer/contexts/NotificationContext', () => ({
  useNotification: () => ({ addNotification: mockAddNotification })
}));

jest.mock('../src/renderer/components/UndoRedoSystem', () => ({
  useUndoRedo: () => ({
    undo: mockUndo,
    redo: mockRedo,
    canUndo: mockCanUndo,
    canRedo: mockCanRedo
  })
}));

jest.mock('../src/shared/performanceConstants', () => ({
  TIMEOUTS: { WINDOW_LOAD_DELAY: 100 }
}));

jest.mock('../src/shared/constants', () => ({
  PHASES: {
    WELCOME: 'welcome',
    DISCOVER: 'discover',
    ORGANIZE: 'organize'
  },
  PHASE_TRANSITIONS: {
    welcome: ['discover'],
    discover: ['welcome', 'organize'],
    organize: ['discover']
  },
  PHASE_METADATA: {
    welcome: { title: 'Welcome' },
    discover: { title: 'Discover' },
    organize: { title: 'Organize' }
  }
}));

// Import after mocks
import { useKeyboardShortcuts } from '../src/renderer/hooks/useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  let keydownHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCurrentPhase = 'discover';
    mockShowSettings = false;
    mockCanUndo = true;
    mockCanRedo = true;

    // Capture the keydown handler registered on document
    jest.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'keydown') keydownHandler = handler;
    });
    jest.spyOn(document, 'removeEventListener').mockImplementation(() => {});

    global.window.electronAPI = {
      events: { onMenuAction: jest.fn() },
      undoRedo: { onStateChanged: jest.fn() }
    };
  });

  afterEach(() => {
    document.addEventListener.mockRestore?.();
    document.removeEventListener.mockRestore?.();
  });

  function renderShortcuts() {
    return renderHook(() => useKeyboardShortcuts());
  }

  function fireKey(key, modifiers = {}) {
    const event = {
      key,
      ctrlKey: modifiers.ctrl || false,
      metaKey: modifiers.meta || false,
      shiftKey: modifiers.shift || false,
      altKey: modifiers.alt || false,
      preventDefault: jest.fn()
    };
    if (keydownHandler) keydownHandler(event);
    return event;
  }

  describe('Ctrl+Z (Undo)', () => {
    test('calls undo action when canUndo is true', async () => {
      renderShortcuts();
      await act(async () => {
        fireKey('z', { ctrl: true });
      });
      expect(mockUndo).toHaveBeenCalled();
    });

    test('does not call undo when canUndo is false', async () => {
      mockCanUndo = false;
      renderShortcuts();
      await act(async () => {
        fireKey('z', { ctrl: true });
      });
      expect(mockUndo).not.toHaveBeenCalled();
    });

    test('prevents default on Ctrl+Z', async () => {
      renderShortcuts();
      let event;
      await act(async () => {
        event = fireKey('z', { ctrl: true });
      });
      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Ctrl+Shift+Z / Ctrl+Y (Redo)', () => {
    test('calls redo with Ctrl+Shift+Z', async () => {
      renderShortcuts();
      await act(async () => {
        fireKey('z', { ctrl: true, shift: true });
      });
      expect(mockRedo).toHaveBeenCalled();
    });

    test('calls redo with Ctrl+Y', async () => {
      renderShortcuts();
      await act(async () => {
        fireKey('y', { ctrl: true });
      });
      expect(mockRedo).toHaveBeenCalled();
    });

    test('does not call redo when canRedo is false', async () => {
      mockCanRedo = false;
      renderShortcuts();
      await act(async () => {
        fireKey('z', { ctrl: true, shift: true });
      });
      expect(mockRedo).not.toHaveBeenCalled();
    });
  });

  describe('Ctrl+, (Settings)', () => {
    test('toggles settings panel', () => {
      renderShortcuts();
      const event = fireKey(',', { ctrl: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'ui/toggleSettings' });
    });
  });

  describe('Escape (Close Settings)', () => {
    test('closes settings when settings are open', () => {
      mockShowSettings = true;
      renderShortcuts();
      fireKey('Escape');
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'ui/toggleSettings' });
    });

    test('does nothing when settings are closed', () => {
      mockShowSettings = false;
      renderShortcuts();
      fireKey('Escape');
      // toggleSettings should NOT be dispatched
      expect(mockDispatch).not.toHaveBeenCalledWith({ type: 'ui/toggleSettings' });
    });
  });

  describe('Alt+Arrow phase navigation', () => {
    test('Alt+ArrowRight advances to next phase', () => {
      mockCurrentPhase = 'discover';
      renderShortcuts();
      const event = fireKey('ArrowRight', { alt: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'ui/setPhase', payload: 'organize' });
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.stringContaining('Organize'),
        'info',
        2000
      );
    });

    test('Alt+ArrowLeft goes to previous phase', () => {
      mockCurrentPhase = 'discover';
      renderShortcuts();
      const event = fireKey('ArrowLeft', { alt: true });
      expect(event.preventDefault).toHaveBeenCalled();
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'ui/setPhase', payload: 'welcome' });
    });

    test('does not navigate past the last phase', () => {
      mockCurrentPhase = 'organize';
      renderShortcuts();
      fireKey('ArrowRight', { alt: true });
      // Should not dispatch setPhase since organize is the last phase
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ui/setPhase' })
      );
    });

    test('does not navigate before the first phase', () => {
      mockCurrentPhase = 'welcome';
      renderShortcuts();
      fireKey('ArrowLeft', { alt: true });
      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ui/setPhase' })
      );
    });
  });

  describe('cleanup', () => {
    test('removes keydown listener on unmount', () => {
      const { unmount } = renderShortcuts();
      unmount();
      expect(document.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });
});
