/**
 * Organization Strategies
 *
 * Strategy definitions and file-to-strategy matching.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/strategies
 */

const path = require('path');

/**
 * Organization strategy templates
 */
const strategies = {
  'project-based': {
    name: 'Project-Based',
    description: 'Organize files by project or client',
    pattern: 'Projects/{project_name}/{file_type}',
    priority: ['project', 'client', 'task']
  },
  'date-based': {
    name: 'Date-Based',
    description: 'Organize files chronologically',
    pattern: 'Archive/{year}/{month}/{category}',
    priority: ['date', 'time_period', 'category']
  },
  'type-based': {
    name: 'Type-Based',
    description: 'Organize by file type and purpose',
    pattern: '{file_type}/{subcategory}/{project}',
    priority: ['file_type', 'purpose', 'format']
  },
  'workflow-based': {
    name: 'Workflow-Based',
    description: 'Organize by workflow stage',
    pattern: 'Workflow/{stage}/{project}/{file_type}',
    priority: ['stage', 'status', 'version']
  },
  hierarchical: {
    name: 'Hierarchical',
    description: 'Multi-level categorization',
    pattern: '{main_category}/{subcategory}/{specific_folder}',
    priority: ['category', 'subcategory', 'tags']
  }
};

/**
 * File type category mapping
 */
