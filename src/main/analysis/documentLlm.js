const path = require('path');
const { getInstance: getLlamaService } = require('../services/LlamaService');
const { globalDeduplicator } = require('../utils/llmOptimization');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { attemptJsonRepairWithLlama } = require('../utils/llmJsonRepair');
const { AI_DEFAULTS } = require('../../shared/constants');
const { withAbortableTimeout } = require('../../shared/promiseUtils');
const { TIMEOUTS, CONTENT_SELECTION } = require('../../shared/performanceConstants');
const { createLogger } = require('../../shared/logger');
const { selectRepresentativeContent, extractDocumentOutline } = require('./contentSelector');
const FolderMatchingService = require('../services/FolderMatchingService');
const { getInstance: getAnalysisCache } = require('../services/AnalysisCacheService');
// FIX HIGH-1: Move import to top of file (was at line 117, but used at line 88)
const { ANALYSIS_SCHEMA_PROMPT } = require('../../shared/analysisSchema');

const logger = createLogger('DocumentLLM');
const AppConfig = {
  ai: {
    textAnalysis: {
      defaultModel: AI_DEFAULTS.TEXT.MODEL,
      timeout: TIMEOUTS.AI_ANALYSIS_LONG,
      maxContentLength: AI_DEFAULTS.TEXT.MAX_CONTENT_LENGTH,
      temperature: AI_DEFAULTS.TEXT.TEMPERATURE,
      maxTokens: AI_DEFAULTS.TEXT.MAX_TOKENS
    }
  }
};

// Re-export for folder matching
const normalizeCategoryToSmartFolders = FolderMatchingService.matchCategoryToFolder;

// JSON repair constants and function consolidated to ../utils/llmJsonRepair.js
// FIX HIGH-1: Import moved to top of file - removed duplicate import here

// Map-phase prompt for the optional deep-analysis (map-reduce) path.
// Intentionally minimal to generate fast, compact summaries per chunk.
const MAP_PROMPT =
  'Extract the key facts, dates, names, topics, and important details from this text. Respond with 3-5 concise bullet points:\n\n';

function isPromptOverflowError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('compress chat history') ||
    message.includes('too long prompt') ||
    message.includes('cannot be compressed')
  );
}

/**
 * Summarize document chunks via parallel LLM calls (map phase of map-reduce).
 *
 * All chunks are submitted to the ModelAccessCoordinator queue concurrently.
 * Actual parallelism depends on configured inference concurrency (1-4 based
 * on GPU/VRAM). If concurrency is 1, chunks process sequentially.
 *
 * @param {string} text - Full document text
 * @param {Object} llamaService - LlamaService instance
 * @param {Object} [options]
 * @param {number} [options.chunkSize] - Characters per chunk
 * @param {number} [options.maxTokens] - Max response tokens per chunk
 * @param {number} [options.temperature] - Sampling temperature
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<string>} Combined bullet-point summaries
 */
async function summarizeChunks(text, llamaService, options = {}) {
  const {
    chunkSize = CONTENT_SELECTION.MAP_CHUNK_SIZE,
    maxTokens = CONTENT_SELECTION.MAP_MAX_TOKENS,
    temperature = CONTENT_SELECTION.MAP_TEMPERATURE,
    signal
  } = options;

  // Split text into non-overlapping chunks
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, Math.min(i + chunkSize, text.length)));
  }

  logger.info('[documentLlm] Map-reduce: starting chunk summarization', {
    chunkCount: chunks.length,
    chunkSize,
    totalLength: text.length
  });

  // Submit all chunks to the coordinator queue concurrently.
  // ModelAccessCoordinator handles actual parallelism based on GPU/VRAM.
  const summaryPromises = chunks.map((chunk, idx) =>
    llamaService
      .generateText({ prompt: MAP_PROMPT + chunk, maxTokens, temperature, signal })
      .then((r) => r.response?.trim() || '')
      .catch((err) => {
        logger.warn('[documentLlm] Map-reduce: chunk summary failed', {
          chunkIndex: idx,
          error: err.message
        });
        return '';
      })
  );

  const summaries = await Promise.all(summaryPromises);
  const combined = summaries.filter(Boolean).join('\n\n');

  logger.info('[documentLlm] Map-reduce: summarization complete', {
    chunksProcessed: summaries.filter(Boolean).length,
    combinedLength: combined.length
  });

  return combined;
}

