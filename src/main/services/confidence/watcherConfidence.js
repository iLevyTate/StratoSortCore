const { THRESHOLDS } = require('../../../shared/performanceConstants');

const DEFAULT_CONFIDENCE_PERCENT = THRESHOLDS.DEFAULT_CONFIDENCE_PERCENT || 70;

/**
 * Clamp a numeric value into 1-100 (percentage scale).
 * @param {number} value
 * @param {number} fallback
 * @returns {number}
 */
function clampPercent(value, fallback = DEFAULT_CONFIDENCE_PERCENT) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.round(value)));
}

/**
 * Derive a simple, consistent confidence percentage for watcher flows.
 * - Accepts 0-1 or 0-100 inputs.
 * - Falls back to a minimal completeness-based score when missing.
 * @param {Object} analysis
 * @returns {number} 1-100 integer percent
 */
function deriveWatcherConfidencePercent(analysis = {}) {
  const raw = analysis.confidence ?? analysis.score ?? analysis.similarity ?? null;

  if (typeof raw === 'number' && !Number.isNaN(raw)) {
    if (raw >= 0 && raw <= 1) {
      return clampPercent(raw * 100);
    }
    return clampPercent(raw);
  }

  // Lightweight completeness-based fallback
  const hasCategory = Boolean(analysis.category);
  const hasFolder =
    Boolean(analysis.smartFolder) || Boolean(analysis.folder) || Boolean(analysis.suggestedFolder);
  const hasSummaryOrKeywords =
    (typeof analysis.summary === 'string' && analysis.summary.trim().length >= 60) ||
    (Array.isArray(analysis.keywords) && analysis.keywords.length >= 3);
  const hasSuggestedName = Boolean(analysis.suggestedName);

  const signalCount = [hasCategory, hasFolder, hasSummaryOrKeywords, hasSuggestedName].filter(
    Boolean
  ).length;
  const derived = DEFAULT_CONFIDENCE_PERCENT + signalCount * 5;

  return clampPercent(derived);
}

module.exports = {
  deriveWatcherConfidencePercent,
  DEFAULT_CONFIDENCE_PERCENT
};
