/**
 * Folder Analyzer
 *
 * Folder structure analysis and improvement suggestions.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/folderAnalyzer
 */

const { logger } = require('../../../shared/logger');

logger.setContext('Organization:FolderAnalyzer');

/**
 * Common categories for folder suggestions
 */
const commonCategories = [
  'Projects',
  'Archive',
  'Templates',
  'Reports',
  'Presentations',
  'Research',
  'Personal',
  'Work',
  'Financial',
  'Legal',
  'Media',
  'Downloads'
];

/**
 * Calculate how well a file fits in a folder
 * @param {Object} file - File object
 * @param {Object} folder - Folder object
 * @returns {number} Fit score 0-1
 */
function calculateFolderFitScore(file, folder) {
  let score = 0;
  const analysis = file.analysis || {};

  // Check name similarity
  const nameSimilarity = calculateStringSimilarity(
    file.name.toLowerCase(),
    folder.name.toLowerCase()
  );
  score += nameSimilarity * 0.3;

  // Check description relevance
  if (folder.description && analysis.purpose) {
    const descSimilarity = calculateStringSimilarity(
      analysis.purpose.toLowerCase(),
      folder.description.toLowerCase()
    );
    score += descSimilarity * 0.3;
  }

  // Check category match
  if (analysis.category && folder.name.toLowerCase().includes(analysis.category.toLowerCase())) {
    score += 0.2;
  }

  // Check keywords
  if (folder.keywords && analysis.keywords) {
    const keywordMatch = calculateKeywordOverlap(folder.keywords, analysis.keywords);
    score += keywordMatch * 0.2;
  }

  return Math.min(1.0, score);
}

/**
 * Suggest improvement for a folder based on a file
 * @param {Object} file - File object
 * @param {Object} folder - Folder object
 * @returns {string} Improvement suggestion
 */
function suggestFolderImprovement(file, folder) {
  const improvements = [];
  const analysis = file.analysis || {};

  // Suggest adding keywords
  if (analysis.keywords && folder.keywords) {
    const newKeywords = analysis.keywords.filter(
      (k) => !folder.keywords.some((fk) => fk.toLowerCase() === k.toLowerCase())
    );
    if (newKeywords.length > 0) {
      improvements.push(`Add keywords: ${newKeywords.slice(0, 3).join(', ')}`);
    }
  }

  // Suggest description enhancement
  if (analysis.purpose && folder.description) {
    if (folder.description.length < 50) {
      improvements.push('Enhance folder description for better matching');
    }
  }

  // Suggest subfolder creation
  if (analysis.subcategory) {
    improvements.push(`Consider subfolder: ${analysis.subcategory}`);
  }

  return improvements.join('; ') || 'Folder is well-suited for this file type';
}

/**
 * Suggest a new smart folder based on file patterns
 * @param {Object} file - File object
 * @param {Array} existingFolders - Existing smart folders
 * @param {Function} getFileTypeCategory - Function to get file type category
 * @returns {Object} New folder suggestion
 */
function suggestNewSmartFolder(file, existingFolders, getFileTypeCategory) {
  const analysis = file.analysis || {};

  // Generate a folder name based on file analysis
  let folderName = analysis.category || getFileTypeCategory(file.extension);

  // Check if similar folder already exists
  const exists = existingFolders.some((f) => f.name.toLowerCase() === folderName.toLowerCase());

  if (exists) {
    if (analysis.project) {
      folderName = `${analysis.project} - ${folderName}`;
    } else if (analysis.subcategory) {
      folderName = `${folderName} - ${analysis.subcategory}`;
    }
  }

  return {
    folder: folderName,
    path: `Documents/${folderName}`,
    score: 0.6,
    confidence: 0.6,
    description: `Suggested new folder for ${analysis.purpose || `${file.extension} files`}`,
    isNew: true,
    method: 'new_folder_suggestion',
    reasoning: 'No existing folder matches this file type well'
  };
}

/**
 * Identify missing categories in folder structure
 * @param {Array} smartFolders - Existing folders
 * @param {Array} files - Files to analyze
 * @returns {Array} Missing category suggestions
 */
