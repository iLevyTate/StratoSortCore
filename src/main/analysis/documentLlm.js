const path = require('path');
const { getOllamaModel, loadOllamaConfig, getOllama } = require('../ollamaUtils');
const { buildOllamaOptions } = require('../services/PerformanceService');
const { globalDeduplicator } = require('../utils/llmOptimization');
// const { enrichFileTextForEmbedding } = require('./semanticExtensionMap');
const { generateWithRetry } = require('../utils/ollamaApiRetry');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { attemptJsonRepairWithOllama } = require('../utils/ollamaJsonRepair');
const { AI_DEFAULTS } = require('../../shared/constants');
const { withAbortableTimeout } = require('../../shared/promiseUtils');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { logger } = require('../../shared/logger');
const { chunkTextForAnalysis } = require('./documentExtractors');
const { normalizeForModel } = require('./textNormalization');
const FolderMatchingService = require('../services/FolderMatchingService');
const { getInstance: getAnalysisCache } = require('../services/AnalysisCacheService');
// FIX HIGH-1: Move import to top of file (was at line 117, but used at line 88)
const { ANALYSIS_SCHEMA_PROMPT } = require('../../shared/analysisSchema');

logger.setContext('DocumentLLM');

const AppConfig = {
  ai: {
    textAnalysis: {
      defaultModel: AI_DEFAULTS.TEXT.MODEL,
      defaultHost: AI_DEFAULTS.TEXT.HOST,
      timeout: TIMEOUTS.AI_ANALYSIS_LONG,
      maxContentLength: AI_DEFAULTS.TEXT.MAX_CONTENT_LENGTH,
      temperature: AI_DEFAULTS.TEXT.TEMPERATURE,
      maxTokens: AI_DEFAULTS.TEXT.MAX_TOKENS
    }
  }
};

const DOCUMENT_ANALYSIS_TOOL = {
  type: 'function',
  function: {
    name: 'document_analysis',
    description: 'Extract structured document analysis JSON.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: ['string', 'null'] },
        entity: { type: ['string', 'null'] },
        type: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] },
        project: { type: ['string', 'null'] },
        purpose: { type: ['string', 'null'] },
        summary: { type: ['string', 'null'] },
        keywords: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
        suggestedName: { type: ['string', 'null'] },
        reasoning: { type: ['string', 'null'] }
      },
      required: ['category', 'keywords', 'confidence']
    }
  }
};

// Use shared client from ollamaUtils

// Re-export for backward compatibility
const normalizeCategoryToSmartFolders = FolderMatchingService.matchCategoryToFolder;

// normalizeTextForModel moved to ./textNormalization.js
// Using normalizeForModel from that module instead

// JSON repair constants and function consolidated to ../utils/ollamaJsonRepair.js
// FIX HIGH-1: Import moved to top of file - removed duplicate import here

