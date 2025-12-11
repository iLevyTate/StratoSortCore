/**
 * Index Manager
 *
 * Manages indexes for efficient querying of analysis history.
 * Handles file hash, path lookup, tag, category, date, and size indexes.
 *
 * @module analysisHistory/indexManager
 */

const crypto = require('crypto');

/**
 * Create empty index structure
 * @param {string} schemaVersion - Schema version
 * @returns {Object} Empty index
 */
function createEmptyIndex(schemaVersion) {
  return {
    schemaVersion,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fileHashes: {},
    pathLookup: {},
    tagIndex: {},
    categoryIndex: {},
    dateIndex: {},
    sizeIndex: {},
    lastOptimized: null
  };
}

/**
 * Generate file hash from path, size, and last modified
 * @param {string} filePath - File path
 * @param {number} size - File size
 * @param {string} lastModified - Last modified timestamp
 * @returns {string} 16-character hash
 */
function generateFileHash(filePath, size, lastModified) {
  const hashInput = `${filePath}:${size}:${lastModified}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
}

/**
 * Get size range category for file size
 * @param {number} size - File size in bytes
 * @returns {string} Size range category
 */
function getSizeRange(size) {
  if (size < 1024) return 'tiny'; // < 1KB
  if (size < 1024 * 1024) return 'small'; // < 1MB
  if (size < 10 * 1024 * 1024) return 'medium'; // < 10MB
  if (size < 100 * 1024 * 1024) return 'large'; // < 100MB
  return 'huge'; // >= 100MB
}

/**
 * Update all indexes for a new entry
 * @param {Object} index - Analysis index
 * @param {Object} entry - Analysis entry
 */
function updateIndexes(index, entry) {
  const timestamp = new Date().toISOString();
  // Ensure updatedAt always moves forward, even when called twice within the same ms
  index.updatedAt =
    timestamp === index.updatedAt ? new Date(Date.now() + 1).toISOString() : timestamp;

  // File hash index
  index.fileHashes[entry.fileHash] = entry.id;

  // Path lookup index
  index.pathLookup[entry.originalPath] = entry.id;

  // Tag index
  if (entry.analysis.tags) {
    entry.analysis.tags.forEach((tag) => {
      if (!index.tagIndex[tag]) {
        index.tagIndex[tag] = [];
      }
      index.tagIndex[tag].push(entry.id);
    });
  }

  // Category index
  if (entry.analysis.category) {
    if (!index.categoryIndex[entry.analysis.category]) {
      index.categoryIndex[entry.analysis.category] = [];
    }
    index.categoryIndex[entry.analysis.category].push(entry.id);
  }

  // Date index (by month)
  const dateKey = entry.timestamp.substring(0, 7); // YYYY-MM
  if (!index.dateIndex[dateKey]) {
    index.dateIndex[dateKey] = [];
  }
  index.dateIndex[dateKey].push(entry.id);

  // Size index (by size ranges)
  const sizeRange = getSizeRange(entry.fileSize);
  if (!index.sizeIndex[sizeRange]) {
    index.sizeIndex[sizeRange] = [];
  }
  index.sizeIndex[sizeRange].push(entry.id);
}

/**
 * Remove an entry from all indexes
 * @param {Object} index - Analysis index
 * @param {Object} entry - Analysis entry to remove
 */
function removeFromIndexes(index, entry) {
  // Remove from various indexes
  delete index.fileHashes[entry.fileHash];
  delete index.pathLookup[entry.originalPath];

  // Remove from tag index
  if (entry.analysis.tags) {
    entry.analysis.tags.forEach((tag) => {
      const tagEntries = index.tagIndex[tag] || [];
      index.tagIndex[tag] = tagEntries.filter((id) => id !== entry.id);
      if (index.tagIndex[tag].length === 0) {
        delete index.tagIndex[tag];
      }
    });
  }

  // Remove from category index
  if (entry.analysis.category) {
    const categoryEntries = index.categoryIndex[entry.analysis.category] || [];
    index.categoryIndex[entry.analysis.category] = categoryEntries.filter((id) => id !== entry.id);
    if (index.categoryIndex[entry.analysis.category].length === 0) {
      delete index.categoryIndex[entry.analysis.category];
    }
  }

  // Remove from date index
  const dateKey = entry.timestamp.substring(0, 7); // YYYY-MM
  if (index.dateIndex[dateKey]) {
    index.dateIndex[dateKey] = index.dateIndex[dateKey].filter((id) => id !== entry.id);
    if (index.dateIndex[dateKey].length === 0) {
      delete index.dateIndex[dateKey];
    }
  }

  // Remove from size index
  const sizeRange = getSizeRange(entry.fileSize);
  if (index.sizeIndex[sizeRange]) {
    index.sizeIndex[sizeRange] = index.sizeIndex[sizeRange].filter((id) => id !== entry.id);
    if (index.sizeIndex[sizeRange].length === 0) {
      delete index.sizeIndex[sizeRange];
    }
  }
}

module.exports = {
  createEmptyIndex,
  generateFileHash,
  getSizeRange,
  updateIndexes,
  removeFromIndexes
};
