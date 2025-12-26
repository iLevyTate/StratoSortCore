/**
 * Browser-compatible path utilities for renderer
 */

/**
 * Extract the basename (filename) from a path string.
 * Works with both forward and backslash separators.
 *
 * @param {string} p - Path string
 * @returns {string} The basename or empty string if invalid
 */
export function safeBasename(p) {
  if (typeof p !== 'string') return '';
  const normalized = p.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}
