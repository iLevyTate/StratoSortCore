/**
 * Score formatting and manipulation utilities
 */

/**
 * Format a score (0-1) as a percentage string.
 *
 * @param {number} score - Score value between 0 and 1
 * @returns {string} Formatted percentage or empty string if invalid
 */
export function formatScore(score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return '';
  return `${Math.round(score * 100)}%`;
}

/**
 * Clamp a value to the 0-1 range.
 *
 * @param {number} v - Value to clamp
 * @returns {number} Clamped value between 0 and 1
 */
export function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/**
 * Convert a score to an opacity value for visual display.
 * Maps 0-1 score to 0.25-1 opacity range.
 *
 * @param {number} score - Score value between 0 and 1
 * @returns {number} Opacity value between 0.25 and 1
 */
export function scoreToOpacity(score) {
  const s = clamp01(score);
  return 0.25 + s * 0.75;
}
