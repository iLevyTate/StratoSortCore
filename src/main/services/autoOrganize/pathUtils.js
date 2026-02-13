/**
 * Path Utilities
 *
 * Utilities for safe path handling and suggestion normalization.
 *
 * @module autoOrganize/pathUtils
 */

const { sanitizePath, normalizePathForIndex } = require('../../../shared/pathSanitization');

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
        ? sanitizePath(suggestion.folder)
        : suggestion.folder?.name
          ? sanitizePath(suggestion.folder.name)
          : 'Uncategorized',
    path: typeof suggestion.path === 'string' ? suggestion.path : suggestion.path?.path || undefined
  };
}

function buildSmartFolderIndex(smartFolders = []) {
  const byId = new Map();
  const byName = new Map();
  const byPath = new Map();

  for (const folder of smartFolders) {
    if (!folder || typeof folder !== 'object') continue;
    if (folder.id != null) byId.set(String(folder.id), folder);
    if (typeof folder.name === 'string' && folder.name.trim()) {
      byName.set(folder.name.toLowerCase(), folder);
    }
    if (typeof folder.path === 'string' && folder.path.trim()) {
      byPath.set(normalizePathForIndex(folder.path), folder);
    }
  }

  return { byId, byName, byPath };
}

/**
 * Resolve a suggestion to a configured smart folder.
 * Returns null when the suggestion does not map to a known folder/path.
 */
function resolveSuggestionToSmartFolder(suggestion, smartFolders = []) {
  if (!suggestion || !Array.isArray(smartFolders) || smartFolders.length === 0) {
    return null;
  }

  const index = buildSmartFolderIndex(smartFolders);
  const idCandidate = suggestion.folderId || suggestion.id;
  let match = null;

  if (idCandidate != null) {
    match = index.byId.get(String(idCandidate)) || null;
  }

  if (!match && typeof suggestion.path === 'string' && suggestion.path.trim()) {
    match = index.byPath.get(normalizePathForIndex(suggestion.path)) || null;
  }

  if (!match) {
    const nameCandidate =
      typeof suggestion.folder === 'string'
        ? suggestion.folder
        : typeof suggestion.name === 'string'
          ? suggestion.name
          : '';
    if (nameCandidate) {
      match = index.byName.get(nameCandidate.toLowerCase()) || null;
    }
  }

  if (!match || typeof match.path !== 'string' || !match.path.trim()) {
    return null;
  }

  return {
    ...suggestion,
    folder: match.name,
    path: match.path,
    folderId: match.id || suggestion.folderId,
    description: match.description || suggestion.description,
    isSmartFolder: true
  };
}

module.exports = {
  safeSuggestion,
  resolveSuggestionToSmartFolder
};
