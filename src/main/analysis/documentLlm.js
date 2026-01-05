const path = require('path');
const { getOllamaModel, loadOllamaConfig, getOllama } = require('../ollamaUtils');
const { buildOllamaOptions } = require('../services/PerformanceService');
const { globalDeduplicator } = require('../utils/llmOptimization');
const { generateWithRetry } = require('../utils/ollamaApiRetry');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { AI_DEFAULTS } = require('../../shared/constants');
const { logger } = require('../../shared/logger');
const { chunkTextForAnalysis } = require('./documentExtractors');
const FolderMatchingService = require('../services/FolderMatchingService');
const { getInstance: getAnalysisCache } = require('../services/AnalysisCacheService');

logger.setContext('DocumentLLM');

const AppConfig = {
  ai: {
    textAnalysis: {
      defaultModel: AI_DEFAULTS.TEXT.MODEL,
      defaultHost: AI_DEFAULTS.TEXT.HOST,
      timeout: 60000,
      maxContentLength: AI_DEFAULTS.TEXT.MAX_CONTENT_LENGTH,
      temperature: AI_DEFAULTS.TEXT.TEMPERATURE,
      maxTokens: AI_DEFAULTS.TEXT.MAX_TOKENS
    }
  }
};

// Use shared client from ollamaUtils

