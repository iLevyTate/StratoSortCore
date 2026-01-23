/**
 * File ID Utilities
 *
 * Single source of truth for generating file IDs used in ChromaDB,
 * analysis history, and other path-dependent systems.
 *
 * This consolidates the various ID generation patterns that were
 * previously scattered across:
 * - ollamaDocumentAnalysis.js (file:{normalizedPath})
 * - ollamaImageAnalysis.js (image:{normalizedPath})
 * - fileOperationHandlers.js (buildIdVariants)
 * - FilePathCoordinator.js (buildIdVariants)
 *
 * The main goals are:
 * 1. Consistent ID format across all systems
 * 2. Handle Windows case-insensitivity correctly
 * 3. Generate all possible ID variants for path lookups
 *
 * @module utils/fileIdUtils
 */

const path = require('path');
const { normalizePathForIndex } = require('../../shared/pathSanitization');

/**
 * File type prefixes for embedding IDs
 * @readonly
 * @type {Object}
 */
const FileIdPrefix = {
  FILE: 'file:',
  IMAGE: 'image:',
  CHUNK: 'chunk:'
};

/**
 * Generate a file embedding ID for ChromaDB
 *
 * @param {string} filePath - File path
 * @param {string} [type='file'] - Type prefix ('file', 'image', or 'chunk')
 * @returns {string} File ID in format "type:normalizedPath"
 *
 * @example
 * getFileEmbeddingId('/path/to/doc.pdf', 'file') // => 'file:/path/to/doc.pdf'
 * getFileEmbeddingId('/path/to/image.jpg', 'image') // => 'image:/path/to/image.jpg'
 */
function getFileEmbeddingId(filePath, type = 'file') {
  const normalized = normalizePathForIndex(filePath);
  const prefix =
    type === 'image'
      ? FileIdPrefix.IMAGE
      : type === 'chunk'
        ? FileIdPrefix.CHUNK
        : FileIdPrefix.FILE;
  return `${prefix}${normalized}`;
}

/**
 * Generate a chunk embedding ID for ChromaDB
 *
 * @param {string} filePath - File path
 * @param {number} chunkIndex - Chunk index (0-based)
 * @returns {string} Chunk ID in format "chunk:normalizedPath:index"
 */
function getChunkEmbeddingId(filePath, chunkIndex) {
  const normalized = normalizePathForIndex(filePath);
  return `${FileIdPrefix.CHUNK}${normalized}:${chunkIndex}`;
}

/**
 * Generate all possible path variants for Windows case-insensitivity
 * This ensures we can find ChromaDB entries regardless of how the path was stored
 *
 * @param {string} filePath - File path
 * @returns {string[]} Array of unique path variants
 *
 * @example
 * getPathVariants('C:\\Users\\name\\File.PDF')
 * // => ['c:/users/name/file.pdf', 'C:\\Users\\name\\File.PDF', 'C:/Users/name/File.PDF']
 */
function getPathVariants(filePath) {
  const variants = new Set();

  // Normalized (lowercase on Windows, forward slashes)
  variants.add(normalizePathForIndex(filePath));

  // Original path as-is
  variants.add(filePath);

  // Path.normalize (platform-specific separators)
  variants.add(path.normalize(filePath));

  // Forward slashes only (Unix-style)
  variants.add(path.normalize(filePath).replace(/\\/g, '/'));

  return Array.from(variants).filter(Boolean);
}

/**
 * Generate all possible ID variants for a file path
 * Combines path variants with both file: and image: prefixes
 *
 * @param {string} filePath - File path
 * @param {Object} [options] - Options
 * @param {boolean} [options.includeImages=true] - Include image: prefixed IDs
 * @param {boolean} [options.includeChunks=false] - Include chunk: prefixed IDs (base only)
 * @returns {string[]} Array of all possible IDs for this file
 *
 * @example
 * getAllIdVariants('/path/to/file.pdf')
 * // => ['file:/path/to/file.pdf', 'image:/path/to/file.pdf', ...]
 */
