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
import {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  generateSuggestedNameFromAnalysis as buildSuggestedNameFromAnalysis,
  extractExtension,
  extractFileName,
  makeUniqueFileName
} from '../../../shared/namingConventions';

export {
  formatDate,
  applyCaseConvention,
  generatePreviewName,
  extractExtension,
  extractFileName,
  makeUniqueFileName
};

// Inline SVG Icons
function RefreshCwIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function XCircleIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function CheckCircleIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ClockIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
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
  // Files with usable analysis data are actionable even if analysis hit an error
  // (fallback analysis provides name/category).
  if (hasAnalysis)
    return {
      icon: <CheckCircleIcon className="w-4 h-4" />,
      label: 'Ready',
      color: 'text-green-600',
      spinning: false
    };
  if (state === 'error')
    return {
      icon: <XCircleIcon className="w-4 h-4" />,
      label: 'Error',
      color: 'text-red-600',
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
export function generateSuggestedNameFromAnalysis({
  originalFileName,
  analysis,
  settings,
  fileTimestamps
}) {
  return buildSuggestedNameFromAnalysis({
    originalFileName,
    analysis,
    settings,
    fileTimestamps
  });
}