function identifyMissingCategories(smartFolders, files) {
  const existingNames = smartFolders.map((f) => f.name.toLowerCase());
  const missing = [];

  for (const category of commonCategories) {
    const exists = existingNames.some((name) => name.includes(category.toLowerCase()));

    if (!exists) {
      const wouldBenefit = files.some((f) => {
        const analysis = f.analysis || {};
        return (
          (analysis.category && analysis.category.toLowerCase().includes(category.toLowerCase())) ||
          (f.name && f.name.toLowerCase().includes(category.toLowerCase()))
        );
      });

      if (wouldBenefit) {
        missing.push({
          name: category,
          reason: `Files detected that would fit in ${category} folder`,
          priority: 'high'
        });
      }
    }
  }

  return missing;
}

/**
 * Find overlapping folders with similar purposes
 * @param {Array} smartFolders - Folders to analyze
 * @returns {Array} Overlap suggestions
 */
function findOverlappingFolders(smartFolders) {
  const overlaps = [];
  const MAX_ITERATIONS = 10000;
  const MAX_OVERLAPS = 100;
  let iterationCount = 0;

  // Pre-compute folder signatures for quick rejection
  const folderSignatures = new Map();
  for (const folder of smartFolders) {
    const signature = {
      nameWords: new Set(folder.name.toLowerCase().split(/\s+/)),
      descWords: folder.description
        ? new Set(folder.description.toLowerCase().split(/\s+/))
        : new Set(),
      keywordSet: folder.keywords ? new Set(folder.keywords.map((k) => k.toLowerCase())) : new Set()
    };
    folderSignatures.set(folder, signature);
  }

  for (let i = 0; i < smartFolders.length; i++) {
    const folder1 = smartFolders[i];
    const sig1 = folderSignatures.get(folder1);

    for (let j = i + 1; j < smartFolders.length; j++) {
      iterationCount++;
      if (iterationCount > MAX_ITERATIONS) {
        logger.warn('findOverlappingFolders exceeded max iterations');
        return overlaps;
      }

      if (overlaps.length >= MAX_OVERLAPS) {
        return overlaps;
      }

      const folder2 = smartFolders[j];
      const sig2 = folderSignatures.get(folder2);

      // Quick rejection test
      const hasCommonNameWords = [...sig1.nameWords].some((w) => sig2.nameWords.has(w));
      if (!hasCommonNameWords && sig1.descWords.size === 0 && sig2.descWords.size === 0) {
        continue;
      }

      if (sig1.keywordSet.size > 0 && sig2.keywordSet.size > 0) {
        const hasCommonKeywords = [...sig1.keywordSet].some((k) => sig2.keywordSet.has(k));
        if (!hasCommonKeywords && !hasCommonNameWords) {
          continue;
        }
      }

      const similarity = calculateFolderSimilarity(folder1, folder2);

      if (similarity > 0.7) {
        overlaps.push({
          folders: [folder1.name, folder2.name],
          similarity,
          suggestion: `Consider merging '${folder1.name}' and '${folder2.name}'`
        });
      }
    }
  }

  return overlaps;
}

/**
 * Find underutilized folders
 * @param {Array} smartFolders - Folders to analyze
 * @param {Map} folderUsageStats - Usage statistics
 * @returns {Array} Underutilized folder suggestions
 */
function findUnderutilizedFolders(smartFolders, folderUsageStats) {
  const underutilized = [];

  for (const folder of smartFolders) {
    const usageCount = folderUsageStats.get(folder.id || folder.name) || 0;

    if (usageCount < 3) {
      underutilized.push({
        name: folder.name,
        usageCount,
        suggestion:
          usageCount === 0
            ? `'${folder.name}' has never been used - consider removing or broadening its scope`
            : `'${folder.name}' is rarely used - consider merging with related folders`
      });
    }
  }

  return underutilized;
}

/**
 * Suggest hierarchy improvements
 * @param {Array} smartFolders - Folders to analyze
 * @returns {Array} Hierarchy improvement suggestions
 */
