/**
 * Path Utilities
 *
 * Utilities for safe path handling and suggestion normalization.
 *
 * @module autoOrganize/pathUtils
 */

/**
 * Coerce a suggestion object into a safe structure with string properties
 * Handles cases where properties might be nested objects or undefined
 *
 * @param {Object} suggestion - The raw suggestion object
 * @returns {Object} Safe suggestion with string folder/path properties
 */
function safeSuggestion(suggestion) {
  if (!suggestion) {
    return {
      folder: 'Uncategorized',
      path: undefined
    };
  }

  return {
    ...suggestion,
    folder:
      typeof suggestion.folder === 'string'
        ? suggestion.folder
        : suggestion.folder?.name || 'Uncategorized',
    path: typeof suggestion.path === 'string' ? suggestion.path : suggestion.path?.path || undefined
  };
}

module.exports = {
  safeSuggestion
};
