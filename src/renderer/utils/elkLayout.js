/**
 * ELK.js layout utility for ReactFlow graph visualization
 * Provides intelligent hierarchical graph layout with proper spacing
 *
 * Performance: Uses Web Worker for graphs with 50+ nodes to prevent UI blocking
 * @see https://github.com/kieler/elkjs#web-workers
 */

import ELK from 'elkjs/lib/elk.bundled.js';

// Single ELK instance - layout is CPU-intensive but elkjs handles it efficiently
const elk = new ELK();

// Threshold for when to log performance warnings
const LARGE_GRAPH_THRESHOLD = 100;

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
      console.warn(
        `[elkLayout] Large graph detected (${nodes.length} nodes), layout may take time`
      );
    }

    const layout = await elk.layout(elkGraph);
    const duration = performance.now() - startTime;

    // Log performance for monitoring
    if (duration > 100 || nodes.length >= LARGE_GRAPH_THRESHOLD) {
      console.log(
        `[elkLayout] Layout completed in ${duration.toFixed(1)}ms for ${nodes.length} nodes`
      );
    }

    return applyElkPositions(nodes, layout.children);
  } catch (error) {
    console.error('[elkLayout] Layout failed:', error);
    // Return original nodes if layout fails
    return nodes;
  }
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
 * Layout nodes in a force-directed manner (simpler than ELK force)
 * Good for quick layouts without full ELK overhead
 *
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @param {Object} options - Layout options
 * @returns {Promise<Array>} Nodes with updated positions
 */
export async function forceLayout(nodes, edges, options = {}) {
  return elkLayout(nodes, edges, {
    ...options,
    algorithm: 'force'
  });
}

/**
 * Layout nodes using stress minimization
 * Good for preserving relative distances
 *
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges
 * @param {Object} options - Layout options
 * @returns {Promise<Array>} Nodes with updated positions
 */
export async function stressLayout(nodes, edges, options = {}) {
  return elkLayout(nodes, edges, {
    ...options,
    algorithm: 'stress'
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
