/**
 * Unified Text Normalization Primitives
 *
 * This module consolidates text normalization logic that was previously
 * scattered across:
 * - documentLlm.js:60-76 (normalizeTextForModel)
 * - documentExtractors.js (various cleanup functions)
 * - analysisTextUtils.js (storage normalization)
 *
 * @module analysis/textNormalization
 */

const { logger } = require('../../shared/logger');

logger.setContext('TextNormalization');

/**
 * Clean text content by removing null bytes and normalizing whitespace
 *
 * @param {string} text - Input text to clean
 * @returns {string} Cleaned text
 *
 * @example
 * cleanTextContent('Hello\u0000World  with\ttabs')
 * // Returns: 'Hello World with tabs'
 */
function cleanTextContent(text) {
  if (!text) return '';

  let result = String(text);

  // Remove null bytes (can cause issues with JSON, databases, etc.)
  // eslint-disable-next-line no-control-regex
  result = result.replace(/\u0000/g, ' ');

  // Collapse horizontal whitespace (tabs, form feeds, etc.) to single space
  // eslint-disable-next-line no-control-regex
  result = result.replace(/[\t\x0B\f\r]+/g, ' ');

  // Collapse multiple spaces to single space and trim
  result = result.replace(/\s{2,}/g, ' ').trim();

  return result;
}

/**
 * Truncate text with an optional marker to indicate truncation
 *
 * @param {string} text - Input text
 * @param {number} maxLength - Maximum length
 * @param {string} [marker=''] - Optional marker to append (e.g., '...' or '[truncated]')
 * @returns {string} Truncated text
 *
 * @example
 * truncateWithMarker('Hello World', 5, '...')
 * // Returns: 'Hello...'
 */
function truncateWithMarker(text, maxLength, marker = '') {
  if (!text || text.length <= maxLength) return text;

  // If marker is specified, leave room for it
  const truncateAt = marker ? maxLength - marker.length : maxLength;
  const safeLength = Math.max(0, truncateAt);

  return text.slice(0, safeLength) + marker;
}

/**
 * Normalize text for model input by cleaning and truncating
 *
 * CRITICAL: Truncates BEFORE regex operations to prevent buffer overflow
 * on very large strings. Processing large strings with complex regex
 * can cause catastrophic backtracking.
 *
 * @param {string} text - Input text
 * @param {number} maxLength - Maximum length after cleaning
 * @returns {string} Normalized text safe for model input
 *
 * @example
 * normalizeForModel('  Very long text...  ', 100)
 * // Returns cleaned text, max 100 chars
 */
function normalizeForModel(text, maxLength) {
  if (!text) return '';

  let result = String(text);

  // CRITICAL FIX: Truncate BEFORE regex operations to prevent buffer overflow
  // Processing very large strings with complex regex can cause catastrophic backtracking
  if (typeof maxLength === 'number' && maxLength > 0) {
    // First, do a rough truncation at 4x the target to be safe
    // This allows for whitespace collapse that might reduce size
    const roughMax = maxLength * 4;
    if (result.length > roughMax) {
      result = result.slice(0, roughMax);
    }
  }

  // Now safe to apply cleaning operations on bounded text
  result = cleanTextContent(result);

  // Final truncation to exact limit
  if (typeof maxLength === 'number' && maxLength > 0 && result.length > maxLength) {
    result = result.slice(0, maxLength);
  }

  return result;
}

/**
 * Remove control characters from text while preserving newlines
 *
 * @param {string} text - Input text
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.preserveNewlines=true] - Whether to preserve newlines
 * @returns {string} Text with control characters removed
 */
function removeControlCharacters(text, options = {}) {
  if (!text) return '';

  const { preserveNewlines = true } = options;

  if (preserveNewlines) {
    // Remove control chars except newline (\n) and carriage return (\r)
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  // Remove all control characters
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1F\x7F]/g, '');
}

/**
 * Split text into words for analysis
 * Handles various separators and filters empty results
 *
 * @param {string} text - Input text
 * @param {Object} [options={}] - Options
 * @param {number} [options.minWordLength=2] - Minimum word length to include
 * @param {number} [options.maxWords] - Maximum words to return
 * @returns {string[]} Array of words
 */
function splitIntoWords(text, options = {}) {
  if (!text) return [];

  const { minWordLength = 2, maxWords } = options;

  const words = text
    .toLowerCase()
    .split(/[\s_\-./\\,;:!?()[\]{}'"<>]+/)
    .filter((word) => word && word.length >= minWordLength);

  if (maxWords && words.length > maxWords) {
    return words.slice(0, maxWords);
  }

  return words;
}

/**
 * Create a preview/snippet of text for display
 *
 * @param {string} text - Input text
 * @param {number} [maxLength=100] - Maximum length of preview
 * @param {string} [suffix='...'] - Suffix to append if truncated
 * @returns {string} Preview text
 */
function createPreview(text, maxLength = 100, suffix = '...') {
  if (!text) return '';

  const cleaned = cleanTextContent(text);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  // Try to break at a word boundary
  const truncated = cleaned.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + suffix;
  }

  return truncated + suffix;
}

/**
 * Normalize text for storage (used by analysisTextUtils)
 * Removes null bytes and truncates to maximum storable length
 *
 * @param {string} text - Input text
 * @param {number} [maxLength] - Maximum length (defaults to chunking limits)
 * @returns {string|null} Normalized text or null if empty
 */
function normalizeForStorage(text, maxLength) {
  if (typeof text !== 'string') return null;

  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\u0000/g, '').trim();

  if (!cleaned) return null;

  if (typeof maxLength === 'number' && maxLength > 0 && cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }

  return cleaned;
}

module.exports = {
  cleanTextContent,
  truncateWithMarker,
  normalizeForModel,
  removeControlCharacters,
  splitIntoWords,
  createPreview,
  normalizeForStorage
};
