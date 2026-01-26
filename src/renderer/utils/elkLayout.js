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
const LAYOUT_DEBOUNCE_MS = 200; // Increased debounce to let UI settle before heavy layout

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
  queryNode: { width: 180, height: 60 },
  fileNode: { width: 240, height: 120 },
  folderNode: { width: 220, height: 90 },
  // FIX: Make cluster nodes compact circles/hubs instead of large cards
  clusterNode: { width: 180, height: 180 },
  default: { width: 220, height: 100 }
};

/**
 * Default layout options for ELK
 */
const DEFAULT_OPTIONS = {
  direction: 'RIGHT',
  spacing: 250, // Increased spacing to reduce overlap
  layerSpacing: 400, // Increased layer spacing for clarity
  algorithm: 'layered'
};

const ALGORITHM_MAP = {
  layered: 'layered',
  force: 'org.eclipse.elk.force',
  stress: 'org.eclipse.elk.stress',
  radial: 'org.eclipse.elk.radial'
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
 * @returns {Promise<{nodes: Array, edges: Array}>} Object containing updated nodes and edges
 */
export async function elkLayout(nodes, edges, options = {}) {
  if (!nodes || nodes.length === 0) {
    return { nodes: nodes || [], edges: edges || [] };
  }

  // Normalize edges to empty array if null/undefined to prevent TypeError on .map()
  const safeEdges = edges || [];

  const {
    direction = DEFAULT_OPTIONS.direction,
    spacing = 250, // Significantly increased from 160 to reduce overlaps
    layerSpacing = 400, // Increased from 280 to give more breathing room
    algorithm = DEFAULT_OPTIONS.algorithm
  } = options;

  const elkAlgorithm = ALGORITHM_MAP[algorithm] || algorithm;

  // Spacing proportional to base spacing
  const edgeSpacing = Math.max(40, Math.round(spacing / 4));
  const edgeNodeSpacing = Math.max(40, Math.round(spacing / 3));
  const edgeLayerSpacing = Math.max(60, Math.round(layerSpacing / 3));

  // Base layout options
  const layoutOptions = {
    'elk.algorithm': elkAlgorithm,
    'elk.direction': direction,
    'elk.spacing.nodeNode': String(spacing),
    'elk.spacing.edgeEdge': String(edgeSpacing),
    'elk.spacing.edgeNode': String(edgeNodeSpacing),
    // Improve edge routing - SPLINES looks cleaner than ORTHOGONAL for complex graphs
    'elk.edgeRouting': 'SPLINES',
    // Prioritize node placement that reduces edge crossings
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
    // Separate edge segments to prevent overlap
    'elk.layered.mergeEdges': 'false'
  };

  // Add algorithm-specific options
  if (elkAlgorithm === 'layered') {
    layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(layerSpacing);
    layoutOptions['elk.layered.spacing.edgeNodeBetweenLayers'] = String(edgeLayerSpacing);
    layoutOptions['elk.layered.spacing.edgeEdgeBetweenLayers'] = String(edgeSpacing);
    layoutOptions['elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF'; // Better straight-line alignment
    layoutOptions['elk.spacing.componentComponent'] = String(spacing); // Keep disconnected clusters close
    layoutOptions['elk.layered.crossingMinimization.strategy'] = 'LAYER_SWEEP';
  } else if (elkAlgorithm === 'org.eclipse.elk.force') {
    layoutOptions['elk.force.iterations'] = '100';
    layoutOptions['elk.force.repulsion'] = String(Math.max(2.0, spacing / 50)); // Scale repulsion
    layoutOptions['elk.force.temperature'] = '0.1'; // Low temperature for stability
  }

  // Build ELK graph structure
  const nodeIds = new Set(nodes.map((n) => n.id));
  const elkGraph = {
    id: 'root',
    layoutOptions,
    children: nodes.map((node) => {
      const size = NODE_SIZES[node.type] || NODE_SIZES.default;
      return {
        id: node.id,
        width: size.width,
        height: size.height
      };
    }),
    edges: safeEdges
      .filter((edge) => {
        const hasSource = nodeIds.has(edge.source);
        const hasTarget = nodeIds.has(edge.target);
        if (!hasSource || !hasTarget) {
          logger.warn(`[elkLayout] Skipping edge ${edge.id}: missing node(s)`, {
            source: edge.source,
            target: edge.target,
            hasSource,
            hasTarget
          });
          return false;
        }
        return true;
      })
      .map((edge) => ({
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

    const updatedNodes = applyElkPositions(nodes, layout.children);
    const updatedEdges = applyElkEdgeRoutes(safeEdges, layout.edges);

    return { nodes: updatedNodes, edges: updatedEdges };
  } catch (error) {
    logger.error('[elkLayout] Layout failed:', { error: error.message });
    // Return original nodes and edges if layout fails
    return { nodes, edges: safeEdges };
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
 * @returns {Promise<{nodes: Array, edges: Array}>} Object containing updated nodes and edges
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
      // FIX: If aborted, we need to reject callbacks, not leave them hanging
      if (layoutAborted) {
        // Reject any pending callbacks that haven't been handled
        if (pendingCallbacks.length > 0) {
          const error = new Error('Layout cancelled');
          error.name = 'AbortError';
          pendingCallbacks.forEach((cb) => cb.reject(error));
          pendingCallbacks = [];
        }
        return;
      }

      // Capture callbacks to notify
      const callbacksToNotify = [...pendingCallbacks];
      pendingCallbacks = [];

      // Get the latest data (not stale closure data)
      const { nodes: latestNodes, edges: latestEdges, options: latestOptions } = latestLayoutData;

      // FIX: If there's already a layout in progress, wait for it to complete
      // but then ALWAYS use the latest data for the result instead of reusing
      // the pending promise's result. This prevents stale data issues when
      // new requests come in with different data during a running layout.
      if (pendingLayoutPromise) {
        try {
          await pendingLayoutPromise;
          // Don't reuse the result - fall through to compute with latest data
          // The pending layout may have used older data
        } catch {
          // Fall through to new layout
        }
      }

      // Execute the layout with LATEST data (not stale closure data)
      pendingLayoutPromise = elkLayout(latestNodes, latestEdges, latestOptions);

      try {
        const result = await pendingLayoutPromise;
        // FIX: If aborted during layout, reject callbacks instead of leaving them hanging
        if (layoutAborted) {
          const error = new Error('Layout cancelled');
          error.name = 'AbortError';
          callbacksToNotify.forEach((cb) => cb.reject(error));
        } else {
          callbacksToNotify.forEach((cb) => cb.resolve(result));
        }
      } catch (error) {
        logger.error('[elkLayout] Debounced layout failed:', error);
        // FIX: If aborted, reject; otherwise resolve with original nodes
        if (layoutAborted) {
          const abortError = new Error('Layout cancelled');
          abortError.name = 'AbortError';
          callbacksToNotify.forEach((cb) => cb.reject(abortError));
        } else {
          callbacksToNotify.forEach((cb) => cb.resolve({ nodes: latestNodes, edges: latestEdges }));
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
 * @returns {Promise<{nodes: Array, edges: Array, isPartial: boolean, totalNodes: number}>}
 */
export async function smartLayout(nodes, edges, options = {}) {
  const { progressive = true, maxInitialNodes = 50, ...layoutOptions } = options;

  if (!nodes || nodes.length === 0) {
    return { nodes: nodes || [], edges: edges || [], isPartial: false, totalNodes: 0 };
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
    const { nodes: layoutedInitial, edges: layoutedEdges } = await elkLayout(
      initialNodes,
      initialEdges,
      layoutOptions
    );

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
      edges: [
        ...layoutedEdges,
        ...safeEdges.filter((e) => !initialNodeIds.has(e.source) || !initialNodeIds.has(e.target))
      ],
      isPartial: true,
      totalNodes,
      layoutedCount: initialNodes.length
    };
  }

  // For smaller graphs, do full layout
  return await elkLayout(nodes, safeEdges, layoutOptions);
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
 * Apply ELK edge routes to ReactFlow edges
 *
 * @param {Array} edges - Original ReactFlow edges
 * @param {Array} elkEdges - ELK layout result edges
 * @returns {Array} Edges with updated route data
 */
function applyElkEdgeRoutes(edges, elkEdges) {
  if (!elkEdges || elkEdges.length === 0) {
    return edges;
  }

  const routeMap = new Map(elkEdges.map((edge) => [edge.id, edge.sections]));

  return edges.map((edge) => {
    const sections = routeMap.get(edge.id);
    if (!sections) return edge;

    return {
      ...edge,
      data: {
        ...edge.data,
        elkSections: sections
      }
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
  const { centerX = 400, centerY = 300, radius = 500 } = options;
  const clusterSize = NODE_SIZES.clusterNode || { width: 180, height: 180 };
  const arcPadding = 250; // Increased to 250 for much better separation and to allow expansion

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

  // Calculate radii that scale with node size and ring density to avoid overlap
  const baseRadius = Math.max(radius, clusterSize.width * 1.5);
  const calcRingRadius = (count, ringMultiplier, minPreviousRadius = 0) => {
    const nodesInRing = Math.max(count, 1);
    const minCircumference = nodesInRing * (clusterSize.width + arcPadding);
    const minRadiusForSpacing = minCircumference / (2 * Math.PI);
    const scaledRadius = Math.max(baseRadius * ringMultiplier, minRadiusForSpacing);
    // Ensure rings never collapse into each other vertically
    const separatedRadius =
      minPreviousRadius > 0
        ? Math.max(scaledRadius, minPreviousRadius + clusterSize.height + arcPadding / 2)
        : scaledRadius;
    return Math.max(separatedRadius, clusterSize.width + arcPadding);
  };

  const innerRadius = calcRingRadius(highConfidence.length, 0.65);
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
  const middleRadius = calcRingRadius(mediumConfidence.length, 0.9, innerRadius);
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
  const outerRadius = calcRingRadius(lowConfidence.length, 1.25, middleRadius);
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
  const minRepulsionDistance = Math.max(clusterSize.width + arcPadding, baseRadius * 0.35);
  return applyClusterRepulsion(result, {
    centerX,
    centerY,
    minDistance: minRepulsionDistance,
    iterations: 5
  });
}

/**
 * Apply simple repulsion to avoid cluster overlaps
 * FIX CRIT: Optimized from O(n²) to O(n) using spatial grid hashing
 * For 200 nodes, reduces from 40,000 comparisons to ~200 comparisons per iteration
 * @private
 */
function applyClusterRepulsion(nodes, options = {}) {
  const { minDistance = 500, iterations = 4 } = options;

  if (nodes.length < 2) return nodes;

  const positions = nodes.map((n) => ({ ...n.position }));

  // FIX: Use spatial grid for O(n) collision detection instead of O(n²)
  // Grid cell size should be >= minDistance to ensure we only check neighboring cells
  const cellSize = minDistance;

  for (let iter = 0; iter < iterations; iter++) {
    // Build spatial grid hash map
    const grid = new Map();

    const getCellKey = (x, y) => {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      return `${cx},${cy}`;
    };

    // Index all positions into grid cells
    for (let i = 0; i < positions.length; i++) {
      const key = getCellKey(positions[i].x, positions[i].y);
      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key).push(i);
    }

    // For each position, only check positions in same cell or adjacent cells
    for (let i = 0; i < positions.length; i++) {
      const cx = Math.floor(positions[i].x / cellSize);
      const cy = Math.floor(positions[i].y / cellSize);

      // Check 3x3 neighborhood of cells (current + 8 neighbors)
      for (let dcx = -1; dcx <= 1; dcx++) {
        for (let dcy = -1; dcy <= 1; dcy++) {
          const neighborKey = `${cx + dcx},${cy + dcy}`;
          const neighbors = grid.get(neighborKey);
          if (!neighbors) continue;

          for (const j of neighbors) {
            // Only process each pair once (j > i) and skip self
            if (j <= i) continue;

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
    offsetX = 450, // Increased from 300 to prevent node overlap
    spacing = 80 // Increased from 60
    // fanAngle = Math.PI / 3 // 60 degrees spread - reserved for future radial layout
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

  // Dynamic radius and angle adjustment for better spacing
  // Calculate needed circumference to avoid overlap
  const minCircumference = count * (spacing * 0.85);

  // Dynamic angle: Scale angle based on count, from minAngle up to almost full circle (2PI - gap)
  const { minAngle = Math.PI / 4 } = options;
  const maxAngle = Math.PI * 1.85; // Leave a small gap (approx 27 degrees)

  // Estimate angle needed for this count at base radius
  // Base angle per node roughly 15 degrees (0.26 rad) at 300px radius
  const anglePerNode = 0.25;
  let calculatedAngle = Math.max(minAngle, Math.min(maxAngle, count * anglePerNode));

  // Calculate radius needed to fit nodes within this angle
  const currentArcLength = calculatedAngle * offsetX;
  let finalRadius = offsetX;

  if (minCircumference > currentArcLength) {
    // If nodes don't fit in current angle/radius, try expanding angle first (if not maxed)
    if (calculatedAngle < maxAngle) {
      calculatedAngle = maxAngle;
    }

    // Recalculate with max angle
    const maxArcLength = calculatedAngle * offsetX;
    if (minCircumference > maxArcLength) {
      // Still don't fit, need to increase radius
      finalRadius = Math.max(offsetX, minCircumference / calculatedAngle);
    }
  }

  // Determine best angle to avoid center overlap if center is known
  // If we know the center of the graph, point the fan AWAY from the center
  let centerAngle = 0;
  if (options.origin && clusterNode.position) {
    // Vector from origin to cluster
    const dx = clusterNode.position.x - options.origin.x;
    const dy = clusterNode.position.y - options.origin.y;
    // Angle pointing away from center
    centerAngle = Math.atan2(dy, dx);
  }

  // Fan is centered at centerAngle
  return radialLayout(clusterNode, memberNodes, {
    radius: finalRadius,
    startAngle: centerAngle - calculatedAngle / 2,
    endAngle: centerAngle + calculatedAngle / 2
  });
}

export default elkLayout;

// Also export the new functions
export { LARGE_GRAPH_THRESHOLD, VERY_LARGE_GRAPH_THRESHOLD };

// HMR disposal handler to reset module-level state during hot reload
// This prevents stale callbacks and inconsistent state during development
if (module.hot) {
  module.hot.dispose(() => {
    cancelPendingLayout();
    if (layoutDebounceTimer) {
      clearTimeout(layoutDebounceTimer);
      layoutDebounceTimer = null;
    }
    pendingLayoutPromise = null;
    pendingCallbacks = [];
    latestLayoutData = { nodes: null, edges: null, options: {} };
    layoutAborted = false;
  });
}
