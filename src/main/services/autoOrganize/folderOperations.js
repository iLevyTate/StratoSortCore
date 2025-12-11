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
const { logger } = require('../../../shared/logger');
const { getFileTypeCategory } = require('./fileTypeUtils');

logger.setContext('AutoOrganize-Folders');

/**
 * Check if path is a UNC path (Windows network path)
 * @param {string} p - Path to check
 * @returns {boolean} True if UNC path
 */
function isUNCPath(p) {
  if (!p || typeof p !== 'string') return false;
  return p.startsWith('\\\\') || p.startsWith('//');
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
    if (isUNCPath(documentsDir)) {
      throw new Error(
        `Security violation: UNC paths not allowed in documents directory. ` +
          `Detected UNC path: ${documentsDir}`
      );
    }

    // Sanitize folder path components to prevent directory traversal
    const sanitizedBaseName = 'StratoSort'.replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedFolderName = 'Uncategorized'.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Use path.resolve to normalize path and prevent traversal
    const defaultFolderPath = path.resolve(documentsDir, sanitizedBaseName, sanitizedFolderName);

    // Additional UNC path check on resolved path
    if (isUNCPath(defaultFolderPath)) {
      throw new Error(
        `Security violation: UNC path detected after resolution. ` +
          `Path ${defaultFolderPath} is a UNC path which is not allowed`
      );
    }

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

      // Reject symbolic links for security
      if (isSymbolicLink) {
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
  // Ensure defaultLocation is a valid string
  const safeDefaultLocation = typeof defaultLocation === 'string' ? defaultLocation : 'Documents';

  // Try to match based on file type
  const fileType = getFileTypeCategory(file.extension);

  // Look for a smart folder that matches the file type
  const typeFolder = smartFolders.find(
    (f) =>
      f.name && typeof f.name === 'string' && f.name.toLowerCase().includes(fileType.toLowerCase())
  );

  if (typeFolder) {
    const folderPath =
      typeof typeFolder.path === 'string'
        ? typeFolder.path
        : `${safeDefaultLocation}/${typeFolder.name}`;
    return path.join(folderPath, file.name);
  }

  // Use category from analysis if available
  if (file.analysis?.category && typeof file.analysis.category === 'string') {
    const categoryFolder = smartFolders.find(
      (f) =>
        f.name &&
        typeof f.name === 'string' &&
        f.name.toLowerCase() === file.analysis.category.toLowerCase()
    );

    if (categoryFolder) {
      const folderPath =
        typeof categoryFolder.path === 'string'
          ? categoryFolder.path
          : `${safeDefaultLocation}/${categoryFolder.name}`;
      return path.join(folderPath, file.name);
    }

    // Create new folder based on category
    return path.join(safeDefaultLocation, file.analysis.category, file.name);
  }

  // Ultimate fallback - organize by file type
  return path.join(safeDefaultLocation, fileType, file.name);
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

  // If no valid path, build from defaultLocation and folder name
  if (!folderPath) {
    const folderName = extractStringValue(suggestion.folder, 'Uncategorized');
    const location =
      typeof defaultLocation === 'string'
        ? defaultLocation
        : extractStringValue(defaultLocation, 'Documents');
    folderPath = path.join(location, folderName);
  }

  let fileName = preserveNames ? file.name : file.analysis?.suggestedName || file.name;

  // Ensure the original file extension is preserved
  const originalExt = path.extname(file.name);
  const currentExt = path.extname(fileName);
  if (originalExt && !currentExt) {
    // suggestedName is missing the extension, add it back
    fileName = fileName + originalExt;
  }

  return path.join(folderPath, fileName);
}

module.exports = {
  isUNCPath,
  createDefaultFolder,
  getFallbackDestination,
  buildDestinationPath
};
