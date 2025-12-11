/**
 * Path Sanitization Utilities
 * Provides secure path validation and sanitization for database storage
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// Import centralized security configuration
const {
  MAX_PATH_LENGTHS,
  MAX_PATH_DEPTH,
  RESERVED_WINDOWS_NAMES,
  PROTOTYPE_POLLUTION_KEYS,
  ALLOWED_METADATA_FIELDS,
  getDangerousPaths
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
  const pathParts = normalized.split(path.sep).filter((part) => part.length > 0);
  if (pathParts.length > MAX_PATH_DEPTH) {
    throw new Error(
      `Invalid path: path depth (${pathParts.length}) exceeds maximum (${MAX_PATH_DEPTH})`
    );
  }

  // 7. Check for reserved Windows filenames (case-insensitive)
  if (platform === 'win32') {
    for (const part of pathParts) {
      const nameWithoutExt = path.parse(part).name.toUpperCase();
      if (RESERVED_WINDOWS_NAMES.has(nameWithoutExt)) {
        throw new Error(`Invalid path: reserved Windows filename detected: ${nameWithoutExt}`);
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

/**
 * Check if a path is within allowed base directories
 *
 * @param {string} targetPath - The resolved absolute path to check
 * @param {string[]} allowedBasePaths - Array of allowed base directory paths
 * @returns {boolean} True if path is within allowed directories
 */
