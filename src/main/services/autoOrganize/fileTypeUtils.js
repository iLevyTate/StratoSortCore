/**
 * File Type Utilities
 *
 * Utilities for file type categorization and sanitization.
 *
 * @module autoOrganize/fileTypeUtils
 */

/**
 * File type categories with their extensions
 */
const FILE_TYPE_CATEGORIES = {
  documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
  spreadsheets: ['xls', 'xlsx', 'csv', 'ods'],
  presentations: ['ppt', 'pptx', 'odp'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp'],
  videos: ['mp4', 'avi', 'mov', 'wmv', 'flv'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a'],
  code: ['js', 'py', 'java', 'cpp', 'html', 'css'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz']
};

/**
 * Get file type category from extension
 * @param {string} extension - File extension
 * @returns {string} File type category
 */
function getFileTypeCategory(extension) {
  const ext = extension.toLowerCase().replace('.', '');

  for (const [category, extensions] of Object.entries(FILE_TYPE_CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    }
  }

  return 'Files';
}

/**
 * Sanitize file object for IPC transmission
 * Removes large data and circular references
 * @param {Object} file - File object to sanitize
 * @returns {Object|null} Sanitized file object
 */
function sanitizeFile(file) {
  if (!file) return null;

  // Create a clean lightweight copy
  return {
    name: file.name,
    path: file.path,
    size: file.size,
    extension: file.extension,
    type: file.type,
    // Only include essential analysis data if present
    analysis: file.analysis
      ? {
          category: file.analysis.category,
          suggestedName: file.analysis.suggestedName,
          confidence: file.analysis.confidence,
          summary: file.analysis.summary
        }
      : null
  };
}

module.exports = {
  FILE_TYPE_CATEGORIES,
  getFileTypeCategory,
  sanitizeFile
};
