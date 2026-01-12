/**
 * Feature Flags
 * Granular toggles for enabling/disabling features across the application.
 *
 * Usage:
 *   const { GRAPH_FEATURE_FLAGS } = require('../shared/featureFlags');
 *   if (GRAPH_FEATURE_FLAGS.SHOW_GRAPH) { ... }
 */

// Graph Visualization Feature Flags
const GRAPH_FEATURE_FLAGS = {
  SHOW_GRAPH: true, // Master toggle for graph visualization
  GRAPH_CLUSTERS: true, // Cluster visualization
  GRAPH_SIMILARITY_EDGES: true, // File-to-file similarity edges
  GRAPH_MULTI_HOP: true, // Multi-hop expansion
  GRAPH_PROGRESSIVE_LAYOUT: true, // Large graph handling with progressive disclosure
  GRAPH_KEYBOARD_NAV: true, // Keyboard navigation in graph
  GRAPH_CONTEXT_MENUS: true // Right-click context menus on nodes
};

module.exports = {
  GRAPH_FEATURE_FLAGS
};
