/**
 * File Pattern Analyzer
 *
 * Analyzes patterns in batches of files for organization.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/filePatternAnalyzer
 */

/**
 * Analyze patterns in a batch of files
 * @param {Array} files - Files to analyze
 * @returns {Object} Detected patterns
 */
function analyzeFilePatterns(files) {
  const patterns = {
    projects: new Set(),
    dates: new Set(),
    types: new Set(),
    categories: new Set(),
    commonWords: {}
  };

  for (const file of files) {
    if (file.analysis) {
      if (file.analysis.project) patterns.projects.add(file.analysis.project);
      if (file.analysis.category) patterns.categories.add(file.analysis.category);
      if (file.analysis.documentDate) patterns.dates.add(file.analysis.documentDate);
    }

    // Extract common words from filenames
    const words = file.name.toLowerCase().split(/[^a-z0-9]+/);
    for (const word of words) {
      if (word.length > 3) {
        patterns.commonWords[word] = (patterns.commonWords[word] || 0) + 1;
      }
    }

    patterns.types.add(file.extension);
  }

  return {
    hasCommonProject: patterns.projects.size === 1,
    project: patterns.projects.size === 1 ? Array.from(patterns.projects)[0] : null,
    hasDatePattern: patterns.dates.size > 0,
    dateRange: patterns.dates.size > 0 ? getDateRange(patterns.dates) : null,
    fileTypes: Array.from(patterns.types),
    dominantCategory: findDominantCategory(patterns.categories),
    commonTerms: Object.entries(patterns.commonWords)
      .filter(([, count]) => count > files.length * 0.3)
      .map(([word]) => word)
  };
}

/**
 * Get date range from a set of dates
 * @param {Set} dates - Set of date strings
 * @returns {Object|null} Date range info
 */
function getDateRange(dates) {
  const dateArray = Array.from(dates).sort();

  if (dateArray.length === 0) return null;
  if (dateArray.length === 1) {
    return {
      start: dateArray[0],
      end: dateArray[0],
      description: `Single date: ${dateArray[0]}`
    };
  }

  return {
    start: dateArray[0],
    end: dateArray[dateArray.length - 1],
    description: `${dateArray[0]} to ${dateArray[dateArray.length - 1]}`
  };
}

/**
 * Find the dominant category from a set
 * @param {Set} categories - Set of categories
 * @returns {string|null} Dominant category
 */
function findDominantCategory(categories) {
  const categoryArray = Array.from(categories);

  if (categoryArray.length === 0) return null;
  if (categoryArray.length === 1) return categoryArray[0];

  const counts = {};
  for (const cat of categoryArray) {
    counts[cat] = (counts[cat] || 0) + 1;
  }

  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Generate batch organization recommendations
 * @param {Map|Array} groups - File groups
 * @param {Object} patterns - Detected patterns
 * @returns {Array} Recommendations
 */
function generateBatchRecommendations(groups, patterns) {
  const recommendations = [];
  const normalizedGroups =
    groups instanceof Map ? Array.from(groups.values()) : Array.isArray(groups) ? groups : [];

  // Check if files belong to same project
  if (patterns.hasCommonProject) {
    recommendations.push({
      type: 'project_grouping',
      description: `All files appear to be related to "${patterns.project}"`,
      suggestion: `Consider creating a dedicated project folder: Projects/${patterns.project}`,
      confidence: 0.9
    });
  }

  // Check for temporal patterns
  if (patterns.hasDatePattern) {
    recommendations.push({
      type: 'temporal_organization',
      description: `Files span ${patterns.dateRange.description}`,
      suggestion: 'Consider organizing by date for better chronological tracking',
      confidence: 0.7
    });
  }

  // Check for workflow patterns
  const workflowIndicators = ['draft', 'final', 'review', 'approved', 'v1', 'v2'];
  const hasWorkflow = patterns.commonTerms.some((term) =>
    workflowIndicators.includes(term.toLowerCase())
  );

  if (hasWorkflow) {
    recommendations.push({
      type: 'workflow_organization',
      description: 'Files show versioning or workflow stages',
      suggestion: 'Consider organizing by workflow stage for better process management',
      confidence: 0.8
    });
  }

  if (normalizedGroups.length > 5) {
    recommendations.push({
      type: 'batch_cleanup',
      description: 'Large number of destination folders detected',
      suggestion: 'Consider consolidating folders or batching approvals to reduce fragmentation',
      confidence: 0.6
    });
  }

  return recommendations;
}

/**
 * Generate a summary of a file for embedding
 * @param {Object} file - File object
 * @returns {string} Summary text
 */
function generateFileSummary(file) {
  const parts = [
    file.name,
    file.extension,
    file.analysis?.project,
    file.analysis?.purpose,
    file.analysis?.category,
    (file.analysis?.keywords || []).join(' ')
  ].filter(Boolean);

  return parts.join(' ');
}

module.exports = {
  analyzeFilePatterns,
  getDateRange,
  findDominantCategory,
  generateBatchRecommendations,
  generateFileSummary
};
