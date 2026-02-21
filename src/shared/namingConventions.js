/**
 * Shared Naming Conventions
 *
 * Common formatting utilities used by both main-process and renderer naming modules.
 *
 * @module shared/namingConventions
 */

/**
 * Format a date according to the specified format
 * @param {Date} date - Date to format
 * @param {string} format - Date format string
 * @returns {string} Formatted date
 */
function formatDate(date, format) {
  // Use UTC to avoid timezone-dependent date drift (e.g., near midnight causing off-by-one days)
  // This keeps filenames stable and aligns with ISO-8601 date expectations in tests and exports.
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'MM-DD-YYYY':
      return `${month}-${day}-${year}`;
    case 'DD-MM-YYYY':
      return `${day}-${month}-${year}`;
    case 'YYYYMMDD':
      return `${year}${month}${day}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * Apply case convention to text
 * @param {string} text - Text to transform
 * @param {string} convention - Case convention to apply
 * @returns {string} Transformed text
 */
function applyCaseConvention(text, convention) {
  switch (convention) {
    case 'kebab-case':
      // characters (Chinese, Arabic, Cyrillic, etc). The old [^a-z0-9] stripped
      // everything non-ASCII, producing empty filenames like '.pdf'.
      return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-|-$/g, '');
    case 'snake_case':
      return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '_')
        .replace(/^_|_$/g, '');
    case 'camelCase':
      return text
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .map((word, index) =>
          index === 0
            ? word.toLowerCase()
            : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join('');
    case 'PascalCase':
      return text
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
    case 'lowercase':
      return text.toLowerCase();
    case 'UPPERCASE':
      return text.toUpperCase();
    default:
      return text;
  }
}

/**
 * Generate a preview name based on naming convention settings
 * @param {string} originalName - Original filename
 * @param {Object} settings - Naming settings
 * @param {string} settings.convention - Naming convention
 * @param {string} settings.separator - Separator character
 * @param {string} settings.dateFormat - Date format
 * @param {string} settings.caseConvention - Case convention
 * @returns {string} Preview name
 */
function generatePreviewName(originalName, settings) {
  const { convention, separator, dateFormat, caseConvention } = settings;

  const baseName = originalName.replace(/\.[^/.]+$/, '');
  const dotIdx = originalName.lastIndexOf('.');
  const extension = dotIdx > 0 ? originalName.slice(dotIdx) : '';
  const today = new Date();

  const applyCasing = (text) => (caseConvention ? applyCaseConvention(text, caseConvention) : text);
  const formattedBaseName = applyCasing(baseName);
  const dateStr = formatDate(today, dateFormat);

  let previewName;
  switch (convention) {
    case 'subject-date':
      previewName = `${formattedBaseName}${separator}${dateStr}`;
      break;
    case 'date-subject':
      previewName = `${dateStr}${separator}${formattedBaseName}`;
      break;
    case 'project-subject-date':
      previewName = `${applyCasing('project')}${separator}${formattedBaseName}${separator}${dateStr}`;
      break;
    case 'category-subject':
      previewName = `${applyCasing('category')}${separator}${formattedBaseName}`;
      break;
    case 'keep-original':
      previewName = baseName;
      // Do not apply case convention to keep-original
      return previewName + extension;
    default:
      previewName = formattedBaseName;
  }

  return previewName + extension;
}

/**
 * Extract extension from filename
 * @param {string} fileName - Filename to parse
 * @returns {string} Extension with dot prefix
 */
function extractExtension(fileName) {
  const dotIdx = fileName.lastIndexOf('.');
  return dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase() : '';
}

/**
 * Extract filename from path
 * @param {string} filePath - Full file path
 * @returns {string} Filename
 */
function extractFileName(filePath) {
  return filePath.split(/[\\/]/).pop();
}

/**
 * Ensure a filename is unique within a set by appending a numeric suffix before the extension.
 *
 * Example:
 * - "photo.jpg" -> "photo.jpg"
 * - "photo.jpg" again -> "photo-2.jpg"
 * - "photo.jpg" again -> "photo-3.jpg"
 *
 * Uniqueness is case-insensitive.
 *
 * @param {string} desiredName - Desired filename (may include extension)
 * @param {Map<string, number>} usedCounts - Map keyed by lowercased full filename to count
 * @returns {string} Unique filename
 */
function makeUniqueFileName(desiredName, usedCounts) {
  const raw = String(desiredName || '').trim();
  if (!raw) return '';

  const key = raw.toLowerCase();
  const prevCount = usedCounts.get(key) || 0;
  if (prevCount === 0) {
    usedCounts.set(key, 1);
    return raw;
  }

  // Split extension (only last dot, allow up to 10-char extensions like .markdown, .geojson)
  const dotIdx = raw.lastIndexOf('.');
  const hasExt = dotIdx > 0 && dotIdx > raw.length - 11;
  const base = hasExt ? raw.slice(0, dotIdx) : raw;
  const ext = hasExt ? raw.slice(dotIdx) : '';

  let n = prevCount + 1;
  // Find the first unused candidate
  for (let attempts = 0; attempts < 10000; attempts += 1) {
    const candidate = `${base}-${n}${ext}`;
    const candidateKey = candidate.toLowerCase();
    if (!usedCounts.has(candidateKey)) {
      usedCounts.set(key, n); // track latest for the original key
      usedCounts.set(candidateKey, 1);
      return candidate;
    }
    n += 1;
  }

  // Extremely unlikely unless usedCounts was pre-populated with a huge contiguous range.
  // Return the raw name rather than hanging.
  return raw;
}

module.exports = {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  extractExtension,
  extractFileName,
  makeUniqueFileName
};
