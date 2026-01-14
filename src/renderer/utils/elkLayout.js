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

// Track pending promise callbacks to prevent memory leaks and handle cancellation
let pendingCallbacks = [];

// Store latest layout request data to prevent stale closure issues
let latestLayoutData = { nodes: null, edges: null, options: {} };

// Track if layout was aborted to prevent resolving after cancellation
let layoutAborted = false;

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
    return nodes || [];
  }

  // Normalize edges to empty array if null/undefined to prevent TypeError on .map()
  const safeEdges = edges || [];

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
    edges: safeEdges.map((edge) => ({
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

  // Store latest data in module-level variable to prevent stale closure issues
  // When the debounce timer fires, it will use the most recent data
  latestLayoutData = { nodes: nodes || [], edges: edges || [], options: layoutOptions };
  layoutAborted = false;

  return new Promise((resolve, reject) => {
    // Clear any pending debounce timer - new request supersedes old ones
    if (layoutDebounceTimer) {
      clearTimeout(layoutDebounceTimer);
    }

    // Track this resolver
    pendingCallbacks.push({ resolve, reject });

    // Set up debounced execution
    layoutDebounceTimer = setTimeout(async () => {
      layoutDebounceTimer = null;

      // Check if layout was aborted during debounce wait
      if (layoutAborted) {
        return;
      }

      // Capture callbacks to notify
      const callbacksToNotify = [...pendingCallbacks];
      pendingCallbacks = [];

      // Get the latest data (not stale closure data)
      const { nodes: latestNodes, edges: latestEdges, options: latestOptions } = latestLayoutData;

      // If there's already a layout in progress with same data, wait for it
      if (pendingLayoutPromise) {
        try {
          const result = await pendingLayoutPromise;
          // Only resolve if not aborted during the wait
          if (!layoutAborted) {
            callbacksToNotify.forEach((cb) => cb.resolve(result));
          }
          return;
        } catch {
          // Fall through to new layout
        }
      }

      // Execute the layout with LATEST data (not stale closure data)
      pendingLayoutPromise = elkLayout(latestNodes, latestEdges, latestOptions);

      try {
        const result = await pendingLayoutPromise;
        // Only resolve if not aborted during layout computation
        if (!layoutAborted) {
          callbacksToNotify.forEach((cb) => cb.resolve(result));
        }
      } catch (error) {
        logger.error('[elkLayout] Debounced layout failed:', error);
        // Return original nodes on error (using latest, not stale)
        if (!layoutAborted) {
          callbacksToNotify.forEach((cb) => cb.resolve(latestNodes));
        }
      } finally {
        pendingLayoutPromise = null;
      }
    }, debounceMs);
  });
}

/**
 * Cancel any pending debounced layout
 * Useful when component unmounts or user cancels operation
 *
 * Note: ELK layout computation itself cannot be cancelled once started,
 * but this prevents callbacks from being resolved after cancellation.
 */
export function cancelPendingLayout() {
  // Set abort flag to prevent any pending callbacks from resolving
  layoutAborted = true;

  if (layoutDebounceTimer) {
    clearTimeout(layoutDebounceTimer);
    layoutDebounceTimer = null;
  }

  // Reject pending promises with AbortError to signal cancellation
  if (pendingCallbacks.length > 0) {
    const error = new Error('Layout cancelled');
    error.name = 'AbortError';
    pendingCallbacks.forEach((cb) => cb.reject(error));
    pendingCallbacks = [];
  }

  // Clear the promise reference (actual ELK computation may still run but results will be ignored)
  pendingLayoutPromise = null;

  // Clear cached layout data
  latestLayoutData = { nodes: null, edges: null, options: {} };
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
    return { nodes: nodes || [], isPartial: false, totalNodes: 0 };
  }

  // Normalize edges to empty array if null/undefined
  const safeEdges = edges || [];
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
    const initialEdges = safeEdges.filter(
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
  const layoutedNodes = await elkLayout(nodes, safeEdges, layoutOptions);
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
 * Generic utility for radial distribution
 *
 * @param {Object} centerNode - The center node (optional if options.centerX/Y provided)
 * @param {Array} nodes - Nodes to arrange around center
 * @param {Object} options - Layout options
 * @param {number} options.radius - Distance from center
 * @param {number} options.startAngle - Starting angle in radians
 * @param {number} options.endAngle - Ending angle in radians
 * @param {number} options.centerX - Center X coordinate override
 * @param {number} options.centerY - Center Y coordinate override
 * @returns {Array} Positioned nodes
 */
export function radialLayout(centerNode, nodes, options = {}) {
  const { radius = 200, startAngle = 0, endAngle = 2 * Math.PI, centerX, centerY } = options;

  if (!nodes || nodes.length === 0) {
    return nodes;
  }

  // Determine center position
  let cX = centerX;
  let cY = centerY;

  if (centerNode && centerNode.position) {
    cX = centerNode.position.x;
    cY = centerNode.position.y;
  } else if (cX === undefined || cY === undefined) {
    cX = 0;
    cY = 0;
  }

  // Calculate angle distribution
  const totalAngle = endAngle - startAngle;
  // If spanning full circle (approx), divide by N. If sector, divide by N-1 to cover range.
  const isFullCircle = Math.abs(Math.abs(totalAngle) - 2 * Math.PI) < 0.01;
  const count = nodes.length;
  // For single node, place at start angle
  const angleStep = count <= 1 ? 0 : isFullCircle ? totalAngle / count : totalAngle / (count - 1);

  return nodes.map((node, index) => {
    const angle = startAngle + index * angleStep;
    return {
      ...node,
      position: {
        x: cX + radius * Math.cos(angle),
        y: cY + radius * Math.sin(angle)
      }
    };
  });
}

/**
 * Layout clusters in an intelligent hierarchical pattern
 * Groups related clusters together and sizes them by member count
 *
 * @param {Array} clusterNodes - Cluster nodes
 * @param {Array} edges - Edges between clusters (used to determine relationships)
 * @param {Object} options - Layout options
 * @returns {Array} Nodes with calculated positions
 */
export function clusterRadialLayout(clusterNodes, edges, options = {}) {
  const { centerX = 400, centerY = 300, radius = 280 } = options;

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

  // Sort clusters by member count (largest first) for prominence
  const sortedClusters = [...clusterNodes].sort((a, b) => {
    const countA = a.data?.memberCount || 0;
    const countB = b.data?.memberCount || 0;
    return countB - countA;
  });

  // Group clusters by confidence level for visual hierarchy
  const highConfidence = sortedClusters.filter((n) => n.data?.confidence === 'high');
  const mediumConfidence = sortedClusters.filter((n) => n.data?.confidence === 'medium');
  const lowConfidence = sortedClusters.filter((n) => n.data?.confidence === 'low');

  // Build adjacency map from edges to identify connected clusters
  const safeEdges = edges || [];
  const adjacency = new Map();
  safeEdges.forEach((edge) => {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, new Set());
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, new Set());
    adjacency.get(edge.source).add(edge.target);
    adjacency.get(edge.target).add(edge.source);
  });

  // Use force-directed-like placement: connected clusters stay closer
  const positioned = new Map();
  const result = [];

  // Position high-confidence clusters in the inner ring (most prominent)
  const innerRadius = radius * 0.5;
  highConfidence.forEach((node, idx) => {
    const angle = (idx / Math.max(1, highConfidence.length)) * 2 * Math.PI - Math.PI / 2;
    const pos = {
      x: centerX + innerRadius * Math.cos(angle),
      y: centerY + innerRadius * Math.sin(angle)
    };
    positioned.set(node.id, pos);
    result.push({ ...node, position: pos });
  });

  // Position medium-confidence clusters in the middle ring
  const middleRadius = radius * 0.8;
  mediumConfidence.forEach((node, idx) => {
    // Try to position near connected high-confidence clusters
    const neighbors = adjacency.get(node.id) || new Set();
    let bestAngle = (idx / Math.max(1, mediumConfidence.length)) * 2 * Math.PI - Math.PI / 2;

    // If connected to a positioned cluster, bias towards it
    for (const neighborId of neighbors) {
      if (positioned.has(neighborId)) {
        const neighborPos = positioned.get(neighborId);
        bestAngle = Math.atan2(neighborPos.y - centerY, neighborPos.x - centerX);
        // Add small offset to avoid overlap
        bestAngle += idx % 2 === 0 ? 0.3 : -0.3;
        break;
      }
    }

    const pos = {
      x: centerX + middleRadius * Math.cos(bestAngle),
      y: centerY + middleRadius * Math.sin(bestAngle)
    };
    positioned.set(node.id, pos);
    result.push({ ...node, position: pos });
  });

  // Position low-confidence clusters in the outer ring
  const outerRadius = radius;
  lowConfidence.forEach((node, idx) => {
    // Try to position near connected clusters
    const neighbors = adjacency.get(node.id) || new Set();
    let bestAngle = (idx / Math.max(1, lowConfidence.length)) * 2 * Math.PI - Math.PI / 2;

    for (const neighborId of neighbors) {
      if (positioned.has(neighborId)) {
        const neighborPos = positioned.get(neighborId);
        bestAngle = Math.atan2(neighborPos.y - centerY, neighborPos.x - centerX);
        bestAngle += idx % 2 === 0 ? 0.4 : -0.4;
        break;
      }
    }

    const pos = {
      x: centerX + outerRadius * Math.cos(bestAngle),
      y: centerY + outerRadius * Math.sin(bestAngle)
    };
    positioned.set(node.id, pos);
    result.push({ ...node, position: pos });
  });

  // Apply repulsion pass to avoid overlaps
  return applyClusterRepulsion(result, { centerX, centerY, minDistance: 120 });
}

/**
 * Apply simple repulsion to avoid cluster overlaps
 * @private
 */
function applyClusterRepulsion(nodes, options = {}) {
  const { minDistance = 120, iterations = 3 } = options;

  if (nodes.length < 2) return nodes;

  const positions = nodes.map((n) => ({ ...n.position }));

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[j].x - positions[i].x;
        const dy = positions[j].y - positions[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < minDistance && dist > 0) {
          const overlap = (minDistance - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;

          positions[i].x -= nx * overlap;
          positions[i].y -= ny * overlap;
          positions[j].x += nx * overlap;
          positions[j].y += ny * overlap;
        }
      }
    }
  }

  return nodes.map((node, idx) => ({
    ...node,
    position: positions[idx]
  }));
}

/**
 * Layout for expanding cluster members around a cluster node
 * Wrapper around radialLayout for fan pattern
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

  const count = memberNodes.length;

  // For small numbers, use simple vertical stacking (legacy behavior preserved)
  if (count <= 5) {
    const clusterPos = clusterNode.position || { x: 0, y: 0 };
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

  // For larger numbers, use fan layout via radialLayout
  // Fan is centered to the right (angle 0)
  return radialLayout(clusterNode, memberNodes, {
    radius: offsetX,
    startAngle: -fanAngle / 2,
    endAngle: fanAngle / 2
  });
}

export default elkLayout;

// Also export the new functions
export { LARGE_GRAPH_THRESHOLD, VERY_LARGE_GRAPH_THRESHOLD };
