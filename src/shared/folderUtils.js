/**
 * Folder Utilities
 *
 * Shared utilities for folder mapping and category extraction.
 * Used across analysis and organization modules.
 *
 * @module shared/folderUtils
 */

/**
 * Ensure value is an array (internal helper)
 * @param {*} val - Value to check
 * @returns {Array} The value as an array, or empty array if not array-like
 */
function ensureArray(val) {
  if (Array.isArray(val)) return val;
  if (val == null) return [];
  return [val];
}

/**
 * Safely get a property with default value (internal helper)
 * @param {Object} obj - Object to access
 * @param {string} key - Property key
 * @param {*} defaultVal - Default value if property doesn't exist
 * @returns {*} The property value or default
 */
function safeGet(obj, key, defaultVal) {
  if (obj == null || typeof obj !== 'object') return defaultVal;
  const val = obj[key];
  return val !== undefined && val !== null ? val : defaultVal;
}

/**
 * Filter folders to get only custom/valid folders (internal helper)
 * @param {Array} folders - Array of folder objects
 * @returns {Array} Filtered array of custom folders
 */
function filterCustomFolders(folders) {
  return ensureArray(folders).filter((f) => f && (!f.isDefault || f.path));
}

/**
 * Map folders to category objects with standardized structure.
 * This extracts the essential folder information for analysis context.
 *
 * @param {Array} folders - Array of folder objects
 * @param {Object} options - Mapping options
 * @param {boolean} [options.includeId=true] - Include folder id in output
 * @param {number} [options.nameMax] - Max length for name (truncate if set)
 * @param {number} [options.descriptionMax] - Max length for description (truncate if set)
 * @param {number} [options.limit] - Max number of folders to return
 * @returns {Array<{name: string, description: string, id?: string|null}>}
 */
function mapFoldersToCategories(folders, options = {}) {
  const { includeId = true, nameMax, descriptionMax, limit } = options;

  let customFolders = filterCustomFolders(folders);

  // Apply limit if specified
  if (limit && limit > 0) {
    customFolders = customFolders.slice(0, limit);
  }

  return customFolders.map((f) => {
    let name = safeGet(f, 'name', 'Unknown');
    let description = safeGet(f, 'description', '');

    // Apply truncation if specified
    if (nameMax && typeof name === 'string') {
      name = name.trim().slice(0, nameMax);
    }
    if (descriptionMax && typeof description === 'string') {
      description = description.trim().slice(0, descriptionMax);
    }

    const result = { name, description };

    if (includeId) {
      result.id = safeGet(f, 'id', null);
    }

    return result;
  });
}

/**
 * Get folder names as a comma-separated string for logging
 * @param {Array} folderCategories - Array of category objects
 * @returns {string} Comma-separated folder names
 */
function getFolderNamesString(folderCategories) {
  return ensureArray(folderCategories)
    .map((f) => f?.name || 'Unknown')
    .join(', ');
}

module.exports = {
  mapFoldersToCategories,
  getFolderNamesString,
};
