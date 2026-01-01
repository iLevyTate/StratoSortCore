/**
 * ELK.js layout utility for ReactFlow graph visualization
 * Provides intelligent hierarchical graph layout with proper spacing
 *
 * Performance optimizations:
 * - Debounced layout requests to prevent rapid re-layouts
 * - Request deduplication to avoid redundant computations
 * - Progressive rendering hints for large graphs
 * - Batched position updates
 *
 * @see https://github.com/kieler/elkjs#web-workers
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import { logger } from '../../shared/logger';

// Single ELK instance - layout is CPU-intensive but elkjs handles it efficiently
const elk = new ELK();

// Threshold for when to log performance warnings
const LARGE_GRAPH_THRESHOLD = 100;

// Threshold for "very large" graphs that need special handling
const VERY_LARGE_GRAPH_THRESHOLD = 200;

// Debounce tracking for layout requests
let pendingLayoutPromise = null;
let layoutDebounceTimer = null;
const LAYOUT_DEBOUNCE_MS = 150;

// FIX: Track pending promise resolvers to prevent memory leaks
// When a new layout request supersedes an old one, we resolve the old promises
// with the current nodes to prevent them from hanging indefinitely
let pendingResolvers = [];

/**
 * Node size configuration for different node types
 */
const NODE_SIZES = {
  queryNode: { width: 160, height: 50 },
  fileNode: { width: 180, height: 60 },
  clusterNode: { width: 180, height: 70 },
  default: { width: 180, height: 60 }
};

/**
 * Default layout options for ELK
 */
const DEFAULT_OPTIONS = {
  direction: 'RIGHT',
  spacing: 80,
  layerSpacing: 120,
  algorithm: 'layered'
};

/**
 * Apply ELK layout to ReactFlow nodes and edges
 *
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @param {Object} options - Layout options
 * @param {string} options.direction - Layout direction: 'RIGHT', 'DOWN', 'LEFT', 'UP'
 * @param {number} options.spacing - Node-to-node spacing
 * @param {number} options.layerSpacing - Spacing between layers
 * @param {string} options.algorithm - ELK algorithm: 'layered', 'force', 'stress'
 * @returns {Promise<Array>} Nodes with updated positions
 */
export async function elkLayout(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) {
    return nodes;
  }

  const {
    direction = DEFAULT_OPTIONS.direction,
    spacing = DEFAULT_OPTIONS.spacing,
    layerSpacing = DEFAULT_OPTIONS.layerSpacing,
    algorithm = DEFAULT_OPTIONS.algorithm
  } = options;

  // Build ELK graph structure
  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': algorithm,
      'elk.direction': direction,
      'elk.spacing.nodeNode': String(spacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerSpacing),
      // Improve edge routing
      'elk.edgeRouting': 'ORTHOGONAL',
      // Center nodes vertically in their layer
      'elk.layered.nodePlacement.strategy': 'SIMPLE',
      // Reduce edge crossings
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP'
    },
    children: nodes.map((node) => {
      const size = NODE_SIZES[node.type] || NODE_SIZES.default;
      return {
        id: node.id,
        width: size.width,
        height: size.height
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target]
    }))
  };

  try {
    // Performance measurement for large graphs
    const startTime = performance.now();

    if (nodes.length >= LARGE_GRAPH_THRESHOLD) {
      logger.warn(`[elkLayout] Large graph detected (${nodes.length} nodes), layout may take time`);
    }

    const layout = await elk.layout(elkGraph);
    const duration = performance.now() - startTime;

    // Log performance for monitoring
    if (duration > 100 || nodes.length >= LARGE_GRAPH_THRESHOLD) {
      logger.debug(
        `[elkLayout] Layout completed in ${duration.toFixed(1)}ms for ${nodes.length} nodes`
      );
    }

    return applyElkPositions(nodes, layout.children);
  } catch (error) {
    logger.error('[elkLayout] Layout failed:', { error: error.message });
    // Return original nodes if layout fails
    return nodes;
  }
}

/**
 * Debounced version of elkLayout that prevents rapid re-layouts
 * Coalesces multiple layout requests into a single execution
 *
 * Benefits:
 * - Prevents UI jank from rapid search queries
 * - Deduplicates redundant layout requests
 * - Returns same promise for concurrent calls
 *
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @param {Object} options - Layout options
 * @param {number} options.debounceMs - Debounce delay (default: 150ms)
 * @returns {Promise<Array>} Nodes with updated positions
 */
