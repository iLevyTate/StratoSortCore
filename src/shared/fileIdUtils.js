/**
 * File ID Utilities
 *
 * Centralized utilities for generating consistent semantic file IDs.
 * Used across SearchService, OrganizationSuggestionService, and DownloadWatcher.
 *
 * @module shared/fileIdUtils
 */

const path = require('path');
const { SUPPORTED_IMAGE_EXTENSIONS } = require('./constants');

/**
 * Generate a semantic file ID for ChromaDB storage
 * Format: "image:{path}" for images, "file:{path}" for other files
 *
 * @param {string} filePath - The file path
 * @returns {string} Semantic file ID
 */
function getSemanticFileId(filePath) {
  const safePath = typeof filePath === 'string' ? filePath : '';
  const ext = (path.extname(safePath) || '').toLowerCase();
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  return `${isImage ? 'image' : 'file'}:${safePath}`;
}

/**
 * Strip the semantic prefix from a file ID to get the path
 *
 * @param {string} fileId - Semantic file ID (e.g., "file:/path/to/file.txt")
 * @returns {string} File path without prefix
 */
function stripSemanticPrefix(fileId) {
  return typeof fileId === 'string' ? fileId.replace(/^(file|image):/, '') : '';
}

/**
 * Check if a path is an image based on extension
 *
 * @param {string} filePath - File path to check
 * @returns {boolean} True if file is an image
 */
function isImagePath(filePath) {
  const safePath = typeof filePath === 'string' ? filePath : '';
  const ext = (path.extname(safePath) || '').toLowerCase();
  return SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
}

module.exports = {
  getSemanticFileId,
  stripSemanticPrefix,
  isImagePath
};
