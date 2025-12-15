/**
 * Naming Utilities
 *
 * Pure utility functions for file naming conventions.
 * Extracted from DiscoverPhase for better maintainability.
 *
 * @module phases/discover/namingUtils
 */

import React from 'react';
import PropTypes from 'prop-types';
import { TIMEOUTS } from '../../../shared/performanceConstants';

// Inline SVG Icons
const RefreshCwIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const XCircleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const CheckCircleIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

const ClockIcon = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </svg>
);

/**
 * Format a date according to the specified format
 * @param {Date} date - Date to format
 * @param {string} format - Date format string
 * @returns {string} Formatted date
 */
export function formatDate(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

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
export function applyCaseConvention(text, convention) {
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
export function generatePreviewName(originalName, settings) {
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
 * Validate progress state object
 * @param {Object} progress - Progress state to validate
 * @returns {boolean} True if valid
 */
export function validateProgressState(progress) {
  if (!progress || typeof progress !== 'object') return false;
  if (typeof progress.current !== 'number' || typeof progress.total !== 'number') return false;
  if (progress.current < 0 || progress.total < 0) return false;
  if (progress.current > progress.total) return false;
  if (!progress.lastActivity || typeof progress.lastActivity !== 'number') return false;

  // Check if progress is too old (more than 15 minutes)
  const timeSinceActivity = Date.now() - progress.lastActivity;
  if (timeSinceActivity > TIMEOUTS.STALE_ACTIVITY) return false;

  return true;
}

/**
 * Get file state display information
 * @param {string} state - Current file state
 * @param {boolean} hasAnalysis - Whether file has analysis
 * @returns {Object} Display information
 */
export function getFileStateDisplayInfo(state, hasAnalysis) {
  if (state === 'analyzing')
    return {
      icon: <RefreshCwIcon className="w-4 h-4" />,
      label: 'Analyzing...',
      color: 'text-blue-600',
      spinning: true
    };
  if (state === 'error')
    return {
      icon: <XCircleIcon className="w-4 h-4" />,
      label: 'Error',
      color: 'text-red-600',
      spinning: false
    };
  if (hasAnalysis && state === 'ready')
    return {
      icon: <CheckCircleIcon className="w-4 h-4" />,
      label: 'Ready',
      color: 'text-green-600',
      spinning: false
    };
  if (state === 'pending')
    return {
      icon: <ClockIcon className="w-4 h-4" />,
      label: 'Pending',
      color: 'text-yellow-600',
      spinning: false
    };
  return {
    icon: <XCircleIcon className="w-4 h-4" />,
    label: 'Failed',
    color: 'text-red-600',
    spinning: false
  };
}

const iconPropTypes = {
  className: PropTypes.string
};

RefreshCwIcon.propTypes = iconPropTypes;
XCircleIcon.propTypes = iconPropTypes;
CheckCircleIcon.propTypes = iconPropTypes;
ClockIcon.propTypes = iconPropTypes;

/**
 * Extract extension from filename
 * @param {string} fileName - Filename to parse
 * @returns {string} Extension with dot prefix
 */
export function extractExtension(fileName) {
  return fileName.includes('.') ? `.${fileName.split('.').pop().toLowerCase()}` : '';
}

/**
 * Extract filename from path
 * @param {string} filePath - Full file path
 * @returns {string} Filename
 */
export function extractFileName(filePath) {
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
 * @returns {string} Suggested filename (with extension preserved)
 */
export function generateSuggestedNameFromAnalysis({ originalFileName, analysis, settings }) {
  const safeOriginalName = String(originalFileName || '').trim();
  if (!safeOriginalName) return '';

  const extension = safeOriginalName.includes('.') ? `.${safeOriginalName.split('.').pop()}` : '';
  const originalBase = safeOriginalName.replace(/\.[^/.]+$/, '');

  const convention = settings?.convention || 'keep-original';
  const separator = settings?.separator ?? '-';
  const dateFormat = settings?.dateFormat || 'YYYY-MM-DD';
  const caseConvention = settings?.caseConvention;

  const rawSubject =
    typeof analysis?.suggestedName === 'string' && analysis.suggestedName.trim()
      ? analysis.suggestedName.trim().replace(/\.[^/.]+$/, '')
      : originalBase;

  const rawProject =
    typeof analysis?.project === 'string' && analysis.project.trim()
      ? analysis.project.trim()
      : 'Project';

  const rawCategory =
    typeof analysis?.category === 'string' && analysis.category.trim()
      ? analysis.category.trim()
      : 'Category';

  // Prefer analysis-provided date, but fall back to "today" if missing/invalid
  let effectiveDate = new Date();
  if (typeof analysis?.date === 'string' && analysis.date.trim()) {
    const raw = analysis.date.trim();
    // If date is in YYYY-MM-DD, parse without timezone shifting.
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      const local = new Date(year, month - 1, day);
      if (!Number.isNaN(local.getTime())) {
        effectiveDate = local;
      }
    } else {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) {
        effectiveDate = parsed;
      }
    }
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
  const formattedDate = formatDate(effectiveDate, dateFormat);

  let base;
  switch (convention) {
    case 'subject-date':
      base = `${subject}${separator}${formattedDate}`;
      break;
    case 'date-subject':
      base = `${formattedDate}${separator}${subject}`;
      break;
    case 'project-subject-date':
      base = `${project}${separator}${subject}${separator}${formattedDate}`;
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

  const finalBase = caseConvention ? applyCaseConvention(base, caseConvention) : base;
  return `${finalBase}${extension}`;
}
