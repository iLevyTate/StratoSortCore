/**
 * Feature Flags
 * Granular toggles for enabling/disabling features across the application.
 *
 * Usage:
 *   const { GRAPH_FEATURE_FLAGS } = require('../shared/featureFlags');
 *   if (GRAPH_FEATURE_FLAGS.SHOW_GRAPH) { ... }
 */

const readEnvFlag = (key, fallback) => {
  const rawValue = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(rawValue).trim().toLowerCase());
};

// Graph Visualization Feature Flags
const GRAPH_FEATURE_FLAGS = {
  SHOW_GRAPH: readEnvFlag('STRATOSORT_GRAPH_ENABLED', true), // Master toggle
  GRAPH_CLUSTERS: readEnvFlag('STRATOSORT_GRAPH_CLUSTERS', true), // Cluster visualization
  GRAPH_SIMILARITY_EDGES: readEnvFlag('STRATOSORT_GRAPH_SIMILARITY_EDGES', true), // Similarity edges
  GRAPH_MULTI_HOP: readEnvFlag('STRATOSORT_GRAPH_MULTI_HOP', true), // Multi-hop expansion
  GRAPH_PROGRESSIVE_LAYOUT: readEnvFlag('STRATOSORT_GRAPH_PROGRESSIVE_LAYOUT', true), // Large graph handling
  GRAPH_KEYBOARD_NAV: readEnvFlag('STRATOSORT_GRAPH_KEYBOARD_NAV', true), // Keyboard navigation
  GRAPH_CONTEXT_MENUS: readEnvFlag('STRATOSORT_GRAPH_CONTEXT_MENUS', true) // Context menus
};

module.exports = {
  GRAPH_FEATURE_FLAGS
};