export function debouncedElkLayout(nodes, edges, options = {}) {
  const { debounceMs = LAYOUT_DEBOUNCE_MS, ...layoutOptions } = options;

  return new Promise((resolve) => {
    // FIX: Resolve any previously pending promises with current nodes
    // This prevents memory leaks from promises that would never resolve
    if (pendingResolvers.length > 0) {
      pendingResolvers.forEach((prevResolve) => prevResolve(nodes));
      pendingResolvers = [];
    }

    // Clear any pending debounce timer
    if (layoutDebounceTimer) {
      clearTimeout(layoutDebounceTimer);
    }

    // FIX: Track this resolver in case it gets superseded
    pendingResolvers.push(resolve);

    // Set up debounced execution
    layoutDebounceTimer = setTimeout(async () => {
      layoutDebounceTimer = null;

      // FIX: Clear pending resolvers since we're about to resolve them
      const resolversToNotify = [...pendingResolvers];
      pendingResolvers = [];

      // If there's already a layout in progress, wait for it
      if (pendingLayoutPromise) {
        try {
          const result = await pendingLayoutPromise;
          resolversToNotify.forEach((r) => r(result));
          return;
        } catch {
          // Fall through to new layout
        }
      }

      // Execute the layout
      pendingLayoutPromise = elkLayout(nodes, edges, layoutOptions);

      try {
        const result = await pendingLayoutPromise;
        resolversToNotify.forEach((r) => r(result));
      } catch (error) {
        logger.error('[elkLayout] Debounced layout failed:', error);
        resolversToNotify.forEach((r) => r(nodes)); // Return original nodes on error
      } finally {
        pendingLayoutPromise = null;
      }
    }, debounceMs);
  });
}

/**
 * Cancel any pending debounced layout
 * Useful when component unmounts or user cancels operation
 */
export function cancelPendingLayout() {
  if (layoutDebounceTimer) {
    clearTimeout(layoutDebounceTimer);
    layoutDebounceTimer = null;
  }
  // FIX: Resolve pending promises with empty array to prevent memory leaks
  // Callers should handle the case where layout returns no nodes
  if (pendingResolvers.length > 0) {
    pendingResolvers.forEach((r) => r([]));
    pendingResolvers = [];
  }
  pendingLayoutPromise = null;
}

/**
 * Smart layout that automatically chooses the best strategy
 * based on graph size and complexity
 *
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @param {Object} options - Layout options
 * @param {boolean} options.progressive - Enable progressive rendering for large graphs
 * @returns {Promise<{nodes: Array, isPartial: boolean, totalNodes: number}>}
 */
export async function smartLayout(nodes, edges, options = {}) {
  const { progressive = true, maxInitialNodes = 50, ...layoutOptions } = options;

  if (!nodes || nodes.length === 0) {
    return { nodes, isPartial: false, totalNodes: 0 };
  }

  const totalNodes = nodes.length;

  // For very large graphs with progressive enabled, layout only important nodes first
  if (progressive && totalNodes > VERY_LARGE_GRAPH_THRESHOLD) {
    logger.info(`[elkLayout] Progressive layout for ${totalNodes} nodes`);

    // Sort nodes by importance (score, or if no score, keep original order)
    const sortedNodes = [...nodes].sort((a, b) => {
      const scoreA = a.data?.score || a.data?.withinScore || 0;
      const scoreB = b.data?.score || b.data?.withinScore || 0;
      return scoreB - scoreA;
    });

    // Take top N nodes for initial layout
    const initialNodes = sortedNodes.slice(0, maxInitialNodes);
    const initialNodeIds = new Set(initialNodes.map((n) => n.id));

    // Filter edges to only include those between initial nodes
    const initialEdges = edges.filter(
      (e) => initialNodeIds.has(e.source) && initialNodeIds.has(e.target)
    );

    // Layout initial nodes
    const layoutedInitial = await elkLayout(initialNodes, initialEdges, layoutOptions);

    // For remaining nodes, position them in a grid below the laid out nodes
    const remainingNodes = sortedNodes.slice(maxInitialNodes);
    const bounds = getLayoutBounds(layoutedInitial);
    const gridStartY = bounds.maxY + 100;
    const gridColumns = 5;
    const gridSpacing = { x: 200, y: 80 };

    const layoutedRemaining = remainingNodes.map((node, index) => ({
      ...node,
      position: {
        x: (index % gridColumns) * gridSpacing.x,
        y: gridStartY + Math.floor(index / gridColumns) * gridSpacing.y
      }
    }));

    return {
      nodes: [...layoutedInitial, ...layoutedRemaining],
      isPartial: true,
      totalNodes,
      layoutedCount: initialNodes.length
    };
  }

  // For smaller graphs, do full layout
  const layoutedNodes = await elkLayout(nodes, edges, layoutOptions);
  return { nodes: layoutedNodes, isPartial: false, totalNodes };
}

/**
 * Apply ELK positions back to ReactFlow nodes
 *
 * @param {Array} nodes - Original ReactFlow nodes
 * @param {Array} elkChildren - ELK layout result children
 * @returns {Array} Nodes with updated positions
 */
