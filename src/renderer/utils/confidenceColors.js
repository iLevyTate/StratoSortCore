/**
 * Confidence Color Constants
 *
 * Shared styling constants for confidence levels in the UI.
 * Used by ClusterNode, ClusterLegend, and other visualization components.
 */

export const CONFIDENCE_COLORS = {
  high: {
    bg: 'bg-stratosort-success/10',
    text: 'text-stratosort-success',
    border: 'border-stratosort-success/30',
    dot: '●',
    dotBg: 'bg-stratosort-success',
    label: 'high',
    desc: 'Strong match',
    combined: 'bg-stratosort-success/10 text-stratosort-success border-stratosort-success/30'
  },
  medium: {
    bg: 'bg-stratosort-blue/10',
    text: 'text-stratosort-blue',
    border: 'border-stratosort-blue/30',
    dot: '◐',
    dotBg: 'bg-stratosort-blue',
    label: 'medium',
    desc: 'Partial match',
    combined: 'bg-stratosort-blue/10 text-stratosort-blue border-stratosort-blue/30'
  },
  low: {
    bg: 'bg-system-gray-100',
    text: 'text-system-gray-600',
    border: 'border-system-gray-200',
    dot: '○',
    dotBg: 'bg-system-gray-400',
    label: 'low',
    desc: 'Fallback',
    combined: 'bg-system-gray-100 text-system-gray-600 border-system-gray-200'
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
