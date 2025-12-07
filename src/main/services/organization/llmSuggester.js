/**
 * LLM Suggester
 *
 * LLM-powered organization suggestions.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/llmSuggester
 */

const { logger } = require('../../../shared/logger');
const { getOllama, getOllamaModel } = require('../../ollamaUtils');
const { buildOllamaOptions } = require('../PerformanceService');
const { globalDeduplicator } = require('../../utils/llmOptimization');
const { extractAndParseJSON } = require('../../utils/jsonRepair');

logger.setContext('Organization:LLMSuggester');

// Security limits
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB

/**
 * Get LLM-powered alternative suggestions
 * @param {Object} file - File to analyze
 * @param {Array} smartFolders - Available folders
 * @param {Object} config - LLM configuration
 * @returns {Promise<Array>} LLM suggestions
 */
async function getLLMAlternativeSuggestions(file, smartFolders, config = {}) {
  try {
    const ollama = getOllama();
    const model = getOllamaModel();

    if (!ollama || !model) {
      return [];
    }

    const llmTemperature = config.llmTemperature || 0.7;
    const llmMaxTokens = config.llmMaxTokens || 500;

    // Limit analysis content size and avoid leaking excessive detail
    const serializedAnalysis = JSON.stringify(
      file.analysis || {},
      null,
      2,
    ).slice(0, 800);

    const prompt = `Given this file analysis, suggest 3 alternative organization approaches:

File: ${file.name}
Type: ${file.extension}
Analysis (truncated): ${serializedAnalysis}

Available folders: ${smartFolders.map((f) => `${f.name}: ${f.description}`).join(', ')}

Suggest creative but practical organization alternatives that might not be obvious.
Consider: workflow stages, temporal organization, project grouping, or functional categorization.

Return JSON: {
  "suggestions": [
    {
      "folder": "folder name",
      "reasoning": "why this makes sense",
      "confidence": 0.0-1.0,
      "strategy": "organization principle used"
    }
  ]
}`;

    const perfOptions = await buildOllamaOptions('text');

    // Use deduplication to prevent duplicate LLM calls
    const deduplicationKey = globalDeduplicator.generateKey({
      fileName: file.name,
      analysis: JSON.stringify(file.analysis || {}),
      folders: smartFolders.map((f) => f.name).join(','),
      type: 'organization-suggestions',
    });

    const response = await globalDeduplicator.deduplicate(
      deduplicationKey,
      () =>
        ollama.generate({
          model,
          prompt,
          format: 'json',
          options: {
            ...perfOptions,
            temperature: llmTemperature,
            num_predict: llmMaxTokens,
          },
        }),
    );

    // Validate response size
    const responseText = response.response || '';
    const responseSize = Buffer.byteLength(responseText, 'utf8');

    if (responseSize > MAX_RESPONSE_SIZE) {
      logger.warn('[LLMSuggester] Response exceeds maximum size limit', {
        size: responseSize,
        maxSize: MAX_RESPONSE_SIZE,
        file: file.name,
      });
      return [];
    }

    // Parse JSON response with robust extraction and repair
    const parsed = extractAndParseJSON(responseText, null);

    if (!parsed) {
      logger.warn('[LLMSuggester] Failed to parse JSON response', {
        responseLength: responseText.length,
        responsePreview: responseText.slice(0, 500),
      });
      return [];
    }

    if (!Array.isArray(parsed.suggestions)) {
      logger.warn('[LLMSuggester] Response missing suggestions array');
      return [];
    }

    return parsed.suggestions
      .filter((s) => {
        // Ensure folder is a valid string
        if (typeof s.folder !== 'string' || !s.folder.trim()) {
          logger.warn(
            '[LLMSuggester] Skipping suggestion with invalid folder',
            {
              folder: s.folder,
              type: typeof s.folder,
            },
          );
          return false;
        }
        return true;
      })
      .map((s) => ({
        folder: String(s.folder).trim(),
        score: s.confidence || 0.5,
        confidence: s.confidence || 0.5,
        reasoning: s.reasoning,
        strategy: s.strategy,
        method: 'llm_creative',
      }));
  } catch (error) {
    logger.warn('[LLMSuggester] LLM suggestions failed:', error.message);
    return [];
  }
}

module.exports = {
  getLLMAlternativeSuggestions,
  MAX_RESPONSE_SIZE,
};
