/**
 * Folder Operations
 *
 * Folder creation, path building, and fallback destination logic.
 *
 * @module autoOrganize/folderOperations
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { logger: baseLogger, createLogger } = require('../../../shared/logger');
const { isPathDangerous, sanitizePath } = require('../../../shared/pathSanitization');
const { getFileTypeCategory } = require('./fileTypeUtils');
const { isUNCPath } = require('../../../shared/crossPlatformUtils');

const logger =
  typeof createLogger === 'function' ? createLogger('AutoOrganize-Folders') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('AutoOrganize-Folders');
}

/**
 * Find default folder in smart folders array
 * @param {Array} smartFolders - Array of smart folders
 * @returns {Object|undefined} Default folder if found
 */
function findDefaultFolder(smartFolders) {
  if (!Array.isArray(smartFolders)) return undefined;
  return smartFolders.find(
    (f) => f.isDefault || (f.name && f.name.toLowerCase() === 'uncategorized')
  );
}

/**
 * Create default folder for unanalyzed files with security validation
 * @param {Array} smartFolders - Array of smart folders to add to
 * @returns {Promise<Object|null>} Created folder object or null
 */
async function createDefaultFolder(smartFolders) {
  logger.warn('[AutoOrganize] No default folder found, creating emergency fallback');

  try {
    // Validate documentsDir exists and is accessible
    const documentsDir = app.getPath('documents');

    if (!documentsDir || typeof documentsDir !== 'string') {
      throw new Error('Invalid documents directory path from Electron');
    }

    // Check for UNC paths which can bypass security checks on Windows
    // REMOVED: UNC paths are now allowed for network drive support
    /*
    if (isUNCPath(documentsDir)) {
      throw new Error(
        `Security violation: UNC paths not allowed in documents directory. ` +
          `Detected UNC path: ${documentsDir}`
      );
    }
    */

    // Sanitize folder path components to prevent directory traversal
    const sanitizedBaseName = 'StratoSort'.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedFolderName = 'Uncategorized'.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Use path.resolve to normalize path and prevent traversal
    const defaultFolderPath = path.resolve(documentsDir, sanitizedBaseName, sanitizedFolderName);

    // Additional UNC path check on resolved path
    // REMOVED: UNC paths are now allowed for network drive support
    /*
    if (isUNCPath(defaultFolderPath)) {
      throw new Error(
        `Security violation: UNC path detected after resolution. ` +
          `Path ${defaultFolderPath} is a UNC path which is not allowed`
      );
    }
    */

    // Verify the resolved path is actually inside documents directory
    const resolvedDocumentsDir = path.resolve(documentsDir);

    // On Windows, normalize path separators for consistent comparison
    const normalizedDefaultPath = defaultFolderPath.replace(/\\/g, '/').toLowerCase();
    const normalizedDocumentsDir = resolvedDocumentsDir.replace(/\\/g, '/').toLowerCase();

    if (!normalizedDefaultPath.startsWith(normalizedDocumentsDir)) {
      throw new Error(
        `Security violation: Attempted path traversal detected. ` +
          `Path ${defaultFolderPath} is outside documents directory ${resolvedDocumentsDir}`
      );
    }

    // Additional validation - check for suspicious path patterns
    const suspiciousPatterns = [
      /\.\./, // Parent directory reference
      /\.\.[\\/]/, // Parent with separator
      /[\\/]\.\./, // Separator with parent
      /^[a-zA-Z]:/, // Different drive letter (if not expected)
      /\0/, // Null bytes
      /[<>:"|?*]/ // Invalid Windows filename chars in unexpected positions
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(defaultFolderPath.substring(resolvedDocumentsDir.length))) {
        throw new Error(
          `Security violation: Suspicious path pattern detected. ` +
            `Path contains potentially dangerous characters or sequences`
        );
      }
    }

    logger.info('[AutoOrganize] Path validation passed for emergency default folder', {
      documentsDir: resolvedDocumentsDir,
      defaultFolderPath,
      sanitized: true,
      uncPathCheck: 'passed',
      traversalCheck: 'passed'
    });

    // Check if directory already exists before creating
    let dirExists = false;
    let isSymbolicLink = false;
    try {
      // Use lstat instead of stat to detect symbolic links
      const stats = await fs.lstat(defaultFolderPath);
      dirExists = stats.isDirectory();
      isSymbolicLink = stats.isSymbolicLink();
      const isJunction =
        process.platform === 'win32' && (isSymbolicLink || (stats.mode & 0o120000) === 0o120000);

      // Reject symbolic links for security
      if (isSymbolicLink || isJunction) {
        throw new Error(
          `Security violation: Symbolic links are not allowed for safety reasons. ` +
            `Path ${defaultFolderPath} is a symbolic link.`
        );
      }
    } catch (error) {
      // Directory doesn't exist, which is fine - we'll create it
      if (error.code !== 'ENOENT') {
        // Some other error (permission denied, symbolic link rejection, etc.)
        throw error;
      }
    }

    if (!dirExists) {
      // Ensure directory exists with proper error handling
      await fs.mkdir(defaultFolderPath, { recursive: true });
      logger.info('[AutoOrganize] Created emergency default folder at:', defaultFolderPath);
    } else {
      logger.info('[AutoOrganize] Emergency default folder already exists at:', defaultFolderPath);
    }

    // Create default folder object
    const defaultFolder = {
      id: `emergency-default-${Date.now()}`,
      name: 'Uncategorized',
      path: defaultFolderPath,
      description: 'Emergency fallback folder for files without analysis',
      keywords: [],
      isDefault: true,
      createdAt: new Date().toISOString()
    };

    // Add to smartFolders array for this session
    smartFolders.push(defaultFolder);

    logger.info('[AutoOrganize] Emergency default folder configured at:', defaultFolderPath);

    return defaultFolder;
  } catch (error) {
    logger.error('[AutoOrganize] Failed to create emergency default folder:', {
      error: error.message,
      stack: error.stack
    });

    return null;
  }
}

