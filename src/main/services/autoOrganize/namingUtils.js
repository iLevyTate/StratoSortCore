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
  const safeOriginalName = String(originalFileName || '').trim();
  if (!safeOriginalName) return '';

  const extension = safeOriginalName.includes('.') ? `.${safeOriginalName.split('.').pop()}` : '';
  const originalBase = safeOriginalName.replace(/\.[^/.]+$/, '');

  const convention = settings?.convention || 'keep-original';
  const separator = settings?.separator ?? '-';
  const dateFormat = settings?.dateFormat || 'YYYY-MM-DD';
  const caseConvention = settings?.caseConvention;

  const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const stripTrailingDateToken = (subject, token) => {
    if (!subject || !token) return subject;
    const t = String(token).trim();
    if (!t) return subject;

    // Remove one or more occurrences of the date token at the end, allowing common separators
    const re = new RegExp(`(?:[\\s._-]*${escapeRegExp(t)})+$`);
    const stripped = String(subject)
      .replace(re, '')
      .replace(/[\s._-]+$/g, '')
      .trim();
    return stripped || subject;
  };

  const stripGenericTrailingDate = (subject) => {
    if (!subject) return subject;
    // Remove trailing YYYY-MM-DD or YYYYMMDD (one or more), allowing separators
    const re = /(?:[\s._-]*(?:\d{4}-\d{2}-\d{2}|\d{8}))+$/;
    const stripped = String(subject)
      .replace(re, '')
      .replace(/[\s._-]+$/g, '')
      .trim();
    return stripped || subject;
  };

  const rawProject =
    typeof analysis?.project === 'string' && analysis.project.trim()
      ? analysis.project.trim()
      : 'Project';

  const rawCategory =
    typeof analysis?.category === 'string' && analysis.category.trim()
      ? analysis.category.trim()
      : 'Category';

  // Reasonable date range: 1970-01-01 to 100 years in the future
  const MIN_DATE_MS = 0; // Unix epoch
  const MAX_DATE_MS = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000; // 100 years from now

  const isReasonableDate = (d) => {
    if (!d || Number.isNaN(d.getTime())) return false;
    const ms = d.getTime();
    return ms >= MIN_DATE_MS && ms <= MAX_DATE_MS;
  };

  const parseDateLike = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return isReasonableDate(value) ? value : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const d = new Date(value);
      return isReasonableDate(d) ? d : null;
    }
    if (typeof value !== 'string') return null;
    const raw = value.trim();
    if (!raw) return null;
    // If date is in YYYY-MM-DD, parse without timezone shifting.
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const local = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(local.getTime()) ? null : local;
    }
    // If date is in YYYYMMDD, parse without timezone shifting.
    const m2 = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m2) {
      const local = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
      return Number.isNaN(local.getTime()) ? null : local;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const parseDateFromFileName = (nameBase) => {
    const s = String(nameBase || '');
    // Prefer YYYY-MM-DD if present
    const m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    // Then YYYYMMDD
    const m2 = s.match(/(\d{4})(\d{2})(\d{2})/);
    if (m2) {
      const d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  };

  // Date source priority:
  // 1) date already present in original filename
  // 2) file modified time (real metadata)
  // 3) file created time (real metadata)
  // 4) analysis.date (last resort; can be hallucinated by LLM)
  // 5) today
  const fileNameDate = parseDateFromFileName(originalBase);
  const modifiedDate = parseDateLike(fileTimestamps?.modified);
  const createdDate = parseDateLike(fileTimestamps?.created);
  const analysisDate = parseDateLike(analysis?.date);
  const effectiveDate = fileNameDate || modifiedDate || createdDate || analysisDate || new Date();

  const formattedDate = formatDate(effectiveDate, dateFormat);

  // Extract suggested name from analysis, with max length enforcement
  const MAX_SUBJECT_LENGTH = 50; // Maximum characters for the subject/name portion
  let rawSubject =
    typeof analysis?.suggestedName === 'string' && analysis.suggestedName.trim()
      ? analysis.suggestedName.trim().replace(/\.[^/.]+$/, '')
      : originalBase;

  // If the naming convention already adds a date, strip trailing date tokens from the LLM subject
  // so we don't end up with "...-2023-04-19-2023-04-19".
  const conventionAddsDate = ['subject-date', 'date-subject', 'project-subject-date'].includes(
    convention
  );
  if (conventionAddsDate) {
    rawSubject = stripTrailingDateToken(rawSubject, formattedDate);
    rawSubject = stripTrailingDateToken(rawSubject, analysis?.date);
    rawSubject = stripGenericTrailingDate(rawSubject);
  }

  // Truncate overly long subjects intelligently (at word boundary if possible)
  if (rawSubject.length > MAX_SUBJECT_LENGTH) {
    // Try to break at a word boundary (space, hyphen, underscore)
    const truncated = rawSubject.slice(0, MAX_SUBJECT_LENGTH);
    const lastBreak = Math.max(
      truncated.lastIndexOf(' '),
      truncated.lastIndexOf('-'),
      truncated.lastIndexOf('_')
    );
    rawSubject = lastBreak > MAX_SUBJECT_LENGTH * 0.5 ? truncated.slice(0, lastBreak) : truncated;
  }

  // Keep filenames safe across platforms. (Windows particularly)
  const sanitizeToken = (value) =>
    String(value || '')
      .trim()
      // Replace underscores with spaces to allow case conventions to work properly
      .replace(/[_]/g, ' ')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const subject = sanitizeToken(rawSubject) || originalBase;
  const project = sanitizeToken(rawProject) || 'Project';
  const category = sanitizeToken(rawCategory) || 'Category';

  const applyCasing = (text) => (caseConvention ? applyCaseConvention(text, caseConvention) : text);

  const subjectStr = applyCasing(subject);
  const projectStr = applyCasing(project);
  const categoryStr = applyCasing(category);

  let base;
  switch (convention) {
    case 'subject-date':
      base = `${subjectStr}${separator}${formattedDate}`;
      break;
    case 'date-subject':
      base = `${formattedDate}${separator}${subjectStr}`;
      break;
    case 'project-subject-date':
      base = `${projectStr}${separator}${subjectStr}${separator}${formattedDate}`;
      break;
    case 'category-subject':
      base = `${categoryStr}${separator}${subjectStr}`;
      break;
    case 'keep-original':
      base = applyCasing(originalBase);
      break;
    default:
      base = subjectStr;
      break;
  }

  const fullName = `${base}${extension}`;

  return enforceFileNameLength(fullName, extension);
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
