/**
 * Suggestion Ranker
 *
 * Ranking, deduplication, and scoring for organization suggestions.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/suggestionRanker
 */

/**
 * Source-based weight multipliers
 */
const sourceWeights = {
  semantic: 1.2, // Semantic matches are usually good
  user_pattern: 1.5, // User patterns are highly relevant
  strategy: 1.0, // Strategy-based are standard
  llm: 0.8, // LLM suggestions need validation
  pattern: 1.1, // Pattern matches are reliable
  llm_creative: 0.7 // Creative suggestions are experimental
};

/**
 * Rank and deduplicate suggestions
 * @param {Array} suggestions - All suggestions to rank
 * @returns {Array} Ranked and deduplicated suggestions
 */
function rankSuggestions(suggestions) {
  // Deduplicate by folder name
  const uniqueSuggestions = new Map();

  for (const suggestion of suggestions) {
    const key = suggestion.folder?.toLowerCase();
    if (!key) continue;

    if (!uniqueSuggestions.has(key)) {
      uniqueSuggestions.set(key, suggestion);
    } else {
      // Merge scores if duplicate
      const existing = uniqueSuggestions.get(key);
      existing.score = Math.max(existing.score, suggestion.score);
      existing.confidence = Math.max(existing.confidence, suggestion.confidence);

      // Keep the source that provided higher confidence
      if (suggestion.confidence > existing.confidence) {
        existing.source = suggestion.source;
        existing.method = suggestion.method;
      }
    }
  }

  // Apply weighting based on source
  const weighted = Array.from(uniqueSuggestions.values()).map((s) => ({
    ...s,
    weightedScore: applySourceWeight(s)
  }));

  // Sort by weighted score
  return weighted.sort((a, b) => b.weightedScore - a.weightedScore);
}

/**
 * Apply source-based weighting to scores
 * @param {Object} suggestion - Suggestion to weight
 * @returns {number} Weighted score
 */
function applySourceWeight(suggestion) {
  const weight = sourceWeights[suggestion.source] || 1.0;
  return (suggestion.score || 0) * weight;
}

/**
 * Calculate confidence for a suggestion
 * @param {Object} suggestion - Suggestion to evaluate
 * @returns {number} Confidence score 0-1
 */
function calculateConfidence(suggestion) {
  if (!suggestion) return 0;

  let confidence = suggestion.confidence || suggestion.score || 0;

  // Boost confidence if multiple sources agree
  if (suggestion.sources && suggestion.sources.length > 1) {
    confidence = Math.min(1.0, confidence * 1.2);
  }

  // Boost if matches user pattern
  if (suggestion.source === 'user_pattern') {
    confidence = Math.min(1.0, confidence * 1.3);
  }

  return Math.round(confidence * 100) / 100;
}

/**
 * Generate human-readable explanation for suggestion
 * @param {Object} suggestion - Suggestion to explain
 * @param {Object} file - File being organized
 * @returns {string} Human-readable explanation
 */
function generateExplanation(suggestion, file) {
  if (!suggestion) {
    return 'No clear match found. Consider creating a new folder.';
  }

  const explanations = {
    semantic: `This file's content is similar to other files in "${suggestion.folder}"`,
    user_pattern: `You've organized similar files this way before`,
    strategy: `Using ${suggestion.strategyName || 'your preferred'} organization method`,
    llm: `Based on the file's content and purpose`,
    pattern: `This is where ${file.extension.toUpperCase()} files usually go`,
    llm_creative: suggestion.reasoning || 'Alternative way to organize this file',
    folder_improvement: `"${suggestion.folder}" could be enhanced for this type of file`,
    improvement: suggestion.improvement || `Suggested improvement for better organization`,
    new_folder_suggestion: 'A new folder would be perfect for this file type'
  };

  // Add confidence-based prefix
  let prefix = '';
  if (suggestion.confidence >= 0.8) {
    prefix = '';
  } else if (suggestion.confidence >= 0.5) {
    prefix = '';
  } else {
    prefix = '';
  }

  return (
    prefix +
    (explanations[suggestion.source] || explanations[suggestion.method] || 'Based on file analysis')
  );
}

/**
 * Combine suggestions from multiple sources
 * @param {Object} sources - Object with suggestion arrays by source
 * @returns {Array} Combined suggestions with source tags
 */
function combineSuggestions(sources) {
  const allSuggestions = [];

  for (const [source, suggestions] of Object.entries(sources)) {
    for (const suggestion of suggestions) {
      suggestion.source = source;
      allSuggestions.push(suggestion);
    }
  }

  return allSuggestions;
}

module.exports = {
  sourceWeights,
  rankSuggestions,
  applySourceWeight,
  calculateConfidence,
  generateExplanation,
  combineSuggestions
};
