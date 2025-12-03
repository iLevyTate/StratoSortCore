/**
 * Tests for useDragAndDrop hook
 * Tests drag and drop file handling
 */

import { renderHook, act } from '@testing-library/react';
import { useDragAndDrop } from '../src/renderer/hooks/useDragAndDrop';

describe('useDragAndDrop', () => {
  let mockOnFilesDropped;

  beforeEach(() => {
    mockOnFilesDropped = jest.fn();
  });

  test('returns isDragging state and dragProps', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    expect(result.current.isDragging).toBe(false);
    expect(result.current.dragProps).toBeDefined();
    expect(typeof result.current.dragProps.onDragEnter).toBe('function');
    expect(typeof result.current.dragProps.onDragLeave).toBe('function');
    expect(typeof result.current.dragProps.onDragOver).toBe('function');
    expect(typeof result.current.dragProps.onDrop).toBe('function');
  });

  test('sets isDragging true on drag enter', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };

    act(() => {
      result.current.dragProps.onDragEnter(mockEvent);
    });

    expect(result.current.isDragging).toBe(true);
    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });

  test('sets isDragging false on drag leave when leaving container', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    // First enter
    act(() => {
      result.current.dragProps.onDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
    });

    expect(result.current.isDragging).toBe(true);

    // Then leave (relatedTarget is outside container)
    const mockLeaveEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      currentTarget: {
        contains: jest.fn().mockReturnValue(false),
      },
      relatedTarget: document.body,
    };

    act(() => {
      result.current.dragProps.onDragLeave(mockLeaveEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  test('keeps isDragging true when drag leave is within container', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    act(() => {
      result.current.dragProps.onDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
    });

    // Leave event where relatedTarget is inside container
    const childElement = document.createElement('div');
    const mockLeaveEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      currentTarget: {
        contains: jest.fn().mockReturnValue(true),
      },
      relatedTarget: childElement,
    };

    act(() => {
      result.current.dragProps.onDragLeave(mockLeaveEvent);
    });

    expect(result.current.isDragging).toBe(true);
  });

  test('prevents default on drag over', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
    };

    act(() => {
      result.current.dragProps.onDragOver(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockEvent.stopPropagation).toHaveBeenCalled();
  });

  test('handles drop with files', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockFiles = [
      { path: '/test/file1.pdf', name: 'file1.pdf', size: 1024 },
      { path: '/test/file2.pdf', name: 'file2.pdf', size: 2048 },
    ];

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        files: mockFiles,
      },
    };

    // Set dragging state first
    act(() => {
      result.current.dragProps.onDragEnter({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
      });
    });

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(result.current.isDragging).toBe(false);
    expect(mockOnFilesDropped).toHaveBeenCalledWith([
      { path: '/test/file1.pdf', name: 'file1.pdf', type: 'file', size: 1024 },
      { path: '/test/file2.pdf', name: 'file2.pdf', type: 'file', size: 2048 },
    ]);
  });

  test('uses name as path if path is not available', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockFiles = [{ name: 'file1.pdf', size: 1024 }];

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        files: mockFiles,
      },
    };

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(mockOnFilesDropped).toHaveBeenCalledWith([
      { path: 'file1.pdf', name: 'file1.pdf', type: 'file', size: 1024 },
    ]);
  });

  test('handles drop with no files', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        files: [],
      },
    };

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(mockOnFilesDropped).not.toHaveBeenCalled();
  });

  test('handles drop with null dataTransfer', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: null,
    };

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(mockOnFilesDropped).not.toHaveBeenCalled();
    expect(result.current.isDragging).toBe(false);
  });

  test('handles drop with undefined files in dataTransfer', () => {
    const { result } = renderHook(() => useDragAndDrop(mockOnFilesDropped));

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {},
    };

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(mockOnFilesDropped).not.toHaveBeenCalled();
  });

  test('works without onFilesDropped callback', () => {
    const { result } = renderHook(() => useDragAndDrop(null));

    const mockFiles = [{ name: 'file.pdf', size: 1024 }];

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        files: mockFiles,
      },
    };

    // Should not throw
    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(result.current.isDragging).toBe(false);
  });

  test('maintains stable function references', () => {
    const { result, rerender } = renderHook(() =>
      useDragAndDrop(mockOnFilesDropped),
    );

    const initialProps = result.current.dragProps;

    rerender();

    expect(result.current.dragProps.onDragEnter).toBe(initialProps.onDragEnter);
    expect(result.current.dragProps.onDragLeave).toBe(initialProps.onDragLeave);
    expect(result.current.dragProps.onDragOver).toBe(initialProps.onDragOver);
    expect(result.current.dragProps.onDrop).toBe(initialProps.onDrop);
  });

  test('updates callback when onFilesDropped changes', () => {
    const callback1 = jest.fn();
    const callback2 = jest.fn();

    const { result, rerender } = renderHook(
      ({ callback }) => useDragAndDrop(callback),
      { initialProps: { callback: callback1 } },
    );

    const mockDropEvent = {
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      dataTransfer: {
        files: [{ name: 'file.pdf', size: 1024 }],
      },
    };

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(callback1).toHaveBeenCalled();
    expect(callback2).not.toHaveBeenCalled();

    rerender({ callback: callback2 });

    act(() => {
      result.current.dragProps.onDrop(mockDropEvent);
    });

    expect(callback2).toHaveBeenCalled();
  });
});
