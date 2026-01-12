/**
 * @jest-environment jsdom
 */

import { renderHook, act } from '@testing-library/react';
import { useGraphState } from '../../src/renderer/hooks/useGraphState';

// Mock reactflow's applyNodeChanges and applyEdgeChanges
jest.mock('reactflow', () => ({
  applyNodeChanges: jest.fn((changes, nodes) => {
    // Simple mock: apply position changes
    return nodes
      .map((node) => {
        const change = changes.find((c) => c.id === node.id);
        if (change?.type === 'position' && change.position) {
          return { ...node, position: change.position };
        }
        if (change?.type === 'remove') {
          return null;
        }
        return node;
      })
      .filter(Boolean);
  }),
  applyEdgeChanges: jest.fn((changes, edges) => {
    // Simple mock: filter out removed edges
    const removeIds = changes.filter((c) => c.type === 'remove').map((c) => c.id);
    return edges.filter((edge) => !removeIds.includes(edge.id));
  })
}));

describe('useGraphState', () => {
  describe('initial state', () => {
    it('should initialize with empty nodes', () => {
      const { result } = renderHook(() => useGraphState());
      expect(result.current.nodes).toEqual([]);
    });

    it('should initialize with empty edges', () => {
      const { result } = renderHook(() => useGraphState());
      expect(result.current.edges).toEqual([]);
    });

    it('should initialize with null selectedNodeId', () => {
      const { result } = renderHook(() => useGraphState());
      expect(result.current.selectedNodeId).toBeNull();
    });

    it('should provide stable action references', () => {
      const { result, rerender } = renderHook(() => useGraphState());
      const firstActions = result.current.actions;

      rerender();

      expect(result.current.actions).toBe(firstActions);
    });
  });

  describe('setNodes', () => {
    it('should set nodes with array value', () => {
      const { result } = renderHook(() => useGraphState());
      const testNodes = [
        { id: 'node1', position: { x: 0, y: 0 } },
        { id: 'node2', position: { x: 100, y: 100 } }
      ];

      act(() => {
        result.current.actions.setNodes(testNodes);
      });

      expect(result.current.nodes).toEqual(testNodes);
    });

    it('should set nodes with updater function', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.setNodes([{ id: 'node1', position: { x: 0, y: 0 } }]);
      });

      act(() => {
        result.current.actions.setNodes((prev) => [
          ...prev,
          { id: 'node2', position: { x: 100, y: 100 } }
        ]);
      });

      expect(result.current.nodes).toHaveLength(2);
      expect(result.current.nodes[1].id).toBe('node2');
    });
  });

  describe('setEdges', () => {
    it('should set edges with array value', () => {
      const { result } = renderHook(() => useGraphState());
      const testEdges = [{ id: 'edge1', source: 'node1', target: 'node2' }];

      act(() => {
        result.current.actions.setEdges(testEdges);
      });

      expect(result.current.edges).toEqual(testEdges);
    });

    it('should set edges with updater function', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.setEdges([{ id: 'edge1', source: 'node1', target: 'node2' }]);
      });

      act(() => {
        result.current.actions.setEdges((prev) => [
          ...prev,
          { id: 'edge2', source: 'node2', target: 'node3' }
        ]);
      });

      expect(result.current.edges).toHaveLength(2);
      expect(result.current.edges[1].id).toBe('edge2');
    });
  });

  describe('onNodesChange', () => {
    it('should apply node position changes', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.setNodes([{ id: 'node1', position: { x: 0, y: 0 } }]);
      });

      act(() => {
        result.current.actions.onNodesChange([
          { id: 'node1', type: 'position', position: { x: 50, y: 50 } }
        ]);
      });

      expect(result.current.nodes[0].position).toEqual({ x: 50, y: 50 });
    });

    it('should apply node removal changes', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.setNodes([
          { id: 'node1', position: { x: 0, y: 0 } },
          { id: 'node2', position: { x: 100, y: 100 } }
        ]);
      });

      act(() => {
        result.current.actions.onNodesChange([{ id: 'node1', type: 'remove' }]);
      });

      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.nodes[0].id).toBe('node2');
    });
  });

  describe('onEdgesChange', () => {
    it('should apply edge removal changes', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.setEdges([
          { id: 'edge1', source: 'node1', target: 'node2' },
          { id: 'edge2', source: 'node2', target: 'node3' }
        ]);
      });

      act(() => {
        result.current.actions.onEdgesChange([{ id: 'edge1', type: 'remove' }]);
      });

      expect(result.current.edges).toHaveLength(1);
      expect(result.current.edges[0].id).toBe('edge2');
    });
  });

  describe('selectNode', () => {
    it('should select node with string value', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.selectNode('node1');
      });

      expect(result.current.selectedNodeId).toBe('node1');
    });

    it('should select node with updater function', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.selectNode('node1');
      });

      act(() => {
        result.current.actions.selectNode((prev) => (prev === 'node1' ? 'node2' : prev));
      });

      expect(result.current.selectedNodeId).toBe('node2');
    });

    it('should deselect node when set to null', () => {
      const { result } = renderHook(() => useGraphState());

      act(() => {
        result.current.actions.selectNode('node1');
      });

      act(() => {
        result.current.actions.selectNode(null);
      });

      expect(result.current.selectedNodeId).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const { result } = renderHook(() => useGraphState());

      // Set up some state
      act(() => {
        result.current.actions.setNodes([{ id: 'node1', position: { x: 0, y: 0 } }]);
        result.current.actions.setEdges([{ id: 'edge1', source: 'node1', target: 'node2' }]);
        result.current.actions.selectNode('node1');
      });

      // Verify state is set
      expect(result.current.nodes).toHaveLength(1);
      expect(result.current.edges).toHaveLength(1);
      expect(result.current.selectedNodeId).toBe('node1');

      // Reset
      act(() => {
        result.current.actions.reset();
      });

      // Verify state is reset
      expect(result.current.nodes).toEqual([]);
      expect(result.current.edges).toEqual([]);
      expect(result.current.selectedNodeId).toBeNull();
    });
  });
});
