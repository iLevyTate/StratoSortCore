/**
 * LLM Suggester
 *
 * LLM-powered organization suggestions.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/llmSuggester
 */

const { createLogger } = require('../../../shared/logger');
const { TIMEOUTS } = require('../../../shared/performanceConstants');
const { withAbortableTimeout } = require('../../../shared/promiseUtils');
const { AI_DEFAULTS } = require('../../../shared/constants');
const { getInstance: getLlamaService } = require('../LlamaService');
const { globalDeduplicator } = require('../../utils/llmOptimization');
const { extractAndParseJSON } = require('../../utils/jsonRepair');

const logger = createLogger('Organization:LLMSuggester');
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
    const llamaService = getLlamaService();
    const model = AI_DEFAULTS.TEXT.MODEL;

    if (!llamaService) {
      return [];
    }
    await llamaService.initialize();

    const llmTemperature = config.llmTemperature || 0.7;
    const llmMaxTokens = config.llmMaxTokens || 500;

    // Limit analysis content size and avoid leaking excessive detail
    const serializedAnalysis = JSON.stringify(file.analysis || {}, null, 2).slice(0, 800);

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

    // Use deduplication to prevent duplicate LLM calls
    const deduplicationKey = globalDeduplicator.generateKey({
      fileName: file.name,
      analysis: JSON.stringify(file.analysis || {}),
      folders: smartFolders.map((f) => f.name).join(','),
      type: 'organization-suggestions'
    });

    const timeoutMs = TIMEOUTS.AI_ANALYSIS_LONG;
    logger.debug('[LLMSuggester] Using text model', { model, timeoutMs, file: file?.name });
    const response = await withAbortableTimeout(
      (abortController) =>
        globalDeduplicator.deduplicate(deduplicationKey, () =>
          llamaService.generateText({
            model,
            prompt,
            temperature: llmTemperature,
            maxTokens: llmMaxTokens,
            signal: abortController.signal
          })
        ),
      timeoutMs,
      'LLM organization suggestions'
    );

    // Validate response size
    const responseText = response.response || '';
    const responseSize = Buffer.byteLength(responseText, 'utf8');

    if (responseSize > MAX_RESPONSE_SIZE) {
      logger.warn('[LLMSuggester] Response exceeds maximum size limit', {
        size: responseSize,
        maxSize: MAX_RESPONSE_SIZE,
        file: file.name
      });
      return [];
    }

    // Parse JSON response with robust extraction and repair
    const parsed = extractAndParseJSON(responseText, null);

    if (!parsed) {
      logger.warn('[LLMSuggester] Failed to parse JSON response', {
        responseLength: responseText.length,
        responsePreview: responseText.slice(0, 500)
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
          logger.warn('[LLMSuggester] Skipping suggestion with invalid folder', {
            folder: s.folder,
            type: typeof s.folder
          });
          return false;
        }
        return true;
      })
      .map((s) => {
        const rawConf = typeof s.confidence === 'number' ? s.confidence : 0.5;
        const normalizedConf = rawConf > 1 ? rawConf / 100 : rawConf;
        const clampedConf = Math.max(0, Math.min(1, normalizedConf));
        return {
          folder: String(s.folder).trim(),
          score: clampedConf,
          confidence: clampedConf,
          reasoning: s.reasoning,
          strategy: s.strategy,
          method: 'llm_creative'
        };
      });
  } catch (error) {
    logger.warn('[LLMSuggester] LLM suggestions failed:', error.message);
    return [];
  }
}

module.exports = {
  getLLMAlternativeSuggestions,
  MAX_RESPONSE_SIZE
};
