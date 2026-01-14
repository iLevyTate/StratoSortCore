/**
 * Naming Utilities (Main Process)
 *
 * Utility functions for file naming conventions.
 *
 * @module services/autoOrganize/namingUtils
 */

const { LIMITS } = require('../../../shared/performanceConstants');

// Maximum filename length (excluding path) - standard filesystem limit
const MAX_FILENAME_LENGTH = LIMITS?.MAX_FILENAME_LENGTH || 255;

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
      return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    case 'snake_case':
      return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
    case 'camelCase':
      return text
        .split(/[^a-z0-9]+/i)
        .map((word, index) =>
          index === 0
            ? word.toLowerCase()
            : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
        )
        .join('');
    case 'PascalCase':
      return text
        .split(/[^a-z0-9]+/i)
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
  const extension = originalName.includes('.') ? `.${originalName.split('.').pop()}` : '';
  const today = new Date();

  let previewName = '';

  switch (convention) {
    case 'subject-date':
      previewName = `${baseName}${separator}${formatDate(today, dateFormat)}`;
      break;
    case 'date-subject':
      previewName = `${formatDate(today, dateFormat)}${separator}${baseName}`;
      break;
    case 'project-subject-date':
      previewName = `Project${separator}${baseName}${separator}${formatDate(today, dateFormat)}`;
      break;
    case 'category-subject':
      previewName = `Category${separator}${baseName}`;
      break;
    case 'keep-original':
      previewName = baseName;
      break;
    default:
      previewName = baseName;
  }

  return applyCaseConvention(previewName, caseConvention) + extension;
}

/**
 * Extract extension from filename
 * @param {string} fileName - Filename to parse
 * @returns {string} Extension with dot prefix
 */
function extractExtension(fileName) {
  return fileName.includes('.') ? `.${fileName.split('.').pop().toLowerCase()}` : '';
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

  let base;
  switch (convention) {
    case 'subject-date':
      break;
    case 'date-subject':
      break;
    case 'project-subject-date':
      break;
    case 'category-subject':
      base = `${category}${separator}${subject}`;
      break;
    case 'keep-original':
      // Preserve the original filename's base; still apply case convention if provided
      base = originalBase;
      break;
    default:
      base = subject;
      break;
  }

  // Now that subject/project/category are computed, fill in date-based conventions.
  if (convention === 'subject-date') base = `${subject}${separator}${formattedDate}`;
  if (convention === 'date-subject') base = `${formattedDate}${separator}${subject}`;
  if (convention === 'project-subject-date')
    base = `${project}${separator}${subject}${separator}${formattedDate}`;

  const finalBase = caseConvention ? applyCaseConvention(base, caseConvention) : base;
  const fullName = `${finalBase}${extension}`;

  // FIX: Validate filename length doesn't exceed filesystem limits
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

  // Split extension (only last dot)
  const dotIdx = raw.lastIndexOf('.');
  const hasExt = dotIdx > 0 && dotIdx > raw.length - 6;
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
