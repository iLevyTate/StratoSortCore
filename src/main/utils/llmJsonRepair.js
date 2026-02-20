/**
 * Unified JSON repair utility using the AI engine
 *
 * This module consolidates duplicate JSON repair logic from:
 * - documentLlm.js
 * - image analysis
 *
 * @module utils/llmJsonRepair
 */

const { getInstance: getLlamaService } = require('../services/LlamaService');
const { withAbortableTimeout } = require('../../shared/promiseUtils');
const { createLogger } = require('../../shared/logger');

const logger = createLogger('AiJsonRepair');
/**
 * Maximum characters to send to LLM for JSON repair
 * Prevents excessive token usage on large malformed responses
 */
const JSON_REPAIR_MAX_CHARS = 4000;

/**
 * Maximum tokens to request from LLM for repaired JSON output
 * Keeps repair responses concise
 */
const JSON_REPAIR_MAX_TOKENS = 256;
const PROSE_EXTRACTION_MAX_TOKENS = 256;
const JSON_REPAIR_TIMEOUT_MS = resolveTimeoutMs(
  process.env.STRATOSORT_JSON_REPAIR_TIMEOUT_MS,
  15000
);
const PROSE_EXTRACTION_TIMEOUT_MS = resolveTimeoutMs(
  process.env.STRATOSORT_PROSE_EXTRACTION_TIMEOUT_MS,
  15000
);

function resolveTimeoutMs(rawValue, fallbackMs) {
  const parsed = Number.parseInt(String(rawValue ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

function classifyRepairError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'timeout';
  }
  if (message.includes('json')) {
    return 'parse';
  }
  return 'model_or_runtime';
}

/**
 * Unified JSON repair using the AI engine
 *
 * Attempts to repair malformed JSON by sending it to the AI engine with a schema
 * reference. The LLM will output properly formatted JSON matching the schema.
 *
 * @param {Object} client - LlamaService instance (or null to use singleton)
 * @param {string} rawResponse - Malformed JSON string to repair
 * @param {Object} [options={}] - Configuration options
 * @param {Object} options.schema - JSON schema for the expected output format
 * @param {number} [options.maxTokens=400] - Maximum tokens for response
 * @param {string} [options.operation='JSON repair'] - Operation name for logging
 * @returns {Promise<string|null>} Repaired JSON string or null if repair failed
 */
async function attemptJsonRepairWithLlama(client, rawResponse, options = {}) {
  const { schema, maxTokens = JSON_REPAIR_MAX_TOKENS, operation = 'JSON repair' } = options;

  // Validate required inputs
  if (!rawResponse) {
    logger.debug('[JSON-REPAIR] Missing rawResponse, skipping repair');
    return null;
  }

  // If client is not provided, try to get singleton
  const llamaService = client || getLlamaService();

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
    const result = await withAbortableTimeout(
      (abortController) =>
        llamaService.generateText({
          prompt: repairPrompt,
          maxTokens: Math.min(maxTokens, JSON_REPAIR_MAX_TOKENS),
          temperature: 0,
          signal: abortController.signal
        }),
      JSON_REPAIR_TIMEOUT_MS,
      `JSON repair timed out after ${JSON_REPAIR_TIMEOUT_MS}ms`
    );

    if (result?.response) {
      logger.debug('[JSON-REPAIR] Successfully repaired JSON', {
        operation,
        inputLength: rawResponse.length,
        outputLength: result.response.length
      });
      return result.response;
    }

    logger.debug('[JSON-REPAIR] No response from repair attempt', { operation });
    return null;
  } catch (error) {
    logger.warn('[JSON-REPAIR] Repair attempt failed', {
      operation,
      errorType: classifyRepairError(error),
      error: error.message
    });
    return null;
  }
}

/**
 * Extract structured JSON from a prose/natural-language description.
 *
 * Used when a vision model returns a useful description instead of JSON.
 * The text LLM converts the description into the required schema.
 *
 * @param {Object} client - LlamaService instance (or null to use singleton)
 * @param {string} proseText - Natural-language description to extract from
 * @param {Object} [options={}] - Configuration options
 * @param {Object} options.schema - JSON schema for the expected output format
 * @param {string} [options.fileName] - Original filename for context
 * @param {number} [options.maxTokens=256] - Maximum tokens for response
 * @param {string} [options.operation='Prose extraction'] - Operation name for logging
 * @returns {Promise<string|null>} Extracted JSON string or null
 */
async function attemptProseExtractionWithLlama(client, proseText, options = {}) {
  const {
    schema,
    fileName,
    maxTokens = PROSE_EXTRACTION_MAX_TOKENS,
    operation = 'Prose extraction'
  } = options;

  if (!proseText || proseText.length < 30) {
    return null;
  }

  const llamaService = client || getLlamaService();

  const trimmed =
    proseText.length > JSON_REPAIR_MAX_CHARS
      ? proseText.slice(0, JSON_REPAIR_MAX_CHARS)
      : proseText;

  const schemaStr = schema ? JSON.stringify(schema) : '{}';
  const fileContext = fileName ? ` for file "${fileName}"` : '';

  const extractionPrompt = `Extract structured metadata from this image description${fileContext}.
Return ONLY valid raw JSON (no markdown, no commentary) matching this schema:
${schemaStr}

Image description:
${trimmed}

Rules:
- Use the description content to fill each field accurately.
- keywords: 3-7 terms from the description.
- suggestedName: concise snake_case, no file extension.
- confidence: estimate 0-100 based on how much detail the description provides.
- If a field cannot be determined, use null.`;

  try {
    const result = await withAbortableTimeout(
      (abortController) =>
        llamaService.generateText({
          prompt: extractionPrompt,
          maxTokens: Math.min(maxTokens, PROSE_EXTRACTION_MAX_TOKENS),
          temperature: 0,
          signal: abortController.signal
        }),
      PROSE_EXTRACTION_TIMEOUT_MS,
      `Prose extraction timed out after ${PROSE_EXTRACTION_TIMEOUT_MS}ms`
    );

    if (result?.response) {
      logger.info('[PROSE-EXTRACTION] Text LLM extracted JSON from vision prose', {
        operation,
        inputLength: proseText.length,
        outputLength: result.response.length
      });
      return result.response;
    }

    logger.debug('[PROSE-EXTRACTION] No response from extraction attempt', { operation });
    return null;
  } catch (error) {
    logger.warn('[PROSE-EXTRACTION] Extraction attempt failed', {
      operation,
      errorType: classifyRepairError(error),
      error: error.message
    });
    return null;
  }
}

module.exports = {
  attemptJsonRepairWithLlama,
  attemptProseExtractionWithLlama,
  JSON_REPAIR_MAX_CHARS,
  JSON_REPAIR_MAX_TOKENS,
  PROSE_EXTRACTION_MAX_TOKENS
};
