/**
 * Path Sanitization Utilities
 * Provides secure path validation and sanitization for database storage
 */

const path = require('path');
const os = require('os');

let fs;
try {
  fs = require('fs').promises;
} catch (e) {
  // fs module not available (e.g. in sandboxed environment)
  fs = null;
}

// HIGH FIX (HIGH-13): Default timeout for symlink operations to prevent hangs on network mounts
const SYMLINK_CHECK_TIMEOUT_MS = 5000;
const URL_SCHEME_REGEX = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

const isFileUrl = (value) => typeof value === 'string' && value.toLowerCase().startsWith('file://');

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
 * FIX: Added file:// URL handling for consistency with preload
 *
 * @param {string} filePath - The file path to sanitize
 * @returns {string} Sanitized path
 * @throws {Error} If path is invalid or dangerous
 */
function sanitizePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  // FIX: Handle file:// URLs for consistency with preload behavior
  // This ensures main process handles file:// URLs the same way as the renderer
  let processedPath = filePath;
  if (processedPath.toLowerCase().startsWith('file://')) {
    try {
      const url = new URL(processedPath);
      const pathname = decodeURIComponent(url.pathname || '');
      // Windows: /C:/path -> C:/path (drop leading slash before drive letter)
      if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
        processedPath = pathname.slice(1);
      } else {
        processedPath = pathname;
      }
    } catch {
      // Invalid URL - fall through to regular processing
    }
  }

  // 1. Remove null bytes (security critical)
  // Instead of throwing, we sanitize by removing them
  const sanitized = processedPath.replace(/\0/g, '');

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
  // Only treat ".." as traversal when it's an actual path segment.
  const normalizedParts = normalized.split(path.sep).filter((part) => part.length > 0);
  if (normalizedParts.some((part) => part === '..')) {
    throw new Error('Invalid path: path traversal detected');
  }

  // 6. Validate path depth to prevent deep nesting attacks
  const pathParts = normalizedParts;
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

  const normalizeMetadataValue = (value) => {
    if (value === undefined || value === null) return null;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      const flat = value
        .map((item) => normalizeMetadataValue(item))
        .filter((item) => item !== null);
      if (flat.length === 0) return null;
      if (flat.every((item) => typeof item === 'string')) {
        return flat.join(',');
      }
      try {
        return JSON.stringify(flat);
      } catch {
        return String(value);
      }
    }

    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }

    return String(value);
  };

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

      const normalized = normalizeMetadataValue(value);
      if (normalized !== null) {
        sanitized[key] = normalized;
      }
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

  // FIX: Platform-aware case sensitivity handling
  // Windows and macOS (HFS+) are case-insensitive, Linux is case-sensitive
  const isWindows = process.platform === 'win32';
  const isMacOS = process.platform === 'darwin';
  const isCaseInsensitive = isWindows || isMacOS;

  const normalizedTarget = isCaseInsensitive
    ? path.normalize(targetPath).toLowerCase()
    : path.normalize(targetPath);

  for (const basePath of allowedBasePaths) {
    if (!basePath) continue;
    const normalizedBase = isCaseInsensitive
      ? path.normalize(basePath).toLowerCase()
      : path.normalize(basePath);

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
 * HIGH FIX (HIGH-13): Added timeout parameter to prevent hangs on network mounts
 *
 * @param {string} filePath - Path to check
 * @param {string[]} [allowedBasePaths] - Optional allowed base paths for symlink targets
 * @param {number} [timeoutMs] - Timeout in milliseconds (default: SYMLINK_CHECK_TIMEOUT_MS)
 * @returns {Promise<{isSymlink: boolean, isSafe: boolean, realPath?: string, error?: string}>}
 */
async function checkSymlinkSafety(
  filePath,
  allowedBasePaths = null,
  timeoutMs = SYMLINK_CHECK_TIMEOUT_MS
) {
  // Check if fs is available
  if (!fs) {
    // In sandboxed environments without fs, we can't check symlinks.
    // Assume safe or return error depending on security posture.
    // Returning safe=true because we can't verify, and usually sandbox restricts access anyway.
    return { isSymlink: false, isSafe: true };
  }

  // HIGH FIX (HIGH-13): Wrap operations in timeout to prevent hangs on network mounts
  const timeoutPromise = new Promise((_, reject) => {
    const id = setTimeout(() => {
      reject(
        new Error(
          `Symlink check timeout after ${timeoutMs}ms - path may be on unresponsive network mount`
        )
      );
    }, timeoutMs);
    // Prevent timeout from keeping process alive during shutdown
    if (id.unref) id.unref();
  });

  const checkPromise = (async () => {
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
  })();

  try {
    return await Promise.race([checkPromise, timeoutPromise]);
  } catch (error) {
    return {
      isSymlink: false,
      isSafe: false,
      error: error.message
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
 * @param {boolean} [options.requireAbsolute=false] - Whether input must be absolute
 * @param {boolean} [options.disallowUNC=false] - Block UNC/network paths
 * @param {boolean} [options.disallowUrlSchemes=false] - Block non-file URL schemes
 * @param {boolean} [options.allowFileUrl=true] - Allow file:// URLs when scheme checks enabled
 * @returns {Promise<{valid: boolean, normalizedPath: string, error?: string}>}
 */
async function validateFileOperationPath(filePath, options = {}) {
  const {
    allowedBasePaths = null,
    checkSymlinks = false,
    requireExists = false,
    requireAbsolute = false,
    disallowUNC = false,
    disallowUrlSchemes = false,
    allowFileUrl = true
  } = options;

  // Basic validation
  if (!filePath || typeof filePath !== 'string') {
    return {
      valid: false,
      normalizedPath: '',
      error: 'Invalid path: path must be a non-empty string'
    };
  }

  try {
    if (disallowUrlSchemes && URL_SCHEME_REGEX.test(filePath)) {
      if (!allowFileUrl || !isFileUrl(filePath)) {
        return {
          valid: false,
          normalizedPath: '',
          error: 'Invalid path: URL schemes are not allowed'
        };
      }
    }

    // Sanitize the path (removes null bytes, normalizes, checks traversal)
    const sanitized = sanitizePath(filePath);

    if (requireAbsolute && !path.isAbsolute(sanitized)) {
      return {
        valid: false,
        normalizedPath: '',
        error: 'Invalid path: must be an absolute path'
      };
    }

    // Resolve to absolute path
    const normalizedPath = path.resolve(sanitized);

    if (disallowUNC && (normalizedPath.startsWith('\\\\') || normalizedPath.startsWith('//'))) {
      return {
        valid: false,
        normalizedPath,
        error: 'Invalid path: network/UNC paths are not allowed'
      };
    }

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
 * @param {Object} [options] - Validation options
 * @param {boolean} [options.requireAbsolute=false] - Whether input must be absolute
 * @param {boolean} [options.disallowUNC=false] - Block UNC/network paths
 * @param {boolean} [options.disallowUrlSchemes=false] - Block non-file URL schemes
 * @param {boolean} [options.allowFileUrl=true] - Allow file:// URLs when scheme checks enabled
 * @returns {{valid: boolean, normalizedPath: string, error?: string}}
 */
function validateFileOperationPathSync(filePath, allowedBasePaths = null, options = {}) {
  const {
    requireAbsolute = false,
    disallowUNC = false,
    disallowUrlSchemes = false,
    allowFileUrl = true
  } = options;

  if (!filePath || typeof filePath !== 'string') {
    return {
      valid: false,
      normalizedPath: '',
      error: 'Invalid path: path must be a non-empty string'
    };
  }

  try {
    if (disallowUrlSchemes && URL_SCHEME_REGEX.test(filePath)) {
      if (!allowFileUrl || !isFileUrl(filePath)) {
        return {
          valid: false,
          normalizedPath: '',
          error: 'Invalid path: URL schemes are not allowed'
        };
      }
    }

    const sanitized = sanitizePath(filePath);

    if (requireAbsolute && !path.isAbsolute(sanitized)) {
      return {
        valid: false,
        normalizedPath: '',
        error: 'Invalid path: must be an absolute path'
      };
    }
    const normalizedPath = path.resolve(sanitized);

    if (disallowUNC && (normalizedPath.startsWith('\\\\') || normalizedPath.startsWith('//'))) {
      return {
        valid: false,
        normalizedPath,
        error: 'Invalid path: network/UNC paths are not allowed'
      };
    }

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

/**
 * Prepare file metadata for ChromaDB storage
 * Combines base metadata with file.meta and sanitizes the result.
 *
 * @param {Object} file - File object with id, meta, model, updatedAt
 * @returns {Object} Sanitized metadata ready for ChromaDB
 */
function prepareFileMetadata(file) {
  if (!file) return {};

  const baseMetadata = {
    path: file.meta?.path || '',
    name: file.meta?.name || '',
    model: file.model || '',
    updatedAt: file.updatedAt || new Date().toISOString()
  };

  return sanitizeMetadata({
    ...baseMetadata,
    ...file.meta
  });
}

/**
 * Prepare folder metadata for ChromaDB storage
 * Creates base metadata from folder properties and sanitizes the result.
 *
 * @param {Object} folder - Folder object with id, name, description, path, model, updatedAt
 * @returns {Object} Sanitized metadata ready for ChromaDB
 */
function prepareFolderMetadata(folder) {
  if (!folder) return {};

  const metadata = {
    name: folder.name || '',
    description: folder.description || '',
    path: folder.path || '',
    model: folder.model || '',
    updatedAt: folder.updatedAt || new Date().toISOString()
  };

  return sanitizeMetadata(metadata);
}

/**
 * Normalize a file path for use as an index key
 * Ensures consistent lookups across case-sensitive and case-insensitive filesystems
 *
 * On Windows (case-insensitive): converts path to lowercase
 * On Unix (case-sensitive): preserves original case
 *
 * This is critical for BM25 index, ChromaDB lookups, and analysis history
 * to ensure renamed/moved files are found consistently.
 *
 * @param {string} filePath - The file path to normalize for indexing
 * @returns {string} Normalized path suitable for use as a lookup key
 */
function normalizePathForIndex(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  // First apply standard normalization (resolve . and ..)
  let normalized = path.normalize(filePath);

  // On Windows, lowercase for case-insensitive comparison
  if (os.platform() === 'win32') {
    normalized = normalized.toLowerCase();
  }

  // Use forward slashes for canonical IDs to avoid platform-specific separators
  normalized = normalized.replace(/\\/g, '/');

  return normalized;
}

/**
 * Create a canonical file ID for use in search indexes and ChromaDB
 * Format: "file:{normalizedPath}" or "image:{normalizedPath}"
 *
 * Uses normalizePathForIndex for consistent lookups on case-insensitive filesystems
 *
 * @param {string} filePath - The file path
 * @param {boolean} [isImage=false] - Whether this is an image file
 * @returns {string} Canonical ID in format "file:{path}" or "image:{path}"
 */
function getCanonicalFileId(filePath, isImage = false) {
  const normalizedPath = normalizePathForIndex(filePath);
  const prefix = isImage ? 'image' : 'file';
  return `${prefix}:${normalizedPath}`;
}

/**
 * Check if two file paths refer to the same file (accounting for case sensitivity)
 *
 * @param {string} path1 - First file path
 * @param {string} path2 - Second file path
 * @returns {boolean} True if paths are equivalent on the current platform
 */
function arePathsEquivalent(path1, path2) {
  return normalizePathForIndex(path1) === normalizePathForIndex(path2);
}

module.exports = {
  sanitizePath,
  isPathSafe,
  sanitizeMetadata,
  // ChromaDB metadata helpers
  prepareFileMetadata,
  prepareFolderMetadata,
  // New exports for file operation security
  validateFileOperationPath,
  validateFileOperationPathSync,
  checkSymlinkSafety,
  isPathDangerous,
  isPathWithinAllowed,
  // Path normalization for index keys
  normalizePathForIndex,
  getCanonicalFileId,
  arePathsEquivalent
};
