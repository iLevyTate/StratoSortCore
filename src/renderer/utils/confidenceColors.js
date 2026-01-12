/**
 * Confidence Color Constants
 *
 * Shared styling constants for confidence levels in the UI.
 * Used by ClusterNode, ClusterLegend, and other visualization components.
 */

export const CONFIDENCE_COLORS = {
  high: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: '●',
    label: 'high',
    desc: 'Strong match',
    combined: 'bg-emerald-100 text-emerald-700 border-emerald-200'
  },
  medium: {
    bg: 'bg-blue-100',
    text: 'text-blue-700',
    border: 'border-blue-200',
    dot: '◐',
    label: 'medium',
    desc: 'Partial match',
    combined: 'bg-blue-100 text-blue-700 border-blue-200'
  },
  low: {
    bg: 'bg-gray-100',
    text: 'text-gray-600',
    border: 'border-gray-200',
    dot: '○',
    label: 'low',
    desc: 'Fallback',
    combined: 'bg-gray-100 text-gray-600 border-gray-200'
  }
};

/**
 * Get color classes for a confidence level
 * @param {string} level - 'high', 'medium', or 'low'
 * @returns {string} Tailwind CSS classes
 */
export function getConfidenceColor(level) {
  const key = ['high', 'medium', 'low'].includes(level) ? level : 'low';
  return CONFIDENCE_COLORS[key].combined;
}

export default CONFIDENCE_COLORS;
