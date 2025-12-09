/**
 * Safe access utilities to prevent null reference errors.
 *
 * @module main/utils/safeAccess
 */

/**
 * Safely access and validate file path
 * @param {string} filePath - Path to validate
 * @returns {string|null} Valid path or null
 */
function safeFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return null;
  }

  // Remove any null bytes or control characters
  const cleanPath = filePath.replace(/\0/g, '').trim();

  if (!cleanPath || cleanPath.length === 0) {
    return null;
  }

  return cleanPath;
}

module.exports = {
  safeFilePath,
};
