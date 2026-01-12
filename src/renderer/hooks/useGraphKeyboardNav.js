/**
 * useGraphKeyboardNav - Keyboard navigation for graph visualization
 *
 * Provides accessible keyboard navigation through graph nodes:
 * - Arrow keys: Navigate between connected nodes
 * - Enter: Open selected file
 * - Escape: Deselect current node
 * - Home: Go to first node
 * - End: Go to last node
 */

import { useCallback, useEffect, useRef } from 'react';

/**
 * Direction mapping for arrow key navigation
 */
const DIRECTIONS = {
  ArrowRight: 'outgoing', // Move to target nodes
  ArrowLeft: 'incoming', // Move to source nodes
  ArrowDown: 'next', // Move to next node in list
  ArrowUp: 'prev' // Move to previous node in list
};

/**
 * Find connected nodes based on direction
 * @param {string} nodeId - Current node ID
 * @param {Array} edges - Graph edges
 * @param {string} direction - 'outgoing' or 'incoming'
 * @returns {Array<string>} Connected node IDs
 */
function getConnectedNodes(nodeId, edges, direction) {
  if (!nodeId || !edges) return [];

  if (direction === 'outgoing') {
    return edges.filter((e) => e.source === nodeId).map((e) => e.target);
  }
  if (direction === 'incoming') {
    return edges.filter((e) => e.target === nodeId).map((e) => e.source);
  }
  return [];
}

/**
 * Custom hook for keyboard navigation in graph
 *
 * @param {Object} options - Hook options
 * @param {Array} options.nodes - Graph nodes
 * @param {Array} options.edges - Graph edges
 * @param {string|null} options.selectedNodeId - Currently selected node ID
 * @param {Function} options.onSelectNode - Callback when node is selected
 * @param {Function} options.onOpenFile - Callback when file should be opened
 * @param {Object} options.reactFlowInstance - ReactFlow instance for viewport control
 * @param {boolean} options.enabled - Whether keyboard nav is enabled
 * @returns {Object} Hook API
 */
export function useGraphKeyboardNav({
  nodes = [],
  edges = [],
  selectedNodeId = null,
  onSelectNode,
  onOpenFile,
  reactFlowInstance,
  enabled = true
}) {
  const lastNavigationTime = useRef(0);
  const DEBOUNCE_MS = 100;

  /**
   * Navigate to a specific node
   */
  const navigateToNode = useCallback(
    (nodeId) => {
      if (!nodeId || !onSelectNode) return;

      onSelectNode(nodeId);

      // Center view on the selected node
      if (reactFlowInstance?.current) {
        const node = nodes.find((n) => n.id === nodeId);
        if (node?.position) {
          reactFlowInstance.current.setCenter(node.position.x + 90, node.position.y + 30, {
            duration: 300,
            zoom: reactFlowInstance.current.getZoom()
          });
        }
      }
    },
    [nodes, onSelectNode, reactFlowInstance]
  );

  /**
   * Get the next node in a given direction
   */
  const getNextNode = useCallback(
    (direction) => {
      if (!nodes || nodes.length === 0) return null;

      // If no node selected, select the first one
      if (!selectedNodeId) {
        return nodes[0]?.id || null;
      }

      const currentIndex = nodes.findIndex((n) => n.id === selectedNodeId);

      // Handle list navigation (up/down)
      if (direction === 'next') {
        const nextIndex = (currentIndex + 1) % nodes.length;
        return nodes[nextIndex]?.id || null;
      }
      if (direction === 'prev') {
        const prevIndex = (currentIndex - 1 + nodes.length) % nodes.length;
        return nodes[prevIndex]?.id || null;
      }

      // Handle edge-based navigation (left/right)
      const connected = getConnectedNodes(selectedNodeId, edges, direction);
      if (connected.length > 0) {
        // Return the first connected node
        // Could be enhanced to pick the "closest" node spatially
        return connected[0];
      }

      // Fallback: move to adjacent node in list
      if (direction === 'outgoing') {
        const nextIndex = (currentIndex + 1) % nodes.length;
        return nodes[nextIndex]?.id || null;
      }
      if (direction === 'incoming') {
        const prevIndex = (currentIndex - 1 + nodes.length) % nodes.length;
        return nodes[prevIndex]?.id || null;
      }

      return null;
    },
    [nodes, edges, selectedNodeId]
  );

  /**
   * Handle keyboard events
   */
  const handleKeyDown = useCallback(
    (event) => {
      if (!enabled) return;

      // Don't handle if focus is in an input
      const target = event.target;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      // Tab navigation for panels
      if (event.key === 'Tab') {
        // Allow default tab behavior to work, but we can enhance it later if needed
        // For now, let's just make sure we don't block it
        return;
      }

      // Space: Expand/Collapse Cluster
      if (event.key === ' ' && selectedNodeId) {
        event.preventDefault();
        const selectedNode = nodes.find((n) => n.id === selectedNodeId);
        if (selectedNode?.type === 'clusterNode') {
          // Trigger expand logic - this needs to be passed in or handled via event
          const toggleEvent = new CustomEvent('graph:toggleCluster', {
            detail: { nodeId: selectedNodeId }
          });
          window.dispatchEvent(toggleEvent);
        }
        return;
      }

      // Debounce rapid key presses
      const now = Date.now();
      if (now - lastNavigationTime.current < DEBOUNCE_MS) {
        return;
      }

      const direction = DIRECTIONS[event.key];

      if (direction) {
        event.preventDefault();
        lastNavigationTime.current = now;

        const nextNodeId = getNextNode(direction);
        if (nextNodeId) {
          navigateToNode(nextNodeId);
        }
        return;
      }

      // Enter: Open selected file
      if (event.key === 'Enter' && selectedNodeId) {
        event.preventDefault();
        const selectedNode = nodes.find((n) => n.id === selectedNodeId);
        if (selectedNode?.data?.kind === 'file' && selectedNode?.data?.path) {
          onOpenFile?.(selectedNode.data.path);
        }
        return;
      }

      // Escape: Deselect
      if (event.key === 'Escape' && selectedNodeId) {
        event.preventDefault();
        onSelectNode?.(null);
        return;
      }

      // Home: Go to first node
      if (event.key === 'Home' && nodes.length > 0) {
        event.preventDefault();
        navigateToNode(nodes[0].id);
        return;
      }

      // End: Go to last node
      if (event.key === 'End' && nodes.length > 0) {
        event.preventDefault();
        navigateToNode(nodes[nodes.length - 1].id);
      }
    },
    [enabled, nodes, selectedNodeId, getNextNode, navigateToNode, onSelectNode, onOpenFile]
  );

  // Attach keyboard listener
  useEffect(() => {
    if (!enabled) return undefined;

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  return {
    navigateToNode,
    getNextNode,
    // Expose for external use
    selectFirst: useCallback(() => {
      if (nodes.length > 0) {
        navigateToNode(nodes[0].id);
      }
    }, [nodes, navigateToNode]),
    selectLast: useCallback(() => {
      if (nodes.length > 0) {
        navigateToNode(nodes[nodes.length - 1].id);
      }
    }, [nodes, navigateToNode]),
    clearSelection: useCallback(() => {
      onSelectNode?.(null);
    }, [onSelectNode])
  };
}

export default useGraphKeyboardNav;
