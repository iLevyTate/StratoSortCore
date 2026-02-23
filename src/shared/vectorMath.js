/**
 * Vector Math Utilities
 *
 * Shared math functions for vector operations used across the codebase.
 * Centralizes implementations to avoid duplication.
 *
 * @module shared/vectorMath
 */

const { createLogger } = require('./logger');

const logger = createLogger('vectorMath');

/**
 * Calculate cosine similarity between two vectors
 * Uses loop unrolling (4x) for better CPU cache performance
 *
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity (-1 to 1), or 0 if vectors are invalid
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }

  const len = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;

  // Loop unrolling (4x) for better performance on typical embedding sizes (384, 768, 1024)
  const unrollLimit = len - 3;
  let i = 0;

  for (; i < unrollLimit; i += 4) {
    if (
      isNaN(a[i]) ||
      isNaN(b[i]) ||
      isNaN(a[i + 1]) ||
      isNaN(b[i + 1]) ||
      isNaN(a[i + 2]) ||
      isNaN(b[i + 2]) ||
      isNaN(a[i + 3]) ||
      isNaN(b[i + 3])
    )
      return 0;

    dot += a[i] * b[i] + a[i + 1] * b[i + 1] + a[i + 2] * b[i + 2] + a[i + 3] * b[i + 3];
    normA += a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2] + a[i + 3] * a[i + 3];
    normB += b[i] * b[i] + b[i + 1] * b[i + 1] + b[i + 2] * b[i + 2] + b[i + 3] * b[i + 3];
  }

  // Handle remaining elements
  for (; i < len; i++) {
    if (isNaN(a[i]) || isNaN(b[i])) return 0;
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA < 1e-10 || normB < 1e-10) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Calculate squared Euclidean distance between two vectors
 * More efficient for comparisons (avoids sqrt)
 * Uses loop unrolling (4x) for better CPU cache performance
 *
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Squared Euclidean distance, or Infinity if vectors are invalid
 */
function squaredEuclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return Infinity;
  }

  const len = a.length;
  let sum = 0;

  // Loop unrolling (4x) for better performance on typical embedding sizes
  const unrollLimit = len - 3;
  let i = 0;

  for (; i < unrollLimit; i += 4) {
    const d0 = a[i] - b[i];
    const d1 = a[i + 1] - b[i + 1];
    const d2 = a[i + 2] - b[i + 2];
    const d3 = a[i + 3] - b[i + 3];
    sum += d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3;
  }

  // Handle remaining elements
  for (; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return sum;
}

/**
 * Validate embedding dimensions against expected size
 * @param {number[]} vector - The vector to validate
 * @param {number} expectedDim - Expected dimension (pass null/undefined to skip validation)
 * @returns {boolean} True if valid, false if invalid
 */
function validateEmbeddingDimensions(vector, expectedDim) {
  if (!Array.isArray(vector)) return false;
  // Allow explicitly skipping validation with null/undefined
  if (expectedDim === null || expectedDim === undefined) return true;
  // Invalid expectedDim values (0, negative, non-integer) indicate caller bug - fail validation
  if (!Number.isInteger(expectedDim) || expectedDim <= 0) return false;
  return vector.length === expectedDim;
}

/**
 * Validate embedding vector for NaN, Infinity, and type issues
 * @param {Array<number>} vector - Embedding vector to validate
 * @returns {{ valid: boolean, error?: string, index?: number }}
 */
function validateEmbeddingVector(vector) {
  if (!Array.isArray(vector)) return { valid: false, error: 'not_array' };
  if (vector.length === 0) return { valid: false, error: 'empty_vector' };
  for (let i = 0; i < vector.length; i++) {
    if (!Number.isFinite(vector[i])) {
      return { valid: false, error: 'invalid_value', index: i };
    }
  }
  return { valid: true };
}

// Track dimension mismatch warnings to avoid log spam (warn once per dimension pair)
const _warnedDimPairs = new Set();
const _MAX_WARNED_DIM_PAIRS = 100;
function _warnDimMismatch(actual, expected) {
  const key = `${actual}->${expected}`;
  if (_warnedDimPairs.has(key)) return;
  if (_warnedDimPairs.size >= _MAX_WARNED_DIM_PAIRS) _warnedDimPairs.clear();
  _warnedDimPairs.add(key);
  logger.warn(
    `[vectorMath] Vector dimension mismatch: ${actual} vs ${expected}. Search quality may be degraded. Consider rebuilding embeddings.`
  );
}

/**
 * Pad or truncate a vector to match the expected dimension.
 * - If vector is shorter than expectedDim, pads with zeros
 * - If vector is longer than expectedDim, truncates to expectedDim
 * - Returns null if vector is empty/invalid or expectedDim is invalid
 *
 * FIX: Extracted from ChatService and SearchService to eliminate duplication.
 *
 * @param {number[]} vector - The embedding vector to adjust
 * @param {number|null|undefined} expectedDim - Target dimension (null/undefined/invalid returns vector as-is)
 * @returns {number[]|null} Adjusted vector, original vector if no adjustment needed, or null if invalid
 */
function padOrTruncateVector(vector, expectedDim) {
  if (!Array.isArray(vector) || vector.length === 0) {
    return null;
  }
  // If expectedDim is not a valid positive integer, return vector unchanged
  if (!Number.isInteger(expectedDim) || expectedDim <= 0) {
    return vector;
  }
  // Already correct dimension
  if (vector.length === expectedDim) {
    return vector;
  }
  // Pad with zeros if too short
  if (vector.length < expectedDim) {
    _warnDimMismatch(vector.length, expectedDim);
    return vector.concat(new Array(expectedDim - vector.length).fill(0));
  }
  // Truncate if too long
  _warnDimMismatch(vector.length, expectedDim);
  return vector.slice(0, expectedDim);
}

module.exports = {
  cosineSimilarity,
  squaredEuclideanDistance,
  validateEmbeddingDimensions,
  validateEmbeddingVector,
  padOrTruncateVector
};
