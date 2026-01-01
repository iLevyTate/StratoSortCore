/**
 * Shared URL normalization utilities
 * Consolidates duplicated URL handling logic from:
 * - src/main/ollamaUtils.js
 * - src/main/ipc/validationSchemas.js
 * - src/shared/settingsValidation.js
 */

/**
 * Check if a URL uses HTTPS protocol
 * @param {string} url - URL to check
 * @returns {boolean} True if URL starts with https://
 */
function isHttps(url) {
  return /^https:\/\//i.test(url);
}

/**
 * Check if a URL has a protocol (http or https)
 * @param {string} url - URL to check
 * @returns {boolean} True if URL has http:// or https:// prefix
 */
function hasProtocol(url) {
  return /^https?:\/\//i.test(url);
}

/**
 * Collapse duplicate protocols (e.g., "http://http://127.0.0.1" -> "http://127.0.0.1")
 * Common from copy-paste errors
 * @param {string} url - URL that may have duplicate protocols
 * @returns {string} URL with single protocol
 */
function collapseDuplicateProtocols(url) {
  if (/^(https?:\/\/){2,}/i.test(url)) {
    const useHttps = isHttps(url);
    return url.replace(/^(https?:\/\/)+/i, useHttps ? 'https://' : 'http://');
  }
  return url;
}

/**
 * Normalize protocol case to lowercase (HTTP:// -> http://)
 * @param {string} url - URL with potentially uppercase protocol
 * @returns {string} URL with lowercase protocol
 */
function normalizeProtocolCase(url) {
  if (hasProtocol(url)) {
    const useHttps = isHttps(url);
    return url.replace(/^https?:\/\//i, useHttps ? 'https://' : 'http://');
  }
  return url;
}

/**
 * Convert Windows-style backslashes to forward slashes
 * Common from Windows path paste errors
 * @param {string} url - URL that may contain backslashes
 * @returns {string} URL with forward slashes only
 */
function normalizeSlashes(url) {
  return url.replace(/\\/g, '/');
}

/**
 * Extract base URL (protocol + host + port) stripping path/query/hash
 * Useful when users paste full API URLs like "http://localhost:11434/api/tags"
 * @param {string} url - Full URL
 * @returns {string} Base URL without path
 */
function extractBaseUrl(url) {
  try {
    const urlForParse = hasProtocol(url) ? url : `http://${url}`;
    const parsed = new URL(urlForParse);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    // If parsing fails, return original
    return url;
  }
}

/**
 * Ensure URL has a protocol, defaulting to http://
 * @param {string} url - URL that may or may not have a protocol
 * @param {string} [defaultProtocol='http'] - Protocol to add if missing ('http' or 'https')
 * @returns {string} URL with protocol
 */
function ensureProtocol(url, defaultProtocol = 'http') {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (hasProtocol(trimmed)) {
    return trimmed;
  }
  return `${defaultProtocol}://${trimmed}`;
}

/**
 * Full URL normalization for service URLs (Ollama, ChromaDB, etc.)
 * Handles common user input issues:
 * - Missing protocol
 * - Duplicate protocols from copy-paste
 * - Windows backslashes
 * - Uppercase protocols
 * - Extra paths/query strings
 *
 * @param {string} url - Raw user input URL
 * @param {Object} [options] - Normalization options
 * @param {string} [options.defaultUrl] - Fallback URL if input is empty
 * @param {boolean} [options.stripPath=false] - Whether to remove path/query/hash
 * @returns {string} Normalized URL
 */
function normalizeServiceUrl(url, options = {}) {
  const { defaultUrl, stripPath = false } = options;

  let result = url || defaultUrl || '';

  if (!result || typeof result !== 'string') {
    return result;
  }

  result = result.trim();
  result = normalizeSlashes(result);
  result = normalizeProtocolCase(result);
  result = collapseDuplicateProtocols(result);
  result = ensureProtocol(result);

  if (stripPath) {
    result = extractBaseUrl(result);
  }

  return result;
}

module.exports = {
  isHttps,
  hasProtocol,
  collapseDuplicateProtocols,
  normalizeProtocolCase,
  normalizeSlashes,
  extractBaseUrl,
  ensureProtocol,
  normalizeServiceUrl
};