// Re-export for backward compatibility
const normalizeCategoryToSmartFolders = FolderMatchingService.matchCategoryToFolder;

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
  fileDate = null
) {
  try {
    const cfg = await loadOllamaConfig();
    const modelToUse =
      getOllamaModel() ||
      cfg.selectedTextModel ||
      cfg.selectedModel ||
      AppConfig.ai.textAnalysis.defaultModel;

    // Normalize and chunk text to reduce truncation loss
    const normalized = normalizeTextForModel(
      textContent,
      AppConfig.ai.textAnalysis.maxContentLength * 4
    );
    const { combined: combinedChunks, chunks } = chunkTextForAnalysis(normalized, {
      chunkSize: Math.min(4000, AppConfig.ai.textAnalysis.maxContentLength),
      overlap: 400,
      maxTotalLength: AppConfig.ai.textAnalysis.maxContentLength
    });
    const maxLen = AppConfig.ai.textAnalysis.maxContentLength;
    const truncatedRaw =
      combinedChunks ||
      normalizeTextForModel(normalized, AppConfig.ai.textAnalysis.maxContentLength);
    // Hard cap the final text to maxLen. chunkTextForAnalysis tries to respect maxTotalLength,
    // but may add small separators/metadata during concatenation; we enforce the contract here.
    const truncated =
      typeof maxLen === 'number' && maxLen > 0 && truncatedRaw.length > maxLen
        ? truncatedRaw.slice(0, maxLen)
        : truncatedRaw;
    const chunkCount = Array.isArray(chunks) && chunks.length > 0 ? chunks.length : 1;

    // Fast-path: return cached result if available
    const cacheService = getAnalysisCache();
    const cacheKey = cacheService.generateKey(truncated, modelToUse, smartFolders);
    const cachedResult = cacheService.get(cacheKey);
    if (cachedResult) {
      return cachedResult;
    }

    // FIXED Bug #29: Use array join instead of string concatenation
    let folderCategoriesStr = '';
    if (smartFolders && smartFolders.length > 0) {
      const validFolders = smartFolders
        .filter((f) => f && typeof f.name === 'string' && f.name.trim().length > 0)
        .slice(0, 10)
        .map((f) => ({
          name: f.name.trim().slice(0, 50),
          description: (f.description || '').trim().slice(0, 140)
        }));
      if (validFolders.length > 0) {
        const folderListParts = validFolders.map(
          (f, i) => `${i + 1}. "${f.name}" — ${f.description || 'no description provided'}`
        );
        const folderListDetailed = folderListParts.join('\n');
        folderCategoriesStr = `\n\nAVAILABLE SMART FOLDERS (name — description):\n${folderListDetailed}\n\nSELECTION RULES (CRITICAL):\n- Choose the category by comparing the document's CONTENT to the folder DESCRIPTIONS above.\n- Output the category EXACTLY as one of the folder names above (verbatim).\n- Do NOT invent new categories. If unsure, choose the closest match by description or use the first folder as a fallback.`;
      }
    }

    const fileDateContext = fileDate ? `\nDocument File Date: ${fileDate}` : '';

    const prompt = `You are an expert document analyzer. Analyze the TEXT CONTENT below and extract structured information.
${fileDateContext}

FILENAME CONTEXT: The original filename is "${originalFileName}". Use this as a HINT for the document's purpose, but verify against the actual content.
- If filename suggests financial content (budget, invoice, receipt, tax), look for financial terms in the text
- If filename suggests a specific category, your analysis should align with it unless the content clearly indicates otherwise

Your response MUST be a valid JSON object with ALL these fields:
{
  "date": "YYYY-MM-DD format. Use the date explicitly found in the document content (e.g. invoice date, meeting date). If NO date is found in the text, use the Document File Date provided above: ${fileDate || 'today'}",
  "project": "main subject/project from content (2-5 words)",
  "purpose": "document's purpose based on content (5-10 words)",
  "category": "most appropriate category (must be one of the folder names above)"${folderCategoriesStr},
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "confidence": 85,
  "suggestedName": "short-descriptive-name (MAX 40 chars, 2-5 key words, NO dates/IDs)"
}

IMPORTANT FOR suggestedName:
- Keep it SHORT: maximum 40 characters (excluding extension)
- PRESERVE semantic meaning from the original filename "${originalFileName}"
- If filename contains key terms like "budget", "invoice", "report", include them in your suggested name
- If the content matches the filename theme, your suggested name should reflect both
- Do NOT suggest completely unrelated names that contradict the filename
- Examples based on context:
  - "financial-budget-report.pdf" → "budget_report_summary" (preserves key terms)
  - "meeting-notes-jan.docx" → "january_meeting_notes" (preserves context)
  - "project-proposal-v2.pdf" → "project_proposal" (preserves purpose)

CRITICAL REQUIREMENTS:
1. The keywords array MUST contain 3-7 keywords extracted from the document content
2. Keywords should include relevant terms from BOTH the content AND the filename
3. Do NOT return an empty keywords array
4. If filename hints at a category and content doesn't contradict it, use that category

Document content (${truncated.length} characters, ${chunkCount} chunk(s)):
${truncated}`;

    // Use deduplicator to prevent duplicate LLM calls for identical content
    // CRITICAL: Include 'type' and 'fileName' to prevent cross-file cache contamination
    const deduplicationKey = globalDeduplicator.generateKey({
      type: 'document', // Prevent cross-type contamination with image analysis
      fileName: originalFileName, // Ensure file-specific uniqueness
      contentLength: truncated.length, // Additional uniqueness for truncated content
      text: truncated,
      model: modelToUse,
      folders: smartFolders
        .map((f) => f?.name || '')
        .filter(Boolean)
        .join(',')
    });

    const client = await getOllama();
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
              ...perfOptions
            },
            format: 'json'
          },
          {
            operation: `Document analysis for ${originalFileName}`,
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 4000
          }
        ),
      { type: 'document', fileName: originalFileName } // Metadata for debugging cache hits
    );
    // FIX: Store timeout ID outside Promise.race to ensure cleanup
    let timeoutId;
    try {
      const response = await Promise.race([
        generatePromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error('LLM request timed out')),
            AppConfig.ai.textAnalysis.timeout
          );
          try {
            timeoutId.unref();
          } catch {
            // Expected: unref() may fail on non-Node timers or if already cleared
          }
        })
      ]);

      if (response.response) {
        try {
          // CRITICAL FIX: Use robust JSON extraction with repair for malformed LLM responses
          const parsedJson = extractAndParseJSON(response.response, null);

          if (!parsedJson) {
            logger.warn('[documentLlm] JSON extraction failed', {
              responseLength: response.response.length,
              responsePreview: response.response.substring(0, 500),
              responseEnd: response.response.substring(Math.max(0, response.response.length - 200))
            });
            return {
              error: 'Failed to parse document analysis JSON from Ollama.',
              keywords: [],
              confidence: 65
            };
          }

          // CRITICAL FIX: Validate schema to prevent crashes from malformed responses
          if (typeof parsedJson !== 'object') {
            logger.warn('[documentLlm] Invalid response: not an object');
            return {
              error: 'Invalid document analysis response structure.',
              keywords: [],
              confidence: 65
            };
          }

          // Validate and sanitize date field
          if (parsedJson.date) {
            try {
              const dateObj = new Date(parsedJson.date);
              if (isNaN(dateObj.getTime())) {
                delete parsedJson.date;
              } else {
                parsedJson.date = dateObj.toISOString().split('T')[0];
              }
            } catch {
              delete parsedJson.date;
            }
          }

          // Use file date if LLM returned no date or invalid date
          if (!parsedJson.date && fileDate) {
            parsedJson.date = fileDate;
          }

          // Validate keywords array
          const finalKeywords = Array.isArray(parsedJson.keywords)
            ? parsedJson.keywords.filter((kw) => typeof kw === 'string' && kw.length > 0)
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
            project: typeof parsedJson.project === 'string' ? parsedJson.project : undefined,
            purpose: typeof parsedJson.purpose === 'string' ? parsedJson.purpose : undefined,
            category: normalizeCategoryToSmartFolders(
              typeof parsedJson.category === 'string' ? parsedJson.category : 'document',
              smartFolders
            ),
            suggestedName: (() => {
              if (typeof parsedJson.suggestedName !== 'string') return undefined;
              // Ensure the original file extension is preserved
              const originalExt = path.extname(originalFileName);
              const suggestedExt = path.extname(parsedJson.suggestedName);
              if (originalExt && !suggestedExt) {
                return parsedJson.suggestedName + originalExt;
              }
              return parsedJson.suggestedName;
            })(),
            keywords: finalKeywords,
            confidence: parsedJson.confidence
          };

          cacheService.set(cacheKey, result);
          return result;
        } catch (e) {
          logger.error('[documentLlm] Unexpected error processing response:', e.message);
          return {
            error: 'Failed to parse document analysis from Ollama.',
            keywords: [],
            confidence: 65
          };
        }
      }
      return {
        error: 'No content in Ollama response for document',
        keywords: [],
        confidence: 60
      };
    } finally {
      // FIX: Always clear timeout to prevent timer leak
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  } catch (error) {
    return {
      error: `Ollama API error for document: ${error.message}`,
      keywords: [],
      confidence: 60
    };
  }
}

module.exports = {
  AppConfig,
  getOllama,
  analyzeTextWithOllama,
  normalizeCategoryToSmartFolders
};