const fileTypeCategories = {
  documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
  spreadsheets: ['xls', 'xlsx', 'csv', 'ods'],
  presentations: ['ppt', 'pptx', 'odp'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp'],
  videos: ['mp4', 'avi', 'mov', 'wmv', 'flv'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'm4a'],
  code: ['js', 'py', 'java', 'cpp', 'html', 'css'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz']
};

/**
 * Get file type category from extension
 * @param {string} extension - File extension (with or without leading dot)
 * @returns {string} Category name
 */
function getFileTypeCategory(extension) {
  // Normalize extension: strip leading dot and convert to lowercase
  const ext = (extension || '').toLowerCase().replace(/^\./, '');

  for (const [category, extensions] of Object.entries(fileTypeCategories)) {
    if (extensions.includes(ext)) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    }
  }
  return 'Files';
}

/**
 * Score how well a file fits a strategy
 * @param {Object} file - File object with analysis
 * @param {Object} strategy - Strategy definition
 * @returns {number} Score 0-1
 */
function scoreFileForStrategy(file, strategy) {
  let score = 0;
  const analysis = file.analysis || {};

  for (const priority of strategy.priority) {
    if (analysis[priority]) {
      score += 0.3;
    }
  }

  // Check if filename matches strategy pattern
  const patternMatch = matchesStrategyPattern(file.name, strategy.pattern);
  if (patternMatch) {
    score += 0.4;
  }

  return Math.min(1.0, score);
}

/**
 * Check if filename matches a strategy pattern
 * @param {string} filename - Filename to check
 * @param {string} pattern - Strategy pattern
 * @returns {boolean}
 */
function matchesStrategyPattern(filename, pattern) {
  const patternParts = pattern.toLowerCase().split('/');
  const nameParts = filename.toLowerCase().split(/[_\-\s.]/);

  return patternParts.some((part) =>
    nameParts.some((namePart) => namePart.includes(part) || part.includes(namePart))
  );
}

/**
 * Map a file to a strategy, returning folder suggestion
 * @param {Object} file - File object
 * @param {Object} strategy - Strategy definition
 * @param {Array} smartFolders - Available smart folders
 * @returns {Object} Folder name and path
 */
function mapFileToStrategy(file, strategy, smartFolders) {
  const analysis = file.analysis || {};
  const { pattern } = strategy;

  // Replace pattern variables with actual values
  const folderPath = pattern
    .replace('{project_name}', analysis.project || 'General')
    .replace('{file_type}', getFileTypeCategory(file.extension))
    .replace('{year}', String(new Date().getFullYear()))
    .replace('{month}', String(new Date().getMonth() + 1).padStart(2, '0'))
    .replace('{category}', analysis.category || 'Uncategorized')
    .replace('{stage}', analysis.stage || 'Working')
    .replace('{main_category}', analysis.category || 'Documents')
    .replace('{subcategory}', analysis.subcategory || 'General')
    .replace('{specific_folder}', analysis.purpose || 'Misc');

  // Find matching smart folder or create suggestion
  const matchingFolder = smartFolders.find(
    (f) => f.name.toLowerCase() === path.basename(folderPath).toLowerCase()
  );

  return {
    name: matchingFolder?.name || path.basename(folderPath),
    path: matchingFolder?.path || folderPath
  };
}

/**
 * Get strategy-based suggestions for a file
 * @param {Object} file - File object
 * @param {Array} smartFolders - Available smart folders
 * @param {number} threshold - Minimum score threshold
 * @returns {Array} Strategy-based suggestions
 */
function getStrategyBasedSuggestions(file, smartFolders, threshold = 0.3) {
  const suggestions = [];

  for (const [strategyId, strategy] of Object.entries(strategies)) {
    const score = scoreFileForStrategy(file, strategy);

    if (score > threshold) {
      const folder = mapFileToStrategy(file, strategy, smartFolders);
      suggestions.push({
        folder: folder.name,
        path: folder.path,
        score,
        confidence: score,
        strategy: strategyId,
        strategyName: strategy.name,
        pattern: strategy.pattern,
        method: 'strategy_based'
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score);
}

/**
 * Get applicable strategies for a file
 * @param {Object} file - File object
 * @returns {Array} Applicable strategies with scores
 */
function getApplicableStrategies(file) {
  return Object.entries(strategies)
    .map(([id, strategy]) => ({
      id,
      ...strategy,
      applicability: scoreFileForStrategy(file, strategy)
    }))
    .filter((s) => s.applicability > 0.2)
    .sort((a, b) => b.applicability - a.applicability);
}

/**
 * Select best strategy based on file patterns
 * @param {Object} patterns - Analyzed patterns
 * @param {Array} files - Files being analyzed
 * @returns {Object} Best strategy
 */
function selectBestStrategy(patterns, files = []) {
  let bestStrategy = null;
  let bestScore = 0;

  for (const [strategyId, strategy] of Object.entries(strategies)) {
    let score = 0;

    if (patterns.hasCommonProject && strategy.priority.includes('project')) {
      score += 0.4;
    }
    if (patterns.hasDatePattern && strategy.priority.includes('date')) {
      score += 0.3;
    }
    if (patterns.commonTerms.length > 0 && strategy.priority.includes('category')) {
      score += 0.2;
    }

    const typeCount = patterns.fileTypes.length;
    if (typeCount > 3 && strategyId === 'type-based') {
      score += 0.3;
    }

    if (score > bestScore) {
      bestScore = score;
      bestStrategy = { id: strategyId, ...strategy, score };
    }
  }

  if (bestStrategy) {
    return bestStrategy;
  }

  const fileBoost = Math.min(0.15, (files.length || 0) * 0.005);
  return {
    id: 'adaptive',
    name: 'Adaptive Categorization',
    description: 'AI-assisted categorization based on detected patterns',
    pattern: 'Adaptive/{category}/{file_type}',
    score: 0.75 + fileBoost
  };
}

/**
 * Get fallback suggestion based on file type
 * @param {Object} file - File object
 * @param {Array} smartFolders - Available smart folders
 * @returns {Object} Fallback suggestion
 */
function getFallbackSuggestion(file, smartFolders) {
  const category = getFileTypeCategory(file.extension);
  const matchingFolder = smartFolders.find((f) =>
    f.name.toLowerCase().includes(category.toLowerCase())
  );

  return {
    folder: matchingFolder?.name || category,
    path: matchingFolder?.path || `Documents/${category}`,
    confidence: 0.3,
    method: 'fallback'
  };
}

module.exports = {
  strategies,
  fileTypeCategories,
  getFileTypeCategory,
  scoreFileForStrategy,
  matchesStrategyPattern,
  mapFileToStrategy,
  getStrategyBasedSuggestions,
  getApplicableStrategies,
  selectBestStrategy,
  getFallbackSuggestion
};
