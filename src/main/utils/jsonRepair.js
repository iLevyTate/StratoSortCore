/**
 * JSON Repair Utility for LLM Responses
 *
 * Handles common JSON malformation issues from LLM outputs:
 * - Trailing commas
 * - Unescaped characters
 * - Truncated JSON
 * - Markdown code fences
 * - Extra text before/after JSON
 *
 * @module utils/jsonRepair
 */

const { logger } = require('../../shared/logger');

logger.setContext('JSONRepair');

/**
 * Attempts to extract and parse JSON from potentially malformed LLM output
 * @param {string} rawResponse - The raw response from the LLM
 * @param {Object} defaultValue - Default value to return if all parsing fails
 * @returns {Object} Parsed JSON object or default value
 */
function extractAndParseJSON(rawResponse, defaultValue = null) {
  if (!rawResponse || typeof rawResponse !== 'string') {
    return defaultValue;
  }

  // Step 1: Try direct parse first
  try {
    return JSON.parse(rawResponse);
  } catch (e) {
    logger.debug('[JSONRepair] Direct parse failed, attempting repair', {
      error: e.message,
      responseLength: rawResponse.length
    });
  }

  // Step 2: Extract JSON from markdown code fences
  let cleaned = rawResponse;
  const codeBlockMatch = rawResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // Continue with repair
    }
  }

  // Step 3: Extract JSON object/array using brace matching
  const jsonMatch = rawResponse.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    cleaned = jsonMatch[1];
  }

  // Step 4: Apply common repairs
  cleaned = repairJSON(cleaned);

  // Step 5: Final parse attempt
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    logger.warn('[JSONRepair] All repair attempts failed', {
      error: e.message,
      originalLength: rawResponse.length,
      cleanedLength: cleaned.length,
      cleanedPreview: cleaned.substring(0, 300)
    });
    return defaultValue;
  }
}

/**
 * Apply common JSON repairs
 * @param {string} json - Potentially malformed JSON string
 * @returns {string} Repaired JSON string
 */
function repairJSON(json) {
  if (!json || typeof json !== 'string') return json;

  let repaired = json;

  // Remove control characters except newlines (\x0A), carriage returns (\x0D), and tabs (\x09)
  // Using RegExp constructor to avoid ESLint no-control-regex warning
  // eslint-disable-next-line no-control-regex
  const controlCharRegex = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
  repaired = repaired.replace(controlCharRegex, '');

  // Fix trailing commas before closing braces/brackets
  repaired = repaired.replace(/,\s*([}\]])/g, '$1');

  // Fix missing commas between properties (common LLM error)
  // Match: "value" followed by whitespace then "key":
  repaired = repaired.replace(/("|\d|true|false|null)\s*\n\s*"/g, '$1,\n"');

  // Fix unescaped newlines within string values by replacing them
  // This regex finds strings and escapes any unescaped newlines within them
  repaired = repaired.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match, content) => {
    // Escape any actual newlines that aren't already escaped
    const fixed = content
      .replace(/(?<!\\)\n/g, '\\n')
      .replace(/(?<!\\)\r/g, '\\r')
      .replace(/(?<!\\)\t/g, '\\t');
    return `"${fixed}"`;
  });

  // Fix truncated JSON - attempt to close open structures
  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;

  // Add missing closing brackets/braces
  if (openBrackets > closeBrackets) {
    // Check if we're in the middle of a string and truncate
    const lastQuote = repaired.lastIndexOf('"');
    if (lastQuote > repaired.lastIndexOf(']') && lastQuote > repaired.lastIndexOf('}')) {
      // We might be in an unclosed string, try to close it
      repaired = `${repaired}"`;
    }
    repaired += ']'.repeat(openBrackets - closeBrackets);
  }

  if (openBraces > closeBraces) {
    repaired += '}'.repeat(openBraces - closeBraces);
  }

  // Remove any text after the final closing brace/bracket
  const lastBrace = repaired.lastIndexOf('}');
  const lastBracket = repaired.lastIndexOf(']');
  const lastClose = Math.max(lastBrace, lastBracket);
  if (lastClose > 0 && lastClose < repaired.length - 1) {
    repaired = repaired.substring(0, lastClose + 1);
  }

  return repaired;
}

/**
 * Validate that a parsed object has expected structure for document analysis
 * @param {Object} parsed - Parsed JSON object
 * @returns {Object|null} Validated and sanitized object, or null if invalid
 */
function validateDocumentAnalysis(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  // Ensure required fields exist with defaults
  return {
    date: typeof parsed.date === 'string' ? parsed.date : undefined,
    project: typeof parsed.project === 'string' ? parsed.project : undefined,
    purpose: typeof parsed.purpose === 'string' ? parsed.purpose : undefined,
    category: typeof parsed.category === 'string' ? parsed.category : 'document',
    keywords: Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k) => typeof k === 'string' && k.length > 0)
      : [],
    confidence:
      typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 100
        ? parsed.confidence
        : 70,
    suggestedName: typeof parsed.suggestedName === 'string' ? parsed.suggestedName : undefined
  };
}

module.exports = {
  extractAndParseJSON,
  repairJSON,
  validateDocumentAnalysis
};
