/**
 * File Type Utilities
 *
 * Utilities for file type categorization and sanitization.
 *
 * @module autoOrganize/fileTypeUtils
 */

/**
 * File type categories with their extensions
 * FIX M-4: Added modern file formats (avif, webm, m4v, heif, opus, mkv, etc.)
 */
const FILE_TYPE_CATEGORIES = {
  documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'pages', 'epub', 'md', 'markdown'],
  spreadsheets: ['xls', 'xlsx', 'csv', 'ods', 'numbers', 'tsv'],
  presentations: ['ppt', 'pptx', 'odp', 'key'],
  images: [
    'jpg',
    'jpeg',
    'png',
    'gif',
    'svg',
    'bmp',
    'webp',
    'tiff',
    'tif',
    'heic',
    'heif',
    'avif',
    'ico',
    'raw',
    'cr2',
    'nef',
    'arw'
  ],
  videos: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mkv', 'mpeg', 'mpg', '3gp', 'ogv'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'opus', 'ogg', 'wma', 'aiff', 'alac'],
  code: [
    'js',
    'ts',
    'jsx',
    'tsx',
    'py',
    'java',
    'cpp',
    'c',
    'h',
    'hpp',
    'html',
    'css',
    'scss',
    'sass',
    'less',
    'go',
    'rs',
    'rb',
    'php',
    'swift',
    'kt',
    'vue',
    'svelte',
    'json',
    'yaml',
    'yml',
    'xml',
    'sql',
    'sh',
    'bash',
    'ps1'
  ],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'dmg', 'iso', 'cab']
};

/**
 * Get file type category from extension
 * @param {string} extension - File extension
 * @returns {string} File type category
 */
function getFileTypeCategory(extension) {
  // Defensive check: ensure extension is a valid string
  if (typeof extension !== 'string' || !extension) {
    return 'Files';
  }

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