function applyElkPositions(nodes, elkChildren) {
  if (!elkChildren || elkChildren.length === 0) {
    return nodes;
  }

  const posMap = new Map(
    elkChildren.map((child) => [child.id, { x: child.x || 0, y: child.y || 0 }])
  );

  return nodes.map((node) => {
    const newPos = posMap.get(node.id);
    if (!newPos) return node;

    // Only update if position actually changed
    const currentPos = node.position || { x: 0, y: 0 };
    if (currentPos.x === newPos.x && currentPos.y === newPos.y) {
      return node;
    }

    return {
      ...node,
      position: newPos
    };
  });
}

/**
 * Calculate bounding box of nodes for fitView
 *
 * @param {Array} nodes - ReactFlow nodes
 * @returns {Object} Bounding box { minX, minY, maxX, maxY, width, height }
 */
export function getLayoutBounds(nodes) {
  if (!nodes || nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  nodes.forEach((node) => {
    const pos = node.position || { x: 0, y: 0 };
    const size = NODE_SIZES[node.type] || NODE_SIZES.default;

    minX = Math.min(minX, pos.x);
    minY = Math.min(minY, pos.y);
    maxX = Math.max(maxX, pos.x + size.width);
    maxY = Math.max(maxY, pos.y + size.height);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Layout nodes in a radial pattern around a center node
 * Useful for expansion from a selected node
 *
 * @param {Object} centerNode - The center node
 * @param {Array} childNodes - Nodes to arrange around center
 * @param {Object} options - Layout options
 * @param {number} options.radius - Distance from center
 * @param {number} options.startAngle - Starting angle in radians
 * @returns {Array} Child nodes with updated positions
 */
export function radialLayout(centerNode, childNodes, options = {}) {
  const { radius = 200, startAngle = -Math.PI / 2 } = options;

  if (!centerNode || !childNodes || childNodes.length === 0) {
    return childNodes;
  }

  const centerPos = centerNode.position || { x: 0, y: 0 };
  const angleStep = (2 * Math.PI) / childNodes.length;

  return childNodes.map((node, index) => {
    const angle = startAngle + index * angleStep;
    return {
      ...node,
      position: {
        x: centerPos.x + radius * Math.cos(angle),
        y: centerPos.y + radius * Math.sin(angle)
      }
    };
  });
}

/**
 * Layout clusters in a circular/radial pattern
 * Good for visualizing cluster relationships
 *
 * @param {Array} clusterNodes - Cluster nodes
 * @param {Array} edges - Edges between clusters
 * @param {Object} options - Layout options
 * @returns {Array} Nodes with radial positions
 */
export function clusterRadialLayout(clusterNodes, edges, options = {}) {
  const { centerX = 400, centerY = 300, radius = 250, startAngle = -Math.PI / 2 } = options;

  if (!clusterNodes || clusterNodes.length === 0) {
    return clusterNodes;
  }

  // Single cluster - place in center
  if (clusterNodes.length === 1) {
    return clusterNodes.map((node) => ({
      ...node,
      position: { x: centerX, y: centerY }
    }));
  }

  // Multiple clusters - arrange radially
  const angleStep = (2 * Math.PI) / clusterNodes.length;

  return clusterNodes.map((node, index) => {
    const angle = startAngle + index * angleStep;
    return {
      ...node,
      position: {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      }
    };
  });
}

/**
 * Layout for expanding cluster members around a cluster node
 * Places files in a fan pattern to the right of the cluster
 *
 * @param {Object} clusterNode - The parent cluster node
 * @param {Array} memberNodes - Member file nodes to layout
 * @param {Object} options - Layout options
 * @returns {Array} Member nodes with positions
 */
export function clusterExpansionLayout(clusterNode, memberNodes, options = {}) {
  const {
    offsetX = 300,
    spacing = 60,
    fanAngle = Math.PI / 3 // 60 degrees spread
  } = options;

  if (!clusterNode || !memberNodes || memberNodes.length === 0) {
    return memberNodes;
  }

  const clusterPos = clusterNode.position || { x: 0, y: 0 };
  const count = memberNodes.length;

  // For small numbers, use simple vertical stacking
  if (count <= 5) {
    const totalHeight = (count - 1) * spacing;
    const startY = clusterPos.y - totalHeight / 2;

    return memberNodes.map((node, index) => ({
      ...node,
      position: {
        x: clusterPos.x + offsetX,
        y: startY + index * spacing
      }
    }));
  }

  // For larger numbers, use a fan layout
  const angleStep = fanAngle / (count - 1);
  const startAngle = -fanAngle / 2;
  const fanRadius = offsetX;

  return memberNodes.map((node, index) => {
    const angle = startAngle + index * angleStep;
    return {
      ...node,
      position: {
        x: clusterPos.x + fanRadius * Math.cos(angle),
        y: clusterPos.y + fanRadius * Math.sin(angle)
      }
    };
  });
}

export default elkLayout;

// Also export the new functions
export { LARGE_GRAPH_THRESHOLD, VERY_LARGE_GRAPH_THRESHOLD };