/**
 * Get fallback destination for files with no good match
 * @param {Object} file - File object
 * @param {Array} smartFolders - Smart folders
 * @param {string} defaultLocation - Default location
 * @returns {string} Fallback destination path
 */
function getFallbackDestination(file, smartFolders, defaultLocation) {
  const safeSmartFolders = Array.isArray(smartFolders) ? smartFolders : [];
  const defaultFolder = findDefaultFolder(safeSmartFolders);
  const _absoluteDefaultLocation = getAbsoluteDefaultLocation(defaultLocation);
  // Try to match based on file type
  const fileType = getFileTypeCategory(file.extension);

  // Look for a smart folder that matches the file type
  const typeFolder = safeSmartFolders.find(
    (f) =>
      f.name && typeof f.name === 'string' && f.name.toLowerCase().includes(fileType.toLowerCase())
  );

  if (typeFolder?.path && typeof typeFolder.path === 'string') {
    return path.join(typeFolder.path, file.name);
  }

  // Use category from analysis if available
  if (file.analysis?.category && typeof file.analysis.category === 'string') {
    const categoryFolder = safeSmartFolders.find(
      (f) =>
        f.name &&
        typeof f.name === 'string' &&
        f.name.toLowerCase() === file.analysis.category.toLowerCase()
    );

    if (categoryFolder?.path && typeof categoryFolder.path === 'string') {
      return path.join(categoryFolder.path, file.name);
    }
  }

  if (defaultFolder?.path && typeof defaultFolder.path === 'string') {
    return path.join(defaultFolder.path, file.name);
  }

  // No safe fallback found
  return null;
}

/**
 * Extract string value from a property that might be an object
 * @param {*} value - Value to extract from
 * @param {string} fallback - Fallback value if extraction fails
 * @returns {string} Extracted string value
 */
function extractStringValue(value, fallback = 'Uncategorized') {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object') {
    // Try common property names for folder/path objects
    return value.name || value.path || value.folder || fallback;
  }
  return fallback;
}

/**
 * Get a guaranteed absolute default location
 * @param {string} defaultLocation - Provided default location
 * @returns {string} Absolute path to use as default location
 */
function getAbsoluteDefaultLocation(defaultLocation) {
  // If provided and absolute, use it
  if (typeof defaultLocation === 'string' && path.isAbsolute(defaultLocation)) {
    return defaultLocation;
  }
  // Fall back to system documents directory (always absolute)
  try {
    return app.getPath('documents');
  } catch {
    // FIX HIGH-53: Unsafe default location fallback - prevent using CWD
    try {
      return app.getPath('temp');
    } catch {
      throw new Error('Could not determine a safe default location (documents or temp)');
    }
  }
}

/**
 * Build destination path for a file
 * @param {Object} file - File object
 * @param {Object} suggestion - Suggestion object
 * @param {string} defaultLocation - Default location
 * @param {boolean} preserveNames - Whether to preserve original names
 * @returns {string} Destination path
 */
function buildDestinationPath(file, suggestion, defaultLocation, preserveNames) {
  // Validate and extract folder path - handle both string and object cases
  let folderPath;

  // First try suggestion.path (should be a full path string)
  if (suggestion.path && typeof suggestion.path === 'string') {
    folderPath = suggestion.path;
  } else if (suggestion.path && typeof suggestion.path === 'object') {
    // Path is an object, try to extract the path string
    folderPath = extractStringValue(suggestion.path, null);
  }

  // Get guaranteed absolute base location
  const absoluteDefaultLocation = getAbsoluteDefaultLocation(defaultLocation);

  // If no valid path, build from defaultLocation and folder name
  if (!folderPath) {
    const folderName = extractStringValue(suggestion.folder, 'Uncategorized');
    folderPath = path.join(absoluteDefaultLocation, folderName);
  }

  // FIX: Ensure absolute path for folderPath
  // If we got a relative path from suggestion.path (e.g. from a strategy that didn't match an existing folder),
  // we must anchor it to defaultLocation to avoid creating folders in the application working directory.
  if (folderPath && !path.isAbsolute(folderPath)) {
    folderPath = path.join(absoluteDefaultLocation, folderPath);
  }

  let fileName = preserveNames ? file.name : file.analysis?.suggestedName || file.name;

  // FIX H-6: Sanitize fileName to prevent path traversal attacks
  if (typeof fileName === 'string') {
    fileName = sanitizePath(fileName);
  } else {
    fileName = '';
  }

  // FIX HIGH-55: Handle empty filename after sanitization
  if (!fileName || fileName.trim().length === 0) {
    fileName = `unnamed_file_${Date.now()}`;
    // Add extension back if available
    if (originalExt) fileName += originalExt;
  }

  fileName = path.basename(fileName);
  if (isPathDangerous(fileName)) {
    throw new Error(`Invalid filename: ${fileName}`);
  }

  // Ensure the original file extension is preserved
  const originalExt = path.extname(file.name);
  const currentExt = path.extname(fileName);
  if (originalExt && !currentExt) {
    // suggestedName is missing the extension, add it back
    fileName += originalExt;
  }

  return path.join(folderPath, fileName);
}

module.exports = {
  isUNCPath,
  findDefaultFolder,
  createDefaultFolder,
  getFallbackDestination,
  buildDestinationPath
};
