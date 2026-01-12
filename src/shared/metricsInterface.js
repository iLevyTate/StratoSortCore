/**
 * Metrics Interface
 *
 * Defines the standard structure for system and business metrics.
 * This file serves as a contract for metrics reporting across the application.
 */

/**
 * Standard metric types
 */
const METRIC_TYPES = {
  COUNTER: 'counter',
  GAUGE: 'gauge',
  HISTOGRAM: 'histogram',
  SUMMARY: 'summary'
};

/**
 * Standard metric categories
 */
const METRIC_CATEGORIES = {
  SYSTEM: 'system',
  BUSINESS: 'business',
  PERFORMANCE: 'performance',
  ERROR: 'error',
  USER_ACTION: 'user_action'
};

/**
 * Create a standardized metric object
 *
 * @param {string} name - Metric name (dot.notation)
 * @param {number} value - Metric value
 * @param {string} type - Metric type from METRIC_TYPES
 * @param {string} category - Metric category from METRIC_CATEGORIES
 * @param {Object} [tags] - Optional tags/dimensions
 * @returns {Object} Standardized metric object
 * @throws {Error} If required parameters are invalid
 */
function createMetric(name, value, type, category, tags = {}) {
  // Validate required parameters
  if (typeof name !== 'string' || !name.trim()) {
    throw new Error('Metric name must be a non-empty string');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Metric value must be a finite number');
  }
  if (!Object.values(METRIC_TYPES).includes(type)) {
    throw new Error(
      `Invalid metric type: ${type}. Must be one of: ${Object.values(METRIC_TYPES).join(', ')}`
    );
  }
  if (!Object.values(METRIC_CATEGORIES).includes(category)) {
    throw new Error(
      `Invalid metric category: ${category}. Must be one of: ${Object.values(METRIC_CATEGORIES).join(', ')}`
    );
  }
  if (tags !== null && typeof tags !== 'object') {
    throw new Error('Metric tags must be an object');
  }

  return {
    name: name.trim(),
    value,
    type,
    category,
    tags: tags || {},
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  METRIC_TYPES,
  METRIC_CATEGORIES,
  createMetric
};