function isPathWithinAllowed(targetPath, allowedBasePaths) {
  if (!targetPath || !Array.isArray(allowedBasePaths)) {
    return false;
  }

  const normalizedTarget = path.normalize(targetPath).toLowerCase();

  for (const basePath of allowedBasePaths) {
    if (!basePath) continue;
    const normalizedBase = path.normalize(basePath).toLowerCase();

    // Check if target starts with base path
    if (normalizedTarget.startsWith(normalizedBase)) {
      // Ensure it's a proper subdirectory (not just a prefix match)
      const remainder = normalizedTarget.slice(normalizedBase.length);
      if (remainder === '' || remainder.startsWith(path.sep)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a path is in a dangerous system directory
 *
 * @param {string} filePath - Path to check
 * @returns {boolean} True if path is dangerous
 */
function isPathDangerous(filePath) {
  if (!filePath) return true;

  const normalizedPath = path.normalize(filePath).toLowerCase();
  const dangerousPaths = getDangerousPaths();

  for (const dangerous of dangerousPaths) {
    const normalizedDangerous = path.normalize(dangerous).toLowerCase();
    if (normalizedPath.startsWith(normalizedDangerous)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a path is a symbolic link and if so, whether it's safe
 * Returns info about the symlink status and resolved target
 *
 * @param {string} filePath - Path to check
 * @param {string[]} [allowedBasePaths] - Optional allowed base paths for symlink targets
 * @returns {Promise<{isSymlink: boolean, isSafe: boolean, realPath?: string, error?: string}>}
 */
async function checkSymlinkSafety(filePath, allowedBasePaths = null) {
  try {
    const stats = await fs.lstat(filePath);

    if (!stats.isSymbolicLink()) {
      return { isSymlink: false, isSafe: true };
    }

    // It's a symlink - resolve it and check where it points
    const realPath = await fs.realpath(filePath);

    // Check if resolved path is in dangerous locations
    if (isPathDangerous(realPath)) {
      return {
        isSymlink: true,
        isSafe: false,
        realPath,
        error: 'Symbolic link points to a dangerous system directory'
      };
    }

    // If allowed base paths provided, check resolved path is within them
    if (allowedBasePaths && allowedBasePaths.length > 0) {
      if (!isPathWithinAllowed(realPath, allowedBasePaths)) {
        return {
          isSymlink: true,
          isSafe: false,
          realPath,
          error: 'Symbolic link points outside allowed directories'
        };
      }
    }

    return { isSymlink: true, isSafe: true, realPath };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // Path doesn't exist - that's okay for some operations
      return { isSymlink: false, isSafe: true, error: 'Path does not exist' };
    }
    return {
      isSymlink: false,
      isSafe: false,
      error: `Failed to check symlink: ${error.message}`
    };
  }
}

/**
 * Validate a file path for file operations (move, copy, delete, open)
 * Performs comprehensive security checks including:
 * - Path traversal detection
 * - Dangerous directory detection
 * - Symlink safety (optional)
 * - Allowed directory validation (optional)
 *
 * @param {string} filePath - Path to validate
 * @param {Object} [options] - Validation options
 * @param {string[]} [options.allowedBasePaths] - If provided, path must be within these directories
 * @param {boolean} [options.checkSymlinks=false] - Whether to check symlink safety
 * @param {boolean} [options.requireExists=false] - Whether the path must exist
 * @returns {Promise<{valid: boolean, normalizedPath: string, error?: string}>}
 */
async function validateFileOperationPath(filePath, options = {}) {
  const { allowedBasePaths = null, checkSymlinks = false, requireExists = false } = options;

  // Basic validation
  if (!filePath || typeof filePath !== 'string') {
    return {
      valid: false,
      normalizedPath: '',
      error: 'Invalid path: path must be a non-empty string'
    };
  }

  try {
    // Sanitize the path (removes null bytes, normalizes, checks traversal)
    const sanitized = sanitizePath(filePath);

    // Resolve to absolute path
    const normalizedPath = path.resolve(sanitized);

    // Check for dangerous system directories
    if (isPathDangerous(normalizedPath)) {
      return {
        valid: false,
        normalizedPath,
        error: 'Invalid path: access to system directories is not allowed'
      };
    }

    // Check allowed base paths if provided
    if (allowedBasePaths && allowedBasePaths.length > 0) {
      if (!isPathWithinAllowed(normalizedPath, allowedBasePaths)) {
        return {
          valid: false,
          normalizedPath,
          error: 'Invalid path: path is outside allowed directories'
        };
      }
    }

    // Check symlink safety if requested
    if (checkSymlinks) {
      const symlinkResult = await checkSymlinkSafety(normalizedPath, allowedBasePaths);
      if (!symlinkResult.isSafe) {
        return {
          valid: false,
          normalizedPath,
          error: symlinkResult.error || 'Invalid path: unsafe symbolic link'
        };
      }
    }

    // Check existence if required
    if (requireExists) {
      try {
        await fs.access(normalizedPath);
      } catch {
        return {
          valid: false,
          normalizedPath,
          error: 'Invalid path: file or directory does not exist'
        };
      }
    }

    return { valid: true, normalizedPath };
  } catch (error) {
    return {
      valid: false,
      normalizedPath: '',
      error: error.message || 'Path validation failed'
    };
  }
}

/**
 * Synchronous path validation for simple checks (no symlink or existence checks)
 * Use this when async operations aren't possible
 *
 * @param {string} filePath - Path to validate
 * @param {string[]} [allowedBasePaths] - If provided, path must be within these directories
 * @returns {{valid: boolean, normalizedPath: string, error?: string}}
 */
function validateFileOperationPathSync(filePath, allowedBasePaths = null) {
  if (!filePath || typeof filePath !== 'string') {
    return {
      valid: false,
      normalizedPath: '',
      error: 'Invalid path: path must be a non-empty string'
    };
  }

  try {
    const sanitized = sanitizePath(filePath);
    const normalizedPath = path.resolve(sanitized);

    if (isPathDangerous(normalizedPath)) {
      return {
        valid: false,
        normalizedPath,
        error: 'Invalid path: access to system directories is not allowed'
      };
    }

    if (allowedBasePaths && allowedBasePaths.length > 0) {
      if (!isPathWithinAllowed(normalizedPath, allowedBasePaths)) {
        return {
          valid: false,
          normalizedPath,
          error: 'Invalid path: path is outside allowed directories'
        };
      }
    }

    return { valid: true, normalizedPath };
  } catch (error) {
    return {
      valid: false,
      normalizedPath: '',
      error: error.message || 'Path validation failed'
    };
  }
}

module.exports = {
  sanitizePath,
  isPathSafe,
  sanitizeMetadata,
  // New exports for file operation security
  validateFileOperationPath,
  validateFileOperationPathSync,
  checkSymlinkSafety,
  isPathDangerous,
  isPathWithinAllowed
};