function getAllIdVariants(filePath, options = {}) {
  const { includeImages = true, includeChunks = false } = options;
  const variants = [];
  const pathVariants = getPathVariants(filePath);

  for (const pathVariant of pathVariants) {
    variants.push(`${FileIdPrefix.FILE}${pathVariant}`);

    if (includeImages) {
      variants.push(`${FileIdPrefix.IMAGE}${pathVariant}`);
    }

    if (includeChunks) {
      variants.push(`${FileIdPrefix.CHUNK}${pathVariant}`);
    }
  }

  // Deduplicate
  return [...new Set(variants)];
}

/**
 * Build path update pairs for ChromaDB migration
 * Used when a file is moved or renamed
 *
 * @param {string} oldPath - Original file path
 * @param {string} newPath - New file path
 * @param {Object} [options] - Options
 * @param {Object} [options.newMeta] - New metadata to apply
 * @returns {Array<{oldId: string, newId: string, newMeta: Object}>} Update pairs
 */
function buildPathUpdatePairs(oldPath, newPath, options = {}) {
  const { newMeta = {} } = options;
  const updates = [];
  const seen = new Set();

  const normalizedNew = normalizePathForIndex(newPath);
  const defaultMeta = {
    path: newPath,
    name: path.basename(newPath),
    ...newMeta
  };

  const sourceVariants = getPathVariants(oldPath);

  for (const variant of sourceVariants) {
    const fileOldId = `${FileIdPrefix.FILE}${variant}`;
    const fileNewId = `${FileIdPrefix.FILE}${normalizedNew}`;
    const imageOldId = `${FileIdPrefix.IMAGE}${variant}`;
    const imageNewId = `${FileIdPrefix.IMAGE}${normalizedNew}`;

    const fileKey = `${fileOldId}->${fileNewId}`;
    if (fileOldId !== fileNewId && !seen.has(fileKey)) {
      updates.push({ oldId: fileOldId, newId: fileNewId, newMeta: defaultMeta });
      seen.add(fileKey);
    }

    const imageKey = `${imageOldId}->${imageNewId}`;
    if (imageOldId !== imageNewId && !seen.has(imageKey)) {
      updates.push({ oldId: imageOldId, newId: imageNewId, newMeta: defaultMeta });
      seen.add(imageKey);
    }
  }

  return updates;
}

/**
 * Extract the file path from an embedding ID
 *
 * @param {string} embeddingId - Embedding ID (e.g., 'file:/path/to/file.pdf')
 * @returns {string|null} File path without prefix, or null if invalid
 */
function extractPathFromId(embeddingId) {
  if (!embeddingId || typeof embeddingId !== 'string') {
    return null;
  }

  for (const prefix of Object.values(FileIdPrefix)) {
    if (embeddingId.startsWith(prefix)) {
      return embeddingId.slice(prefix.length);
    }
  }

  return null;
}

/**
 * Get the type (file, image, chunk) from an embedding ID
 *
 * @param {string} embeddingId - Embedding ID
 * @returns {string|null} Type string or null if invalid
 */
function getTypeFromId(embeddingId) {
  if (!embeddingId || typeof embeddingId !== 'string') {
    return null;
  }

  if (embeddingId.startsWith(FileIdPrefix.FILE)) return 'file';
  if (embeddingId.startsWith(FileIdPrefix.IMAGE)) return 'image';
  if (embeddingId.startsWith(FileIdPrefix.CHUNK)) return 'chunk';

  return null;
}

/**
 * Check if an ID matches a given file path (handles variants)
 *
 * @param {string} embeddingId - Embedding ID to check
 * @param {string} filePath - File path to match
 * @returns {boolean} True if the ID refers to this file
 */
function idMatchesPath(embeddingId, filePath) {
  const idPath = extractPathFromId(embeddingId);
  if (!idPath) return false;

  const variants = getPathVariants(filePath);
  return variants.some(
    (v) => v === idPath || normalizePathForIndex(v) === normalizePathForIndex(idPath)
  );
}

module.exports = {
  FileIdPrefix,
  getFileEmbeddingId,
  getChunkEmbeddingId,
  getPathVariants,
  getAllIdVariants,
  buildPathUpdatePairs,
  extractPathFromId,
  getTypeFromId,
  idMatchesPath
};
