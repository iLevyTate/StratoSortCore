import { renderHook, act } from '@testing-library/react';
import { useGraphKeyboardNav } from '../src/renderer/hooks/useGraphKeyboardNav';

describe('useGraphKeyboardNav', () => {
  test('ArrowRight selects connected node and centers view', () => {
    const onSelectNode = jest.fn();
    const reactFlowInstance = {
      current: {
        setCenter: jest.fn(),
        getZoom: jest.fn(() => 1)
      }
    };

    const nodes = [
      { id: 'a', position: { x: 10, y: 20 } },
      { id: 'b', position: { x: 100, y: 200 } }
    ];
    const edges = [{ source: 'a', target: 'b' }];

    renderHook(() =>
      useGraphKeyboardNav({
        nodes,
        edges,
        selectedNodeId: 'a',
        onSelectNode,
        reactFlowInstance,
        enabled: true
      })
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(onSelectNode).toHaveBeenCalledWith('b');
    expect(reactFlowInstance.current.setCenter).toHaveBeenCalledWith(190, 230, {
      duration: 300,
      zoom: 1
    });
  });

  test('Enter opens selected file node', () => {
    const onOpenFile = jest.fn();
    const nodes = [
      { id: 'a', data: { kind: 'file', path: 'C:/file.txt' } },
      { id: 'b', data: { kind: 'folder' } }
    ];

    renderHook(() =>
      useGraphKeyboardNav({
        nodes,
        selectedNodeId: 'a',
        onOpenFile,
        enabled: true
      })
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    });

    expect(onOpenFile).toHaveBeenCalledWith('C:/file.txt');
  });

  test('Escape clears selection', () => {
    const onSelectNode = jest.fn();

    renderHook(() =>
      useGraphKeyboardNav({
        nodes: [{ id: 'a' }],
        selectedNodeId: 'a',
        onSelectNode,
        enabled: true
      })
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onSelectNode).toHaveBeenCalledWith(null);
  });

  test('Space triggers cluster toggle event', () => {
    const dispatchSpy = jest.spyOn(window, 'dispatchEvent');

    renderHook(() =>
      useGraphKeyboardNav({
        nodes: [{ id: 'cluster-1', type: 'clusterNode' }],
        selectedNodeId: 'cluster-1',
        enabled: true
      })
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    });

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'graph:toggleCluster',
        detail: { nodeId: 'cluster-1' }
      })
    );
    dispatchSpy.mockRestore();
  });
});
