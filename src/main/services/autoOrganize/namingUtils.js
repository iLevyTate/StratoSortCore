/**
 * Naming Utilities (Main Process)
 *
 * Utility functions for file naming conventions.
 *
 * @module services/autoOrganize/namingUtils
 */

const { LIMITS } = require('../../../shared/performanceConstants');
const {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  generateSuggestedNameFromAnalysis: buildSuggestedNameFromAnalysis,
  extractExtension,
  extractFileName,
  makeUniqueFileName
} = require('../../../shared/namingConventions');

// Maximum filename length (excluding path) - standard filesystem limit
const MAX_FILENAME_LENGTH = LIMITS?.MAX_FILENAME_LENGTH || 255;

/**
 * Generate a final suggested filename from analysis + naming settings.
 *
 * Unlike generatePreviewName (which is a lightweight UI preview), this uses real
 * analysis fields (date/project/category/suggestedName) so the user's selected
 * naming strategy is actually honored.
 *
 * @param {Object} params - Parameters
 * @param {string} params.originalFileName - Original filename (with extension)
 * @param {Object} params.analysis - Analysis result (may contain date/project/category/suggestedName)
 * @param {Object} params.settings - Naming settings
 * @param {string} params.settings.convention - Naming convention
 * @param {string} params.settings.separator - Separator character
 * @param {string} params.settings.dateFormat - Date format
 * @param {string} params.settings.caseConvention - Case convention
 * @param {Object} [params.fileTimestamps] - Optional file timestamps
 * @returns {string} Suggested filename (with extension preserved)
 */
function generateSuggestedNameFromAnalysis({
  originalFileName,
  analysis,
  settings,
  fileTimestamps
}) {
  const suggestedName = buildSuggestedNameFromAnalysis({
    originalFileName,
    analysis,
    settings,
    fileTimestamps
  });
  return enforceFileNameLength(suggestedName);
}

/**
 * Enforce maximum filename length by truncating the base name if necessary.
 * Preserves the file extension and attempts to break at word boundaries.
 *
 * @param {string} fileName - Full filename (with extension)
 * @param {string} [extension] - File extension (optional, will be extracted if not provided)
 * @returns {string} Filename guaranteed to be within MAX_FILENAME_LENGTH
 */
function enforceFileNameLength(fileName, extension = null) {
  if (!fileName || fileName.length <= MAX_FILENAME_LENGTH) {
    return fileName;
  }

  // Extract extension if not provided
  const ext = extension || (fileName.includes('.') ? `.${fileName.split('.').pop()}` : '');
  const extLength = ext.length;

  // Calculate available space for base name
  // Reserve space for extension and potential suffix like "_truncated"
  const maxBaseLength = MAX_FILENAME_LENGTH - extLength - 1; // -1 for safety margin

  if (maxBaseLength < 10) {
    // Extension is too long, just truncate everything
    return fileName.slice(0, MAX_FILENAME_LENGTH);
  }

  // Get base name (without extension)
  const baseName = ext ? fileName.slice(0, -ext.length) : fileName;

  if (baseName.length <= maxBaseLength) {
    return fileName; // Already within limits
  }

  // Truncate at word boundary if possible
  const truncated = baseName.slice(0, maxBaseLength);
  const lastBreak = Math.max(
    truncated.lastIndexOf(' '),
    truncated.lastIndexOf('-'),
    truncated.lastIndexOf('_')
  );

  // Use word boundary if it's at least 50% of max length
  const finalBase =
    lastBreak > maxBaseLength * 0.5 ? truncated.slice(0, lastBreak).trim() : truncated.trim();

  return `${finalBase}${ext}`;
}

/**
 * Process a naming template string by replacing tokens with values from the analysis result.
 * Supports standard tokens: {date}, {entity}, {type}, {category}, {project}, {summary}, {original}.
 *
 * @param {string} template - The naming template (e.g. "{date}_{entity}_{type}")
 * @param {Object} context - The context object containing replacement values
 * @param {string} [context.originalName] - Original filename
 * @param {Object} [context.analysis] - Analysis result
 * @param {string} [context.extension] - File extension (including dot)
 * @returns {string} The processed filename
 */
function processTemplate(template, context) {
  if (!template) return context.originalName || 'untitled';

  const { analysis, originalName, extension } = context;
  const originalBase = originalName ? originalName.replace(/\.[^/.]+$/, '') : '';

  // Helper to safely get a string value or empty string
  const getVal = (key) => {
    const val = analysis && analysis[key];
    return typeof val === 'string' ? val.trim() : '';
  };

  let result = template;

  // Replace tokens
  result = result.replace(/\{date\}/gi, getVal('date') || formatDate(new Date(), 'YYYY-MM-DD'));
  result = result.replace(/\{entity\}/gi, getVal('entity') || 'Unknown');
  result = result.replace(/\{type\}/gi, getVal('type') || 'Document');
  result = result.replace(/\{category\}/gi, getVal('category') || 'Uncategorized');
  result = result.replace(/\{project\}/gi, getVal('project') || 'General');
  result = result.replace(/\{summary\}/gi, getVal('summary') || '');
  result = result.replace(/\{original\}/gi, originalBase);

  // Sanitize the result to be a valid filename
  // 1. Remove characters illegal in filenames (Windows/Unix)
  result = result.replace(/[\\/:*?"<>|]/g, '');
  // 2. Collapse multiple spaces/separators
  result = result.replace(/[\s_-]{2,}/g, '_');
  // 3. Trim leading/trailing separators
  result = result.replace(/^[\s_-]+|[\s_-]+$/g, '');

  // Fallback if result became empty
  if (!result) {
    result = originalBase || 'untitled';
  }

  // Ensure extension is preserved/appended
  if (extension && !result.toLowerCase().endsWith(extension.toLowerCase())) {
    result += extension;
  }

  return result;
}

module.exports = {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  extractExtension,
  extractFileName,
  generateSuggestedNameFromAnalysis,
  makeUniqueFileName,
  processTemplate,
  enforceFileNameLength,
  MAX_FILENAME_LENGTH
};
