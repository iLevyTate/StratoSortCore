const {
  getOllamaModel,
  loadOllamaConfig,
  getOllamaClient,
} = require('../ollamaUtils');
const { buildOllamaOptions } = require('../services/PerformanceService');
const { globalDeduplicator } = require('../utils/llmOptimization');
const { generateWithRetry } = require('../utils/ollamaApiRetry');
const crypto = require('crypto');
const { AI_DEFAULTS } = require('../../shared/constants');
const { logger } = require('../../shared/logger');

const AppConfig = {
  ai: {
    textAnalysis: {
      defaultModel: AI_DEFAULTS.TEXT.MODEL,
      defaultHost: AI_DEFAULTS.TEXT.HOST,
      timeout: 60000,
      maxContentLength: AI_DEFAULTS.TEXT.MAX_CONTENT_LENGTH,
      temperature: AI_DEFAULTS.TEXT.TEMPERATURE,
      maxTokens: AI_DEFAULTS.TEXT.MAX_TOKENS,
    },
  },
};

// Use shared client from ollamaUtils

// FIXED Bug #24: Proper LRU cache implementation with timestamp tracking
const ANALYSIS_CACHE_MAX_ENTRIES = 200;
const ANALYSIS_CACHE_TTL_MS = 3600000; // 1 hour TTL
const analysisCache = new Map(); // key -> { value, timestamp }

function getCacheKey(textContent, model, smartFolders) {
  // FIXED Bug #44: Limit input size to prevent excessive hash computation
  const MAX_TEXT_LENGTH = 50000; // 50KB max for hash key
  const truncatedText =
    textContent?.length > MAX_TEXT_LENGTH
      ? textContent.slice(0, MAX_TEXT_LENGTH)
      : textContent;

  const hasher = crypto.createHash('sha1');
  hasher.update(truncatedText || '');
  hasher.update('|');
  hasher.update(String(model || ''));
  hasher.update('|');
  try {
    const foldersKey = Array.isArray(smartFolders)
      ? smartFolders
          .map((f) => `${f?.name || ''}:${(f?.description || '').slice(0, 64)}`)
          .join(',')
      : '';
    hasher.update(foldersKey);
  } catch {
    // Silently ignore errors in key generation
  }
  return hasher.digest('hex');
}

function getCachedValue(key) {
  const entry = analysisCache.get(key);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.timestamp > ANALYSIS_CACHE_TTL_MS) {
    analysisCache.delete(key);
    return null;
  }

  // LRU: Move to end by re-inserting
  analysisCache.delete(key);
  analysisCache.set(key, { ...entry, timestamp: Date.now() });
  return entry.value;
}

function setCache(key, value) {
  // Evict oldest entry if at capacity (LRU eviction)
  if (analysisCache.size >= ANALYSIS_CACHE_MAX_ENTRIES) {
    const oldestKey = analysisCache.keys().next().value;
    analysisCache.delete(oldestKey);
  }

  analysisCache.set(key, {
    value,
    timestamp: Date.now(),
  });
}

function normalizeTextForModel(input, maxLen) {
  if (!input) return '';
  let text = String(input);
  // CRITICAL FIX: Truncate BEFORE regex operations to prevent buffer overflow
  // Processing very large strings with complex regex can cause catastrophic backtracking
  if (typeof maxLen === 'number' && maxLen > 0 && text.length > maxLen) {
    text = text.slice(0, maxLen);
  }
  // Now safe to apply regex operations on bounded text
  // Remove null bytes and collapse excessive whitespace to reduce tokens
  // eslint-disable-next-line no-control-regex
  text = text.replace(/\u0000/g, '');
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\t\x0B\f\r]+/g, ' ');
  text = text.replace(/\s{2,}/g, ' ').trim();
  return text;
}

