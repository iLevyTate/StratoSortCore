/**
 * Safe JSON Operations Utility
 *
 * Provides safe JSON parsing and stringifying operations with fallbacks.
 * For file-based JSON operations, use atomicFile.js instead.
 * For LLM output parsing, use jsonRepair.js instead.
 *
 * @module shared/safeJsonOps
 */

/**
 * Safely parse JSON string with fallback
 *
 * @param {string} text - JSON string to parse
 * @param {*} fallback - Value to return on parse failure (default: null)
 * @returns {*} Parsed value or fallback
 *
 * @example
 * const data = safeParse(jsonString, {});
 * const items = safeParse(itemsJson, []);
 */
// Reviver that strips prototype pollution keys
function _safeReviver(key, value) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    return undefined;
  }
  return value;
}

function safeParse(text, fallback = null) {
  if (text === null || text === undefined) {
    return fallback;
  }

  try {
    return JSON.parse(text, _safeReviver);
  } catch {
    return fallback;
  }
}

/**
 * Safely stringify value with fallback
 *
 * @param {*} value - Value to stringify
 * @param {string} fallback - Value to return on stringify failure (default: null)
 * @param {Object} options - Options
 * @param {boolean} options.pretty - Use pretty printing (default: false)
 * @returns {string|null} JSON string or fallback
 *
 * @example
 * const json = safeStringify(data);
 * const prettyJson = safeStringify(data, null, { pretty: true });
 */
function safeStringify(value, fallback = null, options = {}) {
  const { pretty = false } = options;

  try {
    return pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/**
 * Parse each line of a multi-line string as JSON
 * Returns array of successfully parsed objects, skipping invalid lines
 *
 * @param {string} text - Multi-line JSON string (JSONL format)
 * @returns {Array} Array of parsed objects
 *
 * @example
 * const logs = parseJsonLines(logFileContent);
 */
function parseJsonLines(text) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  const PARSE_FAILED = Symbol('parse_failed');
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line, _safeReviver);
      } catch {
        return PARSE_FAILED;
      }
    })
    .filter((obj) => obj !== PARSE_FAILED);
}

/**
 * Try to parse JSON, returning result and success status
 * Useful when you need to know if parsing failed without using fallback
 *
 * @param {string} text - JSON string to parse
 * @returns {{success: boolean, value: *, error: Error|null}}
 *
 * @example
 * const { success, value, error } = tryParse(jsonString);
 * if (!success) {
 *   logger.warn('Parse failed:', error.message);
 * }
 */
function tryParse(text) {
  if (text === null || text === undefined) {
    return { success: false, value: null, error: new Error('Input is null or undefined') };
  }

  try {
    const value = JSON.parse(text, _safeReviver);
    return { success: true, value, error: null };
  } catch (error) {
    return { success: false, value: null, error };
  }
}

/**
 * Deep clone an object using JSON serialization
 * Note: This will not preserve functions, undefined values, or circular references
 *
 * @param {*} value - Value to clone
 * @param {*} fallback - Value to return on failure
 * @returns {*} Cloned value or fallback
 */
function jsonClone(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value), _safeReviver);
  } catch {
    return fallback;
  }
}

module.exports = {
  safeParse,
  safeStringify,
  parseJsonLines,
  tryParse,
  jsonClone
};
