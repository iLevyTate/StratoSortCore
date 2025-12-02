/**
 * Path Sanitization Utilities
 * Provides secure path validation and sanitization for database storage
 */

const path = require('path');
const os = require('os');

// Import centralized security configuration
const {
  MAX_PATH_LENGTHS,
  MAX_PATH_DEPTH,
  RESERVED_WINDOWS_NAMES,
  PROTOTYPE_POLLUTION_KEYS,
  ALLOWED_METADATA_FIELDS,
} = require('./securityConfig');

/**
 * Sanitize a file path for safe storage in database
 * Prevents directory traversal and normalizes path format
 *
 * @param {string} filePath - The file path to sanitize
 * @returns {string} Sanitized path
 * @throws {Error} If path is invalid or dangerous
 */
function sanitizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  // 1. Remove null bytes (security critical)
  // Instead of throwing, we sanitize by removing them
  let sanitized = filePath.replace(/\0/g, '');

  // 2. Unicode normalization (NFD to NFC for consistency)
  // This helps prevent homograph attacks and ensures consistent encoding
  let normalized = sanitized.normalize('NFC');

  // 3. Handle path length limits
  const platform = os.platform();
  const maxLength = MAX_PATH_LENGTHS[platform] || MAX_PATH_LENGTHS.linux;
  if (normalized.length > maxLength) {
    // Truncate the path if it's too long instead of throwing
    // Try to preserve the file extension if possible
    const ext = path.extname(normalized);
    const truncateLength = maxLength - ext.length;
    if (truncateLength > 0) {
      normalized = normalized.substring(0, truncateLength) + ext;
    } else {
      normalized = normalized.substring(0, maxLength);
    }
  }

  // 4. Normalize the path first (resolves .., ., etc.)
  normalized = path.normalize(normalized);

  // 5. Check for path traversal attempts AFTER normalization
  // This catches any remaining .. that weren't resolved
  if (normalized.includes('..')) {
    throw new Error('Invalid path: path traversal detected');
  }

  // 6. Validate path depth to prevent deep nesting attacks
  const pathParts = normalized
    .split(path.sep)
    .filter((part) => part.length > 0);
  if (pathParts.length > MAX_PATH_DEPTH) {
    throw new Error(
      `Invalid path: path depth (${pathParts.length}) exceeds maximum (${MAX_PATH_DEPTH})`,
    );
  }

  // 7. Check for reserved Windows filenames (case-insensitive)
  if (platform === 'win32') {
    for (const part of pathParts) {
      const nameWithoutExt = path.parse(part).name.toUpperCase();
      if (RESERVED_WINDOWS_NAMES.has(nameWithoutExt)) {
        throw new Error(
          `Invalid path: reserved Windows filename detected: ${nameWithoutExt}`,
        );
      }
    }
  }

  // 8. Ensure it's an absolute path for consistency
  if (!path.isAbsolute(normalized)) {
    // For relative paths, we just normalize them
    // The calling code should handle making them absolute if needed
    return normalized;
  }

  return normalized;
}

/**
 * Validate that a path is safe for database storage
 *
 * @param {string} filePath - The file path to validate
 * @returns {boolean} True if path is safe
 */
function isPathSafe(filePath) {
  try {
    sanitizePath(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize metadata object, filtering out dangerous or unnecessary fields
 *
 * @param {Object} metadata - Metadata object to sanitize
 * @param {Array<string>} allowedFields - List of allowed field names
 * @returns {Object} Sanitized metadata
 */
function sanitizeMetadata(metadata, allowedFields = null) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const sanitized = {};

  // Use centralized config for allowed metadata fields
  const allowed = allowedFields || ALLOWED_METADATA_FIELDS;

  for (const [key, value] of Object.entries(metadata)) {
    // Skip if not in allowed list
    if (!allowed.includes(key)) {
      continue;
    }

    // Skip dangerous keys using centralized config
    if (PROTOTYPE_POLLUTION_KEYS.includes(key)) {
      continue;
    }

    // Sanitize path fields
    if (key === 'path' && typeof value === 'string') {
      try {
        sanitized[key] = sanitizePath(value);
      } catch (error) {
        // For paths that are invalid due to traversal attempts or other security issues,
        // we skip them entirely. But null bytes are now sanitized, not thrown.
        continue;
      }
    }
    // Copy other allowed fields
    else if (value !== undefined && value !== null) {
      // Prevent storing functions or objects with methods
      if (typeof value === 'function') {
        continue;
      }

      sanitized[key] = value;
    }
  }

  return sanitized;
}

module.exports = {
  sanitizePath,
  isPathSafe,
  sanitizeMetadata,
};