async function analyzeTextWithLlama(
  textContent,
  originalFileName,
  smartFolders = [],
  fileDate = null,
  namingContext = [],
  options = {}
) {
  const bypassCache = Boolean(options?.bypassCache);
  try {
    const llamaSvc = getLlamaService();
    const cfg = await llamaSvc.getConfig();
    const modelToUse =
      cfg.textModel || cfg.selectedTextModel || AppConfig.ai.textAnalysis.defaultModel;
    const contextSize = Number(cfg?.contextSize) || AI_DEFAULTS.TEXT.CONTEXT_SIZE;

    // Budget calculation: reserve space for the prompt template, schema JSON,
    // smart-folder descriptions, naming context, and the response tokens.
    // PROMPT_OVERHEAD_TOKENS covers everything outside the document content:
    //   ~500 tok prompt template + ~300 tok schema + ~400 tok smart folders
    //   + ~100 tok naming context + ~100 tok margin = 1400 minimum.
    // Using 3 chars/token (conservative; mixed English/JSON/code averages ~3.2).
    const PROMPT_OVERHEAD_TOKENS = 1800;
    const CHARS_PER_TOKEN = 3;
    const maxTokens = Math.min(
      AppConfig.ai.textAnalysis.maxTokens,
      Math.max(256, Math.floor(contextSize * 0.25))
    );
    const maxContentLength = Math.min(
      AppConfig.ai.textAnalysis.maxContentLength,
      Math.max(
        1000,
        Math.floor((contextSize - maxTokens - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN)
      )
    );

    // Smart content selection: sample beginning, middle, and end of the document
    // for full-document coverage. This replaces naive linear truncation which
    // only ever saw the first ~20K characters of large documents.
    const selection = selectRepresentativeContent(textContent, maxContentLength);
    let truncated = selection.content;
    let contentMeta = `${truncated.length} chars from ${selection.totalLength} total, ${selection.strategy}`;

    // Optional map-reduce for very large documents (deep analysis mode).
    // When enabled, each chunk is summarized via a short LLM call, then
    // the combined summaries replace the sampled content for final analysis.
    const deepAnalysis = Boolean(cfg.deepAnalysis ?? AI_DEFAULTS.TEXT.DEEP_ANALYSIS);
    if (deepAnalysis && textContent.length > CONTENT_SELECTION.MAP_REDUCE_THRESHOLD) {
      try {
        const combinedSummaries = await summarizeChunks(textContent, getLlamaService());
        if (combinedSummaries.length > 0) {
          const outline = extractDocumentOutline(
            textContent,
            Math.floor(maxContentLength * CONTENT_SELECTION.OUTLINE_RATIO)
          );
          const parts = [];
          if (outline) parts.push(`[DOCUMENT OUTLINE]\n${outline}`);
          parts.push(`[SECTION SUMMARIES]\n${combinedSummaries}`);
          truncated = parts.join('\n\n').slice(0, maxContentLength);
          contentMeta = `${truncated.length} chars (map-reduce from ${textContent.length} total)`;
        }
      } catch (err) {
        logger.warn('[documentLlm] Map-reduce failed, using smart selection', {
          error: err.message,
          fileName: originalFileName
        });
        // Fall through — truncated already set from selectRepresentativeContent
      }
    }

    // Defensive re-check: the model may have reloaded with a smaller context
    // between our initial getConfig() call and now (sequence exhaustion, OOM, etc.).
    // Re-truncate content before deriving any cache/dedup keys so keys always
    // match the effective request payload.
    const currentCfg = await llamaSvc.getConfig();
    const effectiveCtx = Number(currentCfg?.contextSize) || contextSize;
    if (effectiveCtx < contextSize) {
      const safeMaxTokens = Math.min(maxTokens, Math.max(256, Math.floor(effectiveCtx * 0.25)));
      const safeContentLen = Math.max(
        500,
        Math.floor((effectiveCtx - safeMaxTokens - PROMPT_OVERHEAD_TOKENS) * CHARS_PER_TOKEN)
      );
      if (truncated.length > safeContentLen) {
        logger.warn('[documentLlm] Context shrank after model reload, re-truncating', {
          fileName: originalFileName,
          originalCtx: contextSize,
          effectiveCtx,
          contentBefore: truncated.length,
          contentAfter: safeContentLen
        });
        truncated = truncated.slice(0, safeContentLen);
        contentMeta = `${truncated.length} chars (re-truncated for ${effectiveCtx} ctx)`;
      }
    }

    // Fast-path: return cached result if available.
    // Cache key must be derived from the finalized pre-inference content.
    const cacheService = getAnalysisCache();
    const namingContextKey = Array.isArray(namingContext)
      ? namingContext.slice(0, 5).join('|')
      : '';
    const cacheSeed = `${originalFileName || ''}|${fileDate || ''}|${namingContextKey}|${truncated}`;
    const cacheKey = cacheService.generateKey(cacheSeed, modelToUse, smartFolders);
    if (!bypassCache) {
      const cachedResult = cacheService.get(cacheKey);
      if (cachedResult) {
        logger.info('[DocumentLLM] Cache hit', {
          fileName: originalFileName,
          category: cachedResult.category,
          suggestedName: cachedResult.suggestedName,
          confidence: cachedResult.confidence
        });
        return cachedResult;
      }
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

    const buildAnalysisPrompt =
      () => `You are an expert document analyzer. Analyze the TEXT CONTENT below and extract structured information.
${fileDateContext}${folderCategoriesStr}${namingContextStr}

FILENAME CONTEXT: The original filename is "${originalFileName}". Use this as a HINT for the document's purpose, but verify against the actual content.

Your response MUST be a valid JSON object matching this schema exactly.
Always include "keyEntities" as an array (use [] if none are found).
Output ONLY raw JSON. Do NOT wrap in markdown code fences (no triple backticks). Do NOT include any text before or after the JSON object:
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

Document content (${contentMeta}):
${truncated}`;
    let prompt = buildAnalysisPrompt();

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

    // FIX MED #11: Reduce retries to prevent exceeding outer timeout
    // With 60s outer timeout and ~20s per LLM call, 2 retries (3 attempts) + delays fits within budget
    // Previous: 3 retries with 4s max delay could exceed 60s (4 attempts × 20s + 7s delays = 87s)
    try {
      const generateDocumentText = (promptText, requestedMaxTokens, dedupeKey = null) =>
        withAbortableTimeout(
          (abortController) => {
            const inference = () =>
              llamaSvc.generateText({
                prompt: promptText,
                maxTokens: requestedMaxTokens,
                temperature: AppConfig.ai.textAnalysis.temperature,
                signal: abortController.signal
              });

            if (!dedupeKey) {
              return inference();
            }

            return globalDeduplicator.deduplicate(
              dedupeKey,
              inference,
              { type: 'document', fileName: originalFileName } // Metadata for debugging cache hits
            );
          },
          AppConfig.ai.textAnalysis.timeout,
          `Document analysis for ${originalFileName}`
        );

      let usedMaxTokens = maxTokens;
      logger.debug('[documentLlm] Using text model', {
        model: modelToUse,
        fileName: originalFileName,
        timeoutMs: AppConfig.ai.textAnalysis.timeout,
        effectiveContextSize: effectiveCtx,
        promptChars: prompt.length,
        maxTokens: usedMaxTokens
      });
      let response;
      try {
        response = await generateDocumentText(prompt, usedMaxTokens, deduplicationKey);
      } catch (error) {
        if (isPromptOverflowError(error)) {
          // Context-shift compression can fail when combined prompt/system text is too large.
          // Retry once with smaller content and a tighter generation budget.
          const previousPromptChars = prompt.length;
          usedMaxTokens = Math.max(256, Math.floor(maxTokens * 0.6));
          const retryContentLength = Math.max(800, Math.floor(truncated.length * 0.55));
          if (retryContentLength < truncated.length) {
            truncated = selectRepresentativeContent(textContent, retryContentLength).content;
          }
          contentMeta = `${truncated.length} chars (retry after context overflow from ${textContent.length} total)`;
          prompt = buildAnalysisPrompt();
          const retryDeduplicationKey = globalDeduplicator.generateKey({
            type: 'document',
            fileName: originalFileName,
            contentLength: truncated.length,
            text: truncated,
            model: modelToUse,
            retry: 'prompt-overflow',
            retryMaxTokens: usedMaxTokens,
            folders: smartFolders
              .map((f) => f?.name || '')
              .filter(Boolean)
              .join(',')
          });

          logger.warn('[documentLlm] Retrying with smaller prompt after context overflow', {
            fileName: originalFileName,
            model: modelToUse,
            previousPromptChars,
            retryPromptChars: prompt.length,
            retryMaxTokens: usedMaxTokens,
            retryContentLength
          });

          response = await generateDocumentText(prompt, usedMaxTokens, retryDeduplicationKey);
        } else {
          throw error;
        }
      }

      if (response.response) {
        try {
          // CRITICAL FIX: Use robust JSON extraction with repair for malformed LLM responses
          let parsedJson = extractAndParseJSON(response.response, null, {
            source: 'documentLlm',
            fileName: originalFileName,
            model: modelToUse
          });

          if (!parsedJson) {
            // Attempt JSON repair via LLM using the same pattern as imageAnalysis.js
            const repairedResponse = await attemptJsonRepairWithLlama(llamaSvc, response.response, {
              schema: ANALYSIS_SCHEMA_PROMPT,
              maxTokens: usedMaxTokens,
              operation: 'Document analysis'
            });

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
              error: 'Failed to parse document analysis JSON from AI engine.',
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

          // Log the complete extraction result - this is what the model pulled out
          logger.info('[DocumentLLM] Analysis complete', {
            fileName: originalFileName,
            model: modelToUse,
            contentMeta,
            cached: false,
            extraction: {
              category: result.category,
              suggestedName: result.suggestedName,
              purpose: result.purpose,
              project: result.project,
              entity: result.entity,
              type: result.type,
              date: result.date,
              keywords: result.keywords,
              confidence: result.confidence,
              reasoning: result.reasoning
            }
          });

          cacheService.set(cacheKey, result);
          return result;
        } catch (e) {
          logger.error('[documentLlm] Unexpected error processing response:', e.message);
          return {
            error: 'Failed to parse document analysis from AI engine.',
            keywords: [],
            confidence: 65
          };
        }
      }
      return {
        error: 'No content in AI response for document',
        keywords: [],
        confidence: 60
      };
    } finally {
      // FIX: Always clear timeout to prevent timer leak
      // withAbortableTimeout handles timeout cleanup
    }
  } catch (error) {
    return {
      error: `AI engine error for document: ${error.message}`,
      keywords: [],
      confidence: 60
    };
  }
}

module.exports = {
  AppConfig,
  analyzeTextWithLlama,
  normalizeCategoryToSmartFolders,
  summarizeChunks
};
