/**
 * ReactFlow graph utilities for node positioning and identification
 */

/**
 * Generate a unique ID for a query node.
 *
 * @param {string} query - The search query text
 * @param {string|number} salt - A unique salt value (e.g., timestamp)
 * @returns {string} Unique node ID
 */
export function makeQueryNodeId(query, salt) {
  const short = String(query || '')
    .trim()
    .slice(0, 64)
    .replace(/\s+/g, '_');
  return `query:${short}:${salt}`;
}

/**
 * Calculate default node position in a grid layout.
 *
 * @param {number} index - Node index in the list
 * @returns {{x: number, y: number}} Position coordinates
 */
export function defaultNodePosition(index) {
  const spacingX = 260;
  const spacingY = 90;
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: 80 + col * spacingX, y: 80 + row * spacingY };
}

/**
 * Generate a unique ID for a cluster node.
 *
 * @param {string|number} clusterId - The cluster identifier
 * @returns {string} Unique cluster node ID
 */
export function makeClusterNodeId(clusterId) {
  return `cluster:${clusterId}`;
}

/**
 * Check if a node ID represents a cluster node.
 *
 * @param {string} nodeId - The node ID to check
 * @returns {boolean} True if this is a cluster node
 */
export function isClusterNode(nodeId) {
  return typeof nodeId === 'string' && nodeId.startsWith('cluster:');
}

/**
 * Check if a node ID represents a query node.
 *
 * @param {string} nodeId - The node ID to check
 * @returns {boolean} True if this is a query node
 */
export function isQueryNode(nodeId) {
  return typeof nodeId === 'string' && nodeId.startsWith('query:');
}

/**
 * Calculate expansion position relative to a seed node.
 * Places new nodes to the right of the seed in a vertical stack.
 *
 * @param {Object} seedPosition - The seed node's position {x, y}
 * @param {number} index - Index of the expanded node
 * @param {Object} options - Layout options
 * @param {number} options.offsetX - Horizontal offset from seed
 * @param {number} options.spacingY - Vertical spacing between nodes
 * @returns {{x: number, y: number}} Position coordinates
 */
export function expansionNodePosition(seedPosition, index, options = {}) {
  const { offsetX = 280, spacingY = 80 } = options;
  return {
    x: (seedPosition?.x || 0) + offsetX,
    y: (seedPosition?.y || 0) + index * spacingY
  };
}

/**
 * Get edge style based on relationship type and hop distance.
 *
 * @param {string} kind - Edge kind: 'query_match', 'similarity', 'cross_cluster', 'multi_hop'
 * @param {number} hop - Hop distance (0 for direct, 1+ for multi-hop)
 * @returns {Object} Edge style object
 */
export function getEdgeStyle(kind, hop = 0) {
  const baseStyles = {
    query_match: {
      stroke: '#6366f1',
      strokeWidth: 2,
      animated: true
    },
    similarity: {
      stroke: '#3b82f6',
      strokeWidth: 1.5,
      animated: false
    },
    cross_cluster: {
      stroke: '#9ca3af',
      strokeWidth: 1.5,
      strokeDasharray: '5,5',
      animated: true
    },
    multi_hop: {
      stroke: '#3b82f6', // Changed from #22c55e (green) to blue
      strokeWidth: 1.5,
      strokeDasharray: hop > 1 ? '3,3' : undefined,
      animated: hop === 1
    }
  };

  const style = baseStyles[kind] || baseStyles.similarity;

  // Apply opacity decay for multi-hop edges
  if (hop > 0) {
    style.opacity = Math.max(0.4, 1 - hop * 0.2);
  }

  return style;
}

/**
 * Calculate the centroid of a set of nodes.
 *
 * @param {Array} nodes - Array of nodes with position property
 * @returns {{x: number, y: number}} Centroid position
 */
export function calculateCentroid(nodes) {
  if (!nodes || nodes.length === 0) {
    return { x: 0, y: 0 };
  }

  const sum = nodes.reduce(
    (acc, node) => {
      const pos = node.position || { x: 0, y: 0 };
      return { x: acc.x + pos.x, y: acc.y + pos.y };
    },
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / nodes.length,
    y: sum.y / nodes.length
  };
}
