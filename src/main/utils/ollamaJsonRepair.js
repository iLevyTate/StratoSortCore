/**
 * Unified JSON repair utility using Ollama LLM
 *
 * This module consolidates duplicate JSON repair logic from:
 * - documentLlm.js:81-117
 * - ollamaImageAnalysis.js:100-136
 *
 * Both implementations were nearly identical, differing only in:
 * - Schema reference
 * - Max tokens source
 * - Operation name for logging
 *
 * @module utils/ollamaJsonRepair
 */

const { buildOllamaOptions } = require('../services/PerformanceService');
const { generateWithRetry } = require('./ollamaApiRetry');
const { logger } = require('../../shared/logger');

logger.setContext('OllamaJsonRepair');

/**
 * Maximum characters to send to LLM for JSON repair
 * Prevents excessive token usage on large malformed responses
 */
const JSON_REPAIR_MAX_CHARS = 4000;

/**
 * Maximum tokens to request from LLM for repaired JSON output
 * Keeps repair responses concise
 */
const JSON_REPAIR_MAX_TOKENS = 400;

/**
 * Unified JSON repair using Ollama LLM
 *
 * Attempts to repair malformed JSON by sending it to Ollama with a schema
 * reference. The LLM will output properly formatted JSON matching the schema.
 *
 * @param {Object} client - Ollama client instance
 * @param {string} model - Model name to use for repair
 * @param {string} rawResponse - Malformed JSON string to repair
 * @param {Object} [options={}] - Configuration options
 * @param {Object} options.schema - JSON schema for the expected output format
 * @param {number} [options.maxTokens=400] - Maximum tokens for response
 * @param {string} [options.operation='JSON repair'] - Operation name for logging
 * @returns {Promise<string|null>} Repaired JSON string or null if repair failed
 *
 * @example
 * const repaired = await attemptJsonRepairWithOllama(client, model, rawResponse, {
 *   schema: ANALYSIS_SCHEMA_PROMPT,
 *   maxTokens: 400,
 *   operation: 'Document analysis'
 * });
 */
async function attemptJsonRepairWithOllama(client, model, rawResponse, options = {}) {
  const { schema, maxTokens = JSON_REPAIR_MAX_TOKENS, operation = 'JSON repair' } = options;

  // Validate required inputs
  if (!rawResponse || !client) {
    logger.debug('[JSON-REPAIR] Missing client or rawResponse, skipping repair');
    return null;
  }

  // Truncate input to prevent excessive token usage
  const trimmed =
    rawResponse.length > JSON_REPAIR_MAX_CHARS
      ? rawResponse.slice(0, JSON_REPAIR_MAX_CHARS)
      : rawResponse;

  // Build repair prompt with schema reference if provided
  const schemaSection = schema
    ? `Schema (for structure reference only):\n${JSON.stringify(schema, null, 2)}\n\n`
    : '';

  const repairPrompt = `You are a JSON repair assistant. Fix the JSON below and output ONLY valid JSON.
Do NOT include any commentary, markdown, or extra text.
${schemaSection}JSON to repair:
${trimmed}`;

  try {
    const perfOptions = await buildOllamaOptions('text');
    const response = await generateWithRetry(
      client,
      {
        model,
        prompt: repairPrompt,
        options: {
          temperature: 0, // Deterministic output for repair
          num_predict: Math.min(maxTokens, JSON_REPAIR_MAX_TOKENS),
          ...perfOptions
        },
        format: 'json'
      },
      {
        operation: `${operation} JSON repair`,
        maxRetries: 1, // Single retry for repair attempts
        initialDelay: 500,
        maxDelay: 1000
      }
    );

    if (response?.response) {
      logger.debug('[JSON-REPAIR] Successfully repaired JSON', {
        operation,
        inputLength: rawResponse.length,
        outputLength: response.response.length
      });
      return response.response;
    }

    logger.debug('[JSON-REPAIR] No response from repair attempt', { operation });
    return null;
  } catch (error) {
    logger.warn('[JSON-REPAIR] Repair attempt failed', {
      operation,
      error: error.message
    });
    return null;
  }
}

module.exports = {
  attemptJsonRepairWithOllama,
  JSON_REPAIR_MAX_CHARS,
  JSON_REPAIR_MAX_TOKENS
};