async function analyzeTextWithOllama(
  textContent,
  originalFileName,
  smartFolders = [],
) {
  try {
    const cfg = await loadOllamaConfig();
    const modelToUse =
      getOllamaModel() ||
      cfg.selectedTextModel ||
      cfg.selectedModel ||
      AppConfig.ai.textAnalysis.defaultModel;

    // Normalize and truncate text to reduce token count
    const truncated = normalizeTextForModel(
      textContent,
      AppConfig.ai.textAnalysis.maxContentLength,
    );

    // Fast-path: return cached result if available
    const cacheKey = getCacheKey(truncated, modelToUse, smartFolders);
    const cachedResult = getCachedValue(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // FIXED Bug #29: Use array join instead of string concatenation
    let folderCategoriesStr = '';
    if (smartFolders && smartFolders.length > 0) {
      const validFolders = smartFolders
        .filter(
          (f) => f && typeof f.name === 'string' && f.name.trim().length > 0,
        )
        .slice(0, 10)
        .map((f) => ({
          name: f.name.trim().slice(0, 50),
          description: (f.description || '').trim().slice(0, 140),
        }));
      if (validFolders.length > 0) {
        const folderListParts = validFolders.map(
          (f, i) =>
            `${i + 1}. "${f.name}" — ${f.description || 'no description provided'}`,
        );
        const folderListDetailed = folderListParts.join('\n');
        folderCategoriesStr = `\n\nAVAILABLE SMART FOLDERS (name — description):\n${folderListDetailed}\n\nSELECTION RULES (CRITICAL):\n- Choose the category by comparing the document's CONTENT to the folder DESCRIPTIONS above.\n- Output the category EXACTLY as one of the folder names above (verbatim).\n- Do NOT invent new categories. If unsure, choose the closest match by description or use the first folder as a fallback.`;
      }
    }

    const prompt = `You are an expert document analyzer. Analyze the ACTUAL TEXT CONTENT below (not just the filename) and extract structured information based on what the document actually contains.

IMPORTANT: Base your analysis on the CONTENT, not the filename "${originalFileName}". Read through the text carefully to understand the document's true purpose, topics, and themes.

Your response MUST be a valid JSON object with ALL these fields:
{
  "date": "YYYY-MM-DD format if found in content, otherwise today's date",
  "project": "main subject/project from content (2-5 words)",
  "purpose": "document's purpose based on content (5-10 words)",
  "category": "most appropriate category (must be one of the folder names above)"${folderCategoriesStr},
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "confidence": 85,
  "suggestedName": "descriptive_name_based_on_content"
}

CRITICAL REQUIREMENTS:
1. The keywords array MUST contain 3-7 keywords extracted from the document content
2. Keywords should be specific terms, concepts, or topics mentioned in the text
3. Do NOT return an empty keywords array
4. Base ALL fields on the actual document content, not the filename

Document content (${truncated.length} characters):
${truncated}`;

    // Use deduplicator to prevent duplicate LLM calls for identical content
    const deduplicationKey = globalDeduplicator.generateKey({
      text: truncated,
      model: modelToUse,
      folders: smartFolders.map((f) => f.name).join(','),
    });

    const client = await getOllamaClient();
    const perfOptions = await buildOllamaOptions('text');
    const generatePromise = globalDeduplicator.deduplicate(
      deduplicationKey,
      () =>
        generateWithRetry(
          client,
          {
            model: modelToUse,
            prompt,
            options: {
              temperature: AppConfig.ai.textAnalysis.temperature,
              num_predict: AppConfig.ai.textAnalysis.maxTokens,
              ...perfOptions,
            },
            format: 'json',
          },
          {
            operation: `Document analysis for ${originalFileName}`,
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 4000,
          },
        ),
    );
    const response = await Promise.race([
      generatePromise,
      new Promise((_, reject) => {
        const t = setTimeout(
          () => reject(new Error('LLM request timed out')),
          AppConfig.ai.textAnalysis.timeout,
        );
        try {
          t.unref();
        } catch {
          // Silently ignore errors if timer is already cleared
        }
      }),
    ]);

    if (response.response) {
      try {
        // CRITICAL FIX: Wrap JSON.parse in try-catch with comprehensive validation
        let parsedJson;
        try {
          parsedJson = JSON.parse(response.response);
        } catch (parseError) {
          logger.warn('[documentLlm] JSON parse error:', parseError.message);
          return {
            error: 'Failed to parse document analysis JSON from Ollama.',
            keywords: [],
            confidence: 65,
          };
        }

        // CRITICAL FIX: Validate schema to prevent crashes from malformed responses
        if (!parsedJson || typeof parsedJson !== 'object') {
          logger.warn('[documentLlm] Invalid response: not an object');
          return {
            error: 'Invalid document analysis response structure.',
            keywords: [],
            confidence: 65,
          };
        }

        // Validate and sanitize date field
        if (parsedJson.date) {
          try {
            parsedJson.date = new Date(parsedJson.date)
              .toISOString()
              .split('T')[0];
          } catch {
            delete parsedJson.date;
          }
        }

        // Validate keywords array
        const finalKeywords = Array.isArray(parsedJson.keywords)
          ? parsedJson.keywords.filter(
              (kw) => typeof kw === 'string' && kw.length > 0,
            )
          : [];

        // FIXED Bug #41 & #43: Calculate meaningful confidence based on response quality
        // instead of using Math.random()
        if (
          !parsedJson.confidence ||
          typeof parsedJson.confidence !== 'number' ||
          parsedJson.confidence < 60 ||
          parsedJson.confidence > 100
        ) {
          // Calculate confidence based on response completeness and quality
          let calculatedConfidence = 70; // Base confidence

          // Increase confidence if we have good quality fields
          if (
            parsedJson.category &&
            typeof parsedJson.category === 'string' &&
            parsedJson.category.length > 0
          ) {
            calculatedConfidence += 5;
          }
          if (
            parsedJson.purpose &&
            typeof parsedJson.purpose === 'string' &&
            parsedJson.purpose.length > 0
          ) {
            calculatedConfidence += 5;
          }
          if (finalKeywords.length >= 3) {
            calculatedConfidence += 5;
          }
          if (
            parsedJson.project &&
            typeof parsedJson.project === 'string' &&
            parsedJson.project.length > 0
          ) {
            calculatedConfidence += 5;
          }
          if (
            parsedJson.suggestedName &&
            typeof parsedJson.suggestedName === 'string' &&
            parsedJson.suggestedName.length > 0
          ) {
            calculatedConfidence += 5;
          }

          parsedJson.confidence = Math.min(95, calculatedConfidence);
        }

        // Build validated result object
        const result = {
          rawText: textContent.substring(0, 2000),
          date: parsedJson.date || undefined,
          project:
            typeof parsedJson.project === 'string'
              ? parsedJson.project
              : undefined,
          purpose:
            typeof parsedJson.purpose === 'string'
              ? parsedJson.purpose
              : undefined,
          category:
            typeof parsedJson.category === 'string'
              ? parsedJson.category
              : 'document',
          suggestedName:
            typeof parsedJson.suggestedName === 'string'
              ? parsedJson.suggestedName
              : undefined,
          keywords: finalKeywords,
          confidence: parsedJson.confidence,
        };

        setCache(cacheKey, result);
        return result;
      } catch (e) {
        logger.error(
          '[documentLlm] Unexpected error processing response:',
          e.message,
        );
        return {
          error: 'Failed to parse document analysis from Ollama.',
          keywords: [],
          confidence: 65,
        };
      }
    }
    return {
      error: 'No content in Ollama response for document',
      keywords: [],
      confidence: 60,
    };
  } catch (error) {
    return {
      error: `Ollama API error for document: ${error.message}`,
      keywords: [],
      confidence: 60,
    };
  }
}

module.exports = {
  AppConfig,
  getOllamaClient,
  analyzeTextWithOllama,
};