async function analyzeTextWithOllama(
  textContent,
  originalFileName,
  smartFolders = [],
  fileDate = null,
  namingContext = []
) {
  try {
    const cfg = await loadOllamaConfig();
    const modelToUse =
      getOllamaModel() ||
      cfg.selectedTextModel ||
      cfg.selectedModel ||
      AppConfig.ai.textAnalysis.defaultModel;

    // Normalize and chunk text to reduce truncation loss
    const normalized = normalizeForModel(
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
      combinedChunks || normalizeForModel(normalized, AppConfig.ai.textAnalysis.maxContentLength);
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
        folderCategoriesStr = `\n\nAVAILABLE SMART FOLDERS (name — description):\n${folderListDetailed}\n\nSELECTION RULES (CRITICAL):\n- Choose the category by comparing the document's CONTENT to the folder DESCRIPTIONS above.\n- You MUST read the description of each folder to understand what belongs there.\n- Output the category EXACTLY as one of the folder names above (verbatim).\n- Fill the 'reasoning' field with a brief explanation of why the content matches that specific folder's description.\n- Do NOT invent new categories. If unsure, choose the closest match by description or use the first folder as a fallback.`;
      }
    }

    const fileDateContext = fileDate ? `\nDocument File Date: ${fileDate}` : '';

    // Build naming context string if available
    let namingContextStr = '';
    if (namingContext && namingContext.length > 0) {
      const examples = namingContext
        .slice(0, 3)
        .map((n) => `"${n}"`)
        .join(', ');
      namingContextStr = `\n\nNAMING PATTERNS FOUND IN SIMILAR FILES:\nThe following filenames are from semantically similar files in the system. If they follow a clear convention (e.g. "Invoice_YYYY-MM", "Project_Name_Type"), TRY to adapt the 'suggestedName' to match their style, but use the current document's date/entity/project:\n${examples}`;
    }

    const prompt = `You are an expert document analyzer. Analyze the TEXT CONTENT below and extract structured information.
${fileDateContext}${folderCategoriesStr}${namingContextStr}

FILENAME CONTEXT: The original filename is "${originalFileName}". Use this as a HINT for the document's purpose, but verify against the actual content.

Your response MUST be a valid JSON object matching this schema exactly.
Output ONLY raw JSON. Do NOT include markdown, code fences, or any extra text:
${JSON.stringify(ANALYSIS_SCHEMA_PROMPT, null, 2)}

IMPORTANT FOR keywords:
- Extract 3-7 keywords PURELY from the document content.
- Focus on the main topics, entities, and subjects found in the text.

IMPORTANT FOR suggestedName:
- Generate a short, concise name (1-3 words) based on the DOCUMENT TOPIC.
- Example: "budget_report", "project_proposal", "meeting_notes".
- Use underscores instead of spaces.
- Do NOT include the file extension.
- REFER to the "NAMING PATTERNS" section above if available for style consistency.

CRITICAL REQUIREMENTS:
1. The keywords array MUST contain 3-7 keywords extracted from the document content.
2. If available Smart Folders are listed above, the 'category' field MUST strictly match one of them.

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
    const useToolCalling = Boolean(cfg?.useToolCalling);
    const generateRequest = {
      model: modelToUse,
      prompt,
      options: {
        temperature: AppConfig.ai.textAnalysis.temperature,
        num_predict: AppConfig.ai.textAnalysis.maxTokens,
        ...perfOptions
      },
      format: 'json'
    };
    if (useToolCalling) {
      generateRequest.tools = [DOCUMENT_ANALYSIS_TOOL];
      generateRequest.tool_choice = {
        type: 'function',
        function: { name: DOCUMENT_ANALYSIS_TOOL.function.name }
      };
    }
    // FIX MED #11: Reduce retries to prevent exceeding outer timeout
    // With 60s outer timeout and ~20s per LLM call, 2 retries (3 attempts) + delays fits within budget
    // Previous: 3 retries with 4s max delay could exceed 60s (4 attempts × 20s + 7s delays = 87s)
    try {
      logger.debug('[documentLlm] Using text model', {
        model: modelToUse,
        fileName: originalFileName,
        timeoutMs: AppConfig.ai.textAnalysis.timeout
      });
      const response = await withAbortableTimeout(
        (abortController) => {
          const requestWithSignal = { ...generateRequest, signal: abortController.signal };
          return globalDeduplicator.deduplicate(
            deduplicationKey,
            () =>
              generateWithRetry(client, requestWithSignal, {
                operation: `Document analysis for ${originalFileName}`,
                maxRetries: 2,
                initialDelay: 1000,
                maxDelay: 2000,
                maxTotalTime: AppConfig.ai.textAnalysis.timeout
              }),
            { type: 'document', fileName: originalFileName } // Metadata for debugging cache hits
          );
        },
        AppConfig.ai.textAnalysis.timeout,
        `Document analysis for ${originalFileName}`
      );

      if (response.response) {
        try {
          // CRITICAL FIX: Use robust JSON extraction with repair for malformed LLM responses
          let parsedJson = extractAndParseJSON(response.response, null, {
            source: 'documentLlm',
            fileName: originalFileName,
            model: modelToUse
          });

          if (!parsedJson) {
            const repairedResponse = await attemptJsonRepairWithOllama(
              client,
              modelToUse,
              response.response,
              {
                schema: ANALYSIS_SCHEMA_PROMPT,
                maxTokens: AppConfig.ai.textAnalysis.maxTokens,
                operation: 'Document analysis'
              }
            );
            if (repairedResponse) {
              parsedJson = extractAndParseJSON(repairedResponse, null, {
                source: 'documentLlm.repair',
                fileName: originalFileName,
                model: modelToUse
              });
            }
          }

          if (!parsedJson) {
            logger.warn('[documentLlm] JSON repair failed, using fallback', {
              fileName: originalFileName,
              model: modelToUse
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
          // Include summary, entity, type for rich semantic folder matching
          const result = {
            rawText: textContent.substring(0, 2000),
            date: parsedJson.date || undefined,
            // Semantic fields for folder matching - these drive organization decisions
            summary: typeof parsedJson.summary === 'string' ? parsedJson.summary : undefined,
            reasoning: typeof parsedJson.reasoning === 'string' ? parsedJson.reasoning : undefined,
            entity: typeof parsedJson.entity === 'string' ? parsedJson.entity : undefined,
            type: typeof parsedJson.type === 'string' ? parsedJson.type : undefined,
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
      // withAbortableTimeout handles timeout cleanup
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