function suggestHierarchyImprovements(smartFolders) {
  const suggestions = [];
  const groups = {};

  for (const folder of smartFolders) {
    const parts = folder.name.split(/[\s\-_]/);
    const potentialParent = parts[0];

    if (!groups[potentialParent]) {
      groups[potentialParent] = [];
    }
    groups[potentialParent].push(folder);
  }

  for (const [parent, folders] of Object.entries(groups)) {
    if (folders.length > 2) {
      const parentExists = smartFolders.some((f) => f.name.toLowerCase() === parent.toLowerCase());

      if (!parentExists) {
        suggestions.push({
          type: 'create_parent',
          parent,
          children: folders.map((f) => f.name),
          suggestion: `Create parent folder '${parent}' for related folders`
        });
      }
    }
  }

  return suggestions;
}

/**
 * Analyze folder structure and return improvements
 * @param {Array} smartFolders - Folders to analyze
 * @param {Array} files - Files to consider
 * @param {Map} folderUsageStats - Usage statistics
 * @returns {Array} All improvement suggestions
 */
function analyzeFolderStructure(smartFolders, files = [], folderUsageStats = new Map()) {
  const improvements = [];

  const missingCategories = identifyMissingCategories(smartFolders, files);
  if (missingCategories.length > 0) {
    improvements.push({
      type: 'missing_categories',
      description: 'Suggested new folders for better organization',
      suggestions: missingCategories,
      priority: 'high'
    });
  }

  const overlaps = findOverlappingFolders(smartFolders);
  if (overlaps.length > 0) {
    improvements.push({
      type: 'folder_overlaps',
      description: 'Folders with similar purposes that could be merged',
      suggestions: overlaps,
      priority: 'medium'
    });
  }

  const underutilized = findUnderutilizedFolders(smartFolders, folderUsageStats);
  if (underutilized.length > 0) {
    improvements.push({
      type: 'underutilized_folders',
      description: 'Folders that might be too specific or rarely used',
      suggestions: underutilized,
      priority: 'low'
    });
  }

  const hierarchySuggestions = suggestHierarchyImprovements(smartFolders);
  if (hierarchySuggestions.length > 0) {
    improvements.push({
      type: 'hierarchy_improvements',
      description: 'Suggestions for better folder hierarchy',
      suggestions: hierarchySuggestions,
      priority: 'medium'
    });
  }

  return improvements;
}

/**
 * Calculate similarity between two folders
 * @param {Object} folder1 - First folder
 * @param {Object} folder2 - Second folder
 * @returns {number} Similarity score 0-1
 */
function calculateFolderSimilarity(folder1, folder2) {
  let similarity = 0;

  similarity +=
    calculateStringSimilarity(folder1.name.toLowerCase(), folder2.name.toLowerCase()) * 0.4;

  if (folder1.description && folder2.description) {
    similarity +=
      calculateStringSimilarity(
        folder1.description.toLowerCase(),
        folder2.description.toLowerCase()
      ) * 0.3;
  }

  if (folder1.keywords && folder2.keywords) {
    similarity += calculateKeywordOverlap(folder1.keywords, folder2.keywords) * 0.3;
  }

  return similarity;
}

/**
 * Calculate string similarity
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score 0-1
 */
function calculateStringSimilarity(str1, str2) {
  const words1 = str1.split(/\s+/);
  const words2 = str2.split(/\s+/);

  const commonWords = words1.filter((w) => words2.includes(w)).length;
  const totalWords = Math.max(words1.length, words2.length);

  return totalWords > 0 ? commonWords / totalWords : 0;
}

/**
 * Calculate keyword overlap
 * @param {Array} keywords1 - First keyword list
 * @param {Array} keywords2 - Second keyword list
 * @returns {number} Overlap score 0-1
 */
function calculateKeywordOverlap(keywords1, keywords2) {
  const set1 = new Set(keywords1.map((k) => k.toLowerCase()));
  const set2 = new Set(keywords2.map((k) => k.toLowerCase()));

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return union.size > 0 ? intersection.size / union.size : 0;
}

module.exports = {
  commonCategories,
  calculateFolderFitScore,
  suggestFolderImprovement,
  suggestNewSmartFolder,
  identifyMissingCategories,
  findOverlappingFolders,
  findUnderutilizedFolders,
  suggestHierarchyImprovements,
  analyzeFolderStructure,
  calculateFolderSimilarity,
  calculateStringSimilarity,
  calculateKeywordOverlap
};
