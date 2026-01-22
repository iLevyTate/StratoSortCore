const fs = require('fs').promises;
const path = require('path');
const { getCanonicalFileId } = require('../../shared/pathSanitization');
const sharp = require('sharp');
const { getOllamaVisionModel, loadOllamaConfig, getOllama } = require('../ollamaUtils');
const { buildOllamaOptions } = require('../services/PerformanceService');
const { globalDeduplicator } = require('../utils/llmOptimization');
const { generateWithRetry } = require('../utils/ollamaApiRetry');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const {
  AI_DEFAULTS,
  SUPPORTED_IMAGE_EXTENSIONS,
  PROCESSING_LIMITS
} = require('../../shared/constants');
const { TRUNCATION, THRESHOLDS } = require('../../shared/performanceConstants');
const { ANALYSIS_SCHEMA_PROMPT } = require('../../shared/analysisSchema');
const { normalizeAnalysisResult } = require('./utils');
const { normalizeExtractedTextForStorage } = require('./analysisTextUtils');
const {
  getIntelligentCategory: getIntelligentImageCategory,
  getIntelligentKeywords: getIntelligentImageKeywords,
  safeSuggestedName
} = require('./fallbackUtils');
const { enrichFileTextForEmbedding } = require('./semanticExtensionMap');
const { container, ServiceIds } = require('../services/ServiceContainer');
const FolderMatchingService = require('../services/FolderMatchingService');
const embeddingQueue = require('./embeddingQueue');
const { logger } = require('../../shared/logger');

logger.setContext('OllamaImageAnalysis');
let chromaDbSingleton = null;
let folderMatcherSingleton = null;

// In-memory cache for image analysis keyed by path|size|mtimeMs
const imageAnalysisCache = new Map();
const MAX_IMAGE_CACHE = 300;
const IMAGE_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const IMAGE_SIGNATURE_VERSION = 'v2';
function setImageCache(signature, value) {
  if (!signature) return;
  // FIX CRIT-28: Add timestamp for TTL eviction
  imageAnalysisCache.set(signature, { value, timestamp: Date.now() });
  if (imageAnalysisCache.size > MAX_IMAGE_CACHE) {
    const first = imageAnalysisCache.keys().next().value;
    imageAnalysisCache.delete(first);
  }
}

// App configuration for image analysis - Optimized for speed
const AppConfig = {
  ai: {
    imageAnalysis: {
      defaultModel: AI_DEFAULTS.IMAGE.MODEL,
      defaultHost: AI_DEFAULTS.IMAGE.HOST,
      // Keep image analysis aligned with global processing timeouts so the renderer lock
      // doesn't get "stuck" for minutes when vision calls hang.
      timeout: PROCESSING_LIMITS.ANALYSIS_TIMEOUT,
      temperature: AI_DEFAULTS.IMAGE.TEMPERATURE,
      maxTokens: AI_DEFAULTS.IMAGE.MAX_TOKENS
    }
  }
};

const JSON_REPAIR_MAX_CHARS = 4000;
const JSON_REPAIR_MAX_TOKENS = 400;
const IMAGE_ANALYSIS_SCHEMA = {
  ...ANALYSIS_SCHEMA_PROMPT,
  colors: ['#hex1', '#hex2'],
  has_text: true,
  content_type: 'text_document OR photograph OR screenshot OR other'
};
const IMAGE_ANALYSIS_TOOL = {
  type: 'function',
  function: {
    name: 'image_analysis',
    description: 'Extract structured image analysis JSON.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: ['string', 'null'] },
        entity: { type: ['string', 'null'] },
        type: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] },
        project: { type: ['string', 'null'] },
        summary: { type: ['string', 'null'] },
        keywords: { type: 'array', items: { type: 'string' } },
        confidence: { type: 'number' },
        suggestedName: { type: ['string', 'null'] },
        reasoning: { type: ['string', 'null'] },
        colors: { type: 'array', items: { type: 'string' } },
        has_text: { type: 'boolean' },
        content_type: { type: ['string', 'null'] }
      },
      required: ['category', 'keywords', 'confidence']
    }
  }
};

async function attemptJsonRepairWithOllama(client, model, rawResponse) {
  if (!rawResponse || !client) return null;
  const trimmed =
    rawResponse.length > JSON_REPAIR_MAX_CHARS
      ? rawResponse.slice(0, JSON_REPAIR_MAX_CHARS)
      : rawResponse;
  const repairPrompt = `You are a JSON repair assistant. Fix the JSON below and output ONLY valid JSON.
Do NOT include any commentary, markdown, or extra text.
Schema (for structure reference only):
${JSON.stringify(IMAGE_ANALYSIS_SCHEMA, null, 2)}

JSON to repair:
${trimmed}`;

  const perfOptions = await buildOllamaOptions('text');
  const response = await generateWithRetry(
    client,
    {
      model,
      prompt: repairPrompt,
      options: {
        temperature: 0,
        num_predict: Math.min(AppConfig.ai.imageAnalysis.maxTokens, JSON_REPAIR_MAX_TOKENS),
        ...perfOptions
      },
      format: 'json'
    },
    {
      operation: 'Image analysis JSON repair',
      maxRetries: 1,
      initialDelay: 500,
      maxDelay: 1000
    }
  );

  return response?.response || null;
}

async function analyzeImageWithOllama(
  imageBase64,
  originalFileName,
  smartFolders = [],
  extractedText = null,
  namingContext = []
) {
  try {
    logger.info(`Analyzing image content with Ollama`, {
      model: AppConfig.ai.imageAnalysis.defaultModel
    });

    // Build naming context string
    let namingContextStr = '';
    if (namingContext && namingContext.length > 0) {
      const examples = namingContext
        .slice(0, 3)
        .map((n) => `"${n}"`)
        .join(', ');
      namingContextStr = `\n\nNAMING PATTERNS FROM SIMILAR FILES:\nConsistent naming is important. The following are names of semantically similar files in the system. If they follow a clear pattern, TRY to adapt your 'suggestedName' to match their style (e.g., specific date format, separator style), while describing THIS image's content:\n${examples}`;
    }

    // Build folder categories string for the prompt (include descriptions)
    let folderCategoriesStr = '';
    if (smartFolders && smartFolders.length > 0) {
      const validFolders = smartFolders
        .filter((f) => f && typeof f.name === 'string' && f.name.trim().length > 0)
        .slice(0, TRUNCATION.FOLDERS_DISPLAY)
        .map((f) => ({
          name: f.name.trim().slice(0, TRUNCATION.NAME_MAX),
          description: (f.description || '').trim().slice(0, TRUNCATION.DESCRIPTION_MAX)
        }));
      if (validFolders.length > 0) {
        const folderListDetailed = validFolders
          .map((f, i) => `${i + 1}. "${f.name}" — ${f.description || 'no description provided'}`)
          .join('\n');

        folderCategoriesStr = `\n\nAVAILABLE SMART FOLDERS (name — description):\n${folderListDetailed}\n\nSELECTION RULES (CRITICAL):\n- Choose the category by comparing BOTH the image content AND the filename to folder DESCRIPTIONS.\n- You MUST read the description of each folder to understand what belongs there.\n- Output the category EXACTLY as one of the folder names above (verbatim).\n- Fill the 'reasoning' field with a brief explanation of why the visual content matches that specific folder's description.\n- Do NOT invent new categories.\n- If the filename suggests a category (e.g., "financial-report" → Finance folder), PRIORITIZE that match.`;
      }
    }

    // Build OCR grounding context if text was extracted
    const ocrGroundingStr =
      extractedText && extractedText.length > 20
        ? `\n\nEXTRACTED TEXT FROM IMAGE (GROUND TRUTH - your analysis MUST be consistent with this):\n${extractedText.slice(0, 1500)}\n\nIMPORTANT: The text above was extracted from the image via OCR. Your analysis MUST reflect this text content. If the text mentions financial terms, budgets, invoices, or reports, your analysis MUST identify these themes.`
        : '';

    const prompt = `You are an expert image analyzer for an automated file organization system. Analyze this image named "${originalFileName}" and extract structured information.

CRITICAL FILENAME VALIDATION:
The original filename is "${originalFileName}". Use it as a context hint, but prioritize VISUAL CONTENT for analysis.
- If the filename suggests a specific topic, verify it against the image content.
${folderCategoriesStr}
${ocrGroundingStr}
${namingContextStr}

Your response MUST be a valid JSON object matching this schema exactly.
Output ONLY raw JSON. Do NOT include markdown, code fences, or any extra text:
${JSON.stringify(IMAGE_ANALYSIS_SCHEMA, null, 2)}

IMPORTANT FOR category:
- Verify that your selected 'category' matches the folder description provided above.
- Use the 'reasoning' field to explain the link between the visual content and the folder description.

IMPORTANT FOR keywords:
- Extract 3-7 keywords based on the VISUAL CONTENT and any visible text.
- Do NOT just copy the filename. Look at what is actually in the image.

IMPORTANT FOR suggestedName:
- Generate a short, concise name (1-3 words) based on the IMAGE TOPIC.
- Example: "budget_report", "sunset_beach", "project_diagram".
- Use underscores instead of spaces.
- Do NOT include the file extension.
- REFER to "NAMING PATTERNS" above for style consistency if available.

If you cannot determine a field with confidence, use null.
Analyze this image:`;

    const cfg = await loadOllamaConfig();
    const modelToUse =
      getOllamaVisionModel() || cfg.selectedVisionModel || AppConfig.ai.imageAnalysis.defaultModel;

    // Use deduplicator to prevent duplicate LLM calls for identical images
    // FIX: Handle case where smartFolders is explicitly passed as undefined
    // CRITICAL: Include 'type' to prevent cross-file cache contamination with document analysis
    const safeFolders = Array.isArray(smartFolders) ? smartFolders : [];
    const deduplicationKey = globalDeduplicator.generateKey({
      type: 'image', // Prevent cross-type contamination with document analysis
      fileName: originalFileName,
      contentLength: imageBase64.length, // Additional uniqueness
      image: imageBase64.slice(0, TRUNCATION.CACHE_SIGNATURE), // Use first chars as signature
      model: modelToUse,
      folders: safeFolders.map((f) => f.name).join(',')
    });

    const client = await getOllama();
    const perfOptions = await buildOllamaOptions('vision');
    const useToolCalling = Boolean(cfg?.useToolCalling);

    // IMPORTANT: Vision model calls can hang indefinitely if the model/server gets stuck.
    // Enforce a hard timeout and abort the underlying request (supported by Ollama client).
    const abortController = new AbortController();
    let timeoutId = null;
    const timeoutMs = Number(AppConfig.ai.imageAnalysis.timeout) || 60000;
    const startedAt = Date.now();

    const response = await (async () => {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          try {
            abortController.abort();
          } catch (abortErr) {
            // Intentionally ignored: abort may fail if request already completed
            logger.debug('[IMAGE-ANALYSIS] Abort signal error (non-fatal):', abortErr?.message);
          }
          reject(new Error(`Image analysis timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        // Ensure timers don't keep the process alive
        if (timeoutId && typeof timeoutId.unref === 'function') {
          timeoutId.unref();
        }
      });

      const generateRequest = {
        model: modelToUse,
        prompt,
        images: [imageBase64],
        options: {
          temperature: AppConfig.ai.imageAnalysis.temperature,
          num_predict: AppConfig.ai.imageAnalysis.maxTokens,
          ...perfOptions
        },
        format: 'json',
        signal: abortController.signal
      };
      if (useToolCalling) {
        generateRequest.tools = [IMAGE_ANALYSIS_TOOL];
        generateRequest.tool_choice = {
          type: 'function',
          function: { name: IMAGE_ANALYSIS_TOOL.function.name }
        };
      }
      const generatePromise = globalDeduplicator.deduplicate(
        deduplicationKey,
        () =>
          generateWithRetry(client, generateRequest, {
            operation: `Image analysis for ${originalFileName}`,
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 4000
          }),
        { type: 'image', fileName: originalFileName } // Metadata for debugging cache hits
      );

      try {
        return await Promise.race([generatePromise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    })();

    logger.info('[IMAGE-ANALYSIS] Ollama vision request completed', {
      fileName: originalFileName,
      model: modelToUse,
      elapsedMs: Date.now() - startedAt
    });

    if (response.response) {
      try {
        // Use robust JSON extraction with repair for malformed LLM responses
        let parsedJson = extractAndParseJSON(response.response, null, {
          source: 'ollamaImageAnalysis',
          fileName: originalFileName,
          model: modelToUse
        });

        if (!parsedJson) {
          const repairedResponse = await attemptJsonRepairWithOllama(
            client,
            modelToUse,
            response.response
          );
          if (repairedResponse) {
            parsedJson = extractAndParseJSON(repairedResponse, null, {
              source: 'ollamaImageAnalysis.repair',
              fileName: originalFileName,
              model: modelToUse
            });
          }
        }

        if (!parsedJson || typeof parsedJson !== 'object') {
          logger.warn('[IMAGE-ANALYSIS] JSON repair failed, using fallback', {
            fileName: originalFileName,
            model: modelToUse
          });
          throw new Error('Failed to parse image analysis JSON from Ollama');
        }

        // Validate and structure the date
        if (parsedJson.date) {
          try {
            parsedJson.date = new Date(parsedJson.date).toISOString().split('T')[0];
          } catch (e) {
            delete parsedJson.date;
            logger.warn('Ollama returned an invalid date for image, omitting.');
          }
        }

        // Ensure array fields are initialized if undefined
        let finalKeywords = Array.isArray(parsedJson.keywords) ? parsedJson.keywords : [];
        const finalColors = Array.isArray(parsedJson.colors) ? parsedJson.colors : [];

        // FALLBACK: If keywords are empty, use intelligent fallback from filename
        if (finalKeywords.length === 0) {
          finalKeywords = getIntelligentImageKeywords(
            originalFileName,
            path.extname(originalFileName)
          );
          logger.debug('[IMAGE-ANALYSIS] Fallback keywords generated', { keywords: finalKeywords });
        }

        // Ensure confidence is a reasonable number
        // MEDIUM PRIORITY FIX (MED-10): Use fixed default instead of random value
        if (!parsedJson.confidence || parsedJson.confidence < 60 || parsedJson.confidence > 100) {
          parsedJson.confidence = 75; // Fixed default when Ollama returns invalid confidence
          logger.debug('[IMAGE-ANALYSIS] Invalid confidence from Ollama, using default: 75');
        }

        return {
          ...parsedJson,
          keywords: finalKeywords,
          colors: finalColors,
          has_text: Boolean(parsedJson.has_text)
        };
      } catch (e) {
        logger.error('Error parsing Ollama JSON response for image', {
          error: e.message
        });
        return {
          error: 'Failed to parse image analysis from Ollama.',
          keywords: [],
          confidence: 65
        };
      }
    }

    return {
      error: 'No content in Ollama response for image',
      keywords: [],
      confidence: 60
    };
  } catch (error) {
    logger.error('Error calling Ollama API for image', {
      error: error.message
    });

    if (
      error?.name === 'AbortError' ||
      String(error?.message || '')
        .toLowerCase()
        .includes('aborted')
    ) {
      return {
        error:
          'Image analysis was aborted (timeout or cancellation). Try again or switch to a smaller/faster vision model.',
        keywords: [],
        confidence: 0
      };
    }

    // Specific handling for zero-length image error
    if (error.message.includes('zero length image')) {
      return {
        error: 'Image is empty or corrupted - cannot analyze zero-length image',
        keywords: [],
        confidence: 0
      };
    }
    // Guidance for vision model input failures
    if (error.message.includes('unable to make llava embedding')) {
      return {
        error:
          'Unsupported image format or dimensions for vision model. Convert to PNG/JPG and keep under ~2048px on the longest side.',
        keywords: [],
        confidence: 0
      };
    }

    return {
      error: `Ollama API error for image: ${error.message}`,
      keywords: [],
      confidence: 60
    };
  }
}

// ============================================================================
// Hallucination Detection and Validation
// ============================================================================

/**
 * Validate analysis result against filename to detect hallucinations
 * Penalizes confidence when Ollama output contradicts filename context
 * @param {Object} analysis - Ollama analysis result
 * @param {string} fileName - Original file name
 * @param {string} extractedText - OCR-extracted text (optional)
 * @returns {Object} Analysis with validation applied and warnings added
 */
function validateAnalysisConsistency(analysis, fileName, extractedText = null) {
  if (!analysis || typeof analysis !== 'object') return analysis;

  const warnings = [];
  const fileNameLower = fileName.toLowerCase();
  const suggestedLower = (analysis.suggestedName || '').toLowerCase();
  const keywordsStr = (analysis.keywords || []).join(' ').toLowerCase();

  // Define filename context indicators
  const financialTerms = [
    'financial',
    'budget',
    'invoice',
    'receipt',
    'tax',
    'expense',
    'payment',
    'billing',
    'accounting'
  ];
  const documentTerms = ['report', 'document', 'form', 'statement', 'summary', 'analysis'];
  const landscapeTerms = [
    'sunset',
    'beach',
    'landscape',
    'nature',
    'mountain',
    'ocean',
    'forest',
    'sky',
    'scenic'
  ];

  // Check if filename indicates financial content
  const filenameIsFinancial = financialTerms.some((term) => fileNameLower.includes(term));
  const filenameIsDocument = documentTerms.some((term) => fileNameLower.includes(term));

  // Check if suggested name indicates landscape/scenic content
  const suggestedIsLandscape = landscapeTerms.some((term) => suggestedLower.includes(term));
  // const keywordsAreLandscape = landscapeTerms.some((term) => keywordsStr.includes(term)); // Unused

  // CRITICAL: Detect financial document → landscape hallucination
  if (filenameIsFinancial && suggestedIsLandscape) {
    warnings.push('HALLUCINATION DETECTED: Suggested landscape name for financial document');
    analysis.confidence = Math.min(analysis.confidence || 75, 25);
    analysis.hallucination_detected = true;

    // Override with filename-based suggestion
    // const fallbackName = getIntelligentImageCategory(fileName, '')
    //   .toLowerCase()
    //   .replace(/\s+/g, '_');
    analysis.suggestedName = safeSuggestedName(fileName, '');
    logger.warn('[HALLUCINATION] Landscape suggested for financial file, overriding', {
      original: suggestedLower,
      corrected: analysis.suggestedName
    });
  }

  // Check if document filename got landscape analysis
  if (filenameIsDocument && suggestedIsLandscape) {
    warnings.push('HALLUCINATION DETECTED: Suggested landscape name for document file');
    analysis.confidence = Math.min(analysis.confidence || 75, 30);
    analysis.hallucination_detected = true;
    analysis.suggestedName = safeSuggestedName(fileName, '');
  }

  // Check if keywords contradict filename
  if (
    filenameIsFinancial &&
    !keywordsStr.includes('financ') &&
    !keywordsStr.includes('budget') &&
    !keywordsStr.includes('invoice') &&
    !keywordsStr.includes('money') &&
    !keywordsStr.includes('business')
  ) {
    warnings.push('Keywords do not reflect financial context from filename');
    analysis.confidence = Math.max(40, (analysis.confidence || 75) - 20);

    // Inject financial keywords from filename
    const fileKeywords = financialTerms.filter((term) => fileNameLower.includes(term));
    if (fileKeywords.length > 0 && Array.isArray(analysis.keywords)) {
      analysis.keywords = [...fileKeywords, ...analysis.keywords].slice(0, 7);
    }
  }

  // Validate against OCR-extracted text
  if (extractedText && extractedText.length > 30) {
    const textLower = extractedText.toLowerCase();
    const textIsFinancial =
      financialTerms.some((term) => textLower.includes(term)) ||
      textLower.includes('$') ||
      textLower.includes('total') ||
      textLower.includes('amount');

    if (textIsFinancial && suggestedIsLandscape) {
      warnings.push('OCR text contains financial content but analysis suggests landscape');
      analysis.confidence = Math.min(analysis.confidence || 75, 20);
      analysis.hallucination_detected = true;
      analysis.suggestedName = safeSuggestedName(fileName, '');
    }
  }

  // Check content_type consistency
  if (
    (filenameIsFinancial || filenameIsDocument) &&
    analysis.content_type &&
    ['landscape', 'nature', 'scenic', 'beach', 'sunset'].includes(
      analysis.content_type.toLowerCase()
    )
  ) {
    warnings.push('Content type contradicts document/financial filename');
    analysis.content_type = 'text_document';
    analysis.confidence = Math.max(35, (analysis.confidence || 75) - 25);
  }

  // CROSS-VALIDATION: Use fallbackUtils intelligent category as ground truth
  // If Ollama's category doesn't match filename-based category, prefer filename-based
  const fileExtension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  const intelligentCategory = getIntelligentImageCategory(fileName, fileExtension);

  if (analysis.category && intelligentCategory) {
    const ollamaCategoryLower = analysis.category.toLowerCase();
    const intelligentCategoryLower = intelligentCategory.toLowerCase();

    // Check if Ollama category is generic but intelligent category is specific
    const genericCategories = ['documents', 'images', 'files', 'work', 'general', 'other', 'misc'];
    const ollamaIsGeneric = genericCategories.some((g) => ollamaCategoryLower.includes(g));
    const intelligentIsSpecific = !genericCategories.some((g) =>
      intelligentCategoryLower.includes(g)
    );

    if (ollamaIsGeneric && intelligentIsSpecific) {
      warnings.push(
        `Category override: "${analysis.category}" → "${intelligentCategory}" (filename-based)`
      );
      analysis.original_category = analysis.category;
      analysis.category = intelligentCategory;
      analysis.category_source = 'filename_fallback';
    }

    // If Ollama gave a completely wrong category for financial files
    if (
      filenameIsFinancial &&
      !ollamaCategoryLower.includes('financ') &&
      !ollamaCategoryLower.includes('budget')
    ) {
      if (intelligentCategoryLower.includes('financ') || intelligentCategoryLower === 'financial') {
        warnings.push(
          `Financial category override: "${analysis.category}" → "${intelligentCategory}"`
        );
        analysis.original_category = analysis.category;
        analysis.category = intelligentCategory;
        analysis.category_source = 'filename_financial_override';
      }
    }
  }

  // Log warnings if any detected
  if (warnings.length > 0) {
    analysis.validation_warnings = warnings;
    logger.warn('[IMAGE-VALIDATION] Analysis inconsistencies detected', {
      fileName,
      warnings,
      adjustedConfidence: analysis.confidence,
      hallucinationDetected: analysis.hallucination_detected || false,
      categorySource: analysis.category_source || 'ollama'
    });
  }

  return analysis;
}

// ============================================================================
// Helper Functions - Extracted for readability and maintainability
// ============================================================================

/**
 * Create a fallback analysis result when AI analysis is unavailable
 * @param {string} fileName - Original file name
 * @param {string} fileExtension - File extension
 * @param {string} reason - Reason for fallback
 * @param {number} confidence - Confidence score (default: 60)
 * @returns {Object} Fallback analysis result
 */
function normalizeCategoryToSmartFolder(category, smartFolders) {
  if (typeof FolderMatchingService?.matchCategoryToFolder === 'function') {
    return FolderMatchingService.matchCategoryToFolder(category, smartFolders);
  }
  return category;
}

function createFallbackResult(fileName, fileExtension, reason, confidence = 60, smartFolders = []) {
  const intelligentCategory = getIntelligentImageCategory(fileName, fileExtension);
  const intelligentKeywords = getIntelligentImageKeywords(fileName, fileExtension);
  const normalizedCategory =
    typeof intelligentCategory === 'string' && intelligentCategory.trim().length > 0
      ? normalizeCategoryToSmartFolder(intelligentCategory, smartFolders)
      : intelligentCategory;
  return {
    purpose: `Image (fallback - ${reason})`,
    project: fileName.replace(fileExtension, ''),
    category: normalizedCategory,
    date: new Date().toISOString().split('T')[0],
    keywords: intelligentKeywords,
    confidence,
    suggestedName: safeSuggestedName(fileName, fileExtension),
    extractionMethod: 'filename_fallback',
    fallbackReason: reason
  };
}

/**
 * Extract EXIF date from image metadata
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<string|null>} EXIF date in YYYY-MM-DD format or null
 */
async function extractExifDate(imageBuffer) {
  try {
    const meta = await sharp(imageBuffer).metadata();
    if (meta && meta.exif) {
      const exif = require('exif-reader')(meta.exif);
      if (exif && (exif.exif || exif.image)) {
        const dateStr = exif.exif?.DateTimeOriginal || exif.image?.ModifyDate;
        if (dateStr) {
          const parts = dateStr.split(' ')[0].replace(/:/g, '-');
          if (parts.match(/^\d{4}-\d{2}-\d{2}$/)) {
            logger.debug(`[IMAGE] Extracted EXIF date: ${parts}`);
            return parts;
          }
        }
      }
    }
  } catch (exifErr) {
    // Non-fatal if metadata extraction fails
    logger.debug('[IMAGE] EXIF extraction failed:', exifErr.message);
  }
  return null;
}

/**
 * Preprocess image for vision model compatibility
 * Converts unsupported formats to PNG and resizes large images
 * @param {Buffer} imageBuffer - Original image buffer
 * @param {string} fileExtension - File extension
 * @returns {Promise<Buffer>} Processed image buffer
 */
async function preprocessImageBuffer(imageBuffer, fileExtension) {
  // FIX HIGH-67: Wrap entire preprocessing in try/catch to catch synchronous sharp errors
  try {
    const needsFormatConversion = ['.svg', '.tiff', '.tif', '.bmp', '.gif', '.webp'].includes(
      fileExtension
    );
    const maxDimension = 1536;

    let meta = null;
    try {
      meta = await sharp(imageBuffer).metadata();
    } catch (metaErr) {
      logger.debug('[IMAGE] Metadata extraction failed:', metaErr.message);
    }

    const shouldResize =
      meta && (Number(meta.width) > maxDimension || Number(meta.height) > maxDimension);

    if (!needsFormatConversion && !shouldResize) {
      return imageBuffer;
    }

    let transformer = sharp(imageBuffer);
    if (shouldResize) {
      const resizeOptions = { fit: 'inside', withoutEnlargement: true };
      if (meta && meta.width && meta.height) {
        if (meta.width >= meta.height) resizeOptions.width = maxDimension;
        else resizeOptions.height = maxDimension;
      } else {
        resizeOptions.width = maxDimension;
      }
      transformer = transformer.resize(resizeOptions);
    }
    return await transformer.png({ compressionLevel: 5 }).toBuffer();
  } catch (error) {
    logger.error('[IMAGE] Preprocessing failed:', error.message);
    throw error;
  }
}

/**
 * Apply semantic folder matching using ChromaDB embeddings
 * @param {Object} analysis - Current analysis result
 * @param {string} filePath - File path for embedding
 * @param {Array} smartFolders - Available smart folders
 * @returns {Promise<Object>} Analysis with folder matching applied
 */
async function applySemanticFolderMatching(
  analysis,
  filePath,
  smartFolders,
  fileSize,
  extractedText
) {
  const chromaDb = container.tryResolve(ServiceIds.CHROMA_DB);
  if (chromaDb !== chromaDbSingleton) {
    chromaDbSingleton = chromaDb;
  }

  if (!chromaDb) {
    logger.warn('[IMAGE] ChromaDB not available, skipping semantic folder refinement');
    return analysis;
  }

  const folderMatcher =
    folderMatcherSingleton || (folderMatcherSingleton = new FolderMatchingService(chromaDb));

  // Validate folder matcher has required methods
  const hasRequiredMethods =
    folderMatcher &&
    typeof folderMatcher === 'object' &&
    typeof folderMatcher.initialize === 'function' &&
    typeof folderMatcher.batchUpsertFolders === 'function' &&
    typeof folderMatcher.embedText === 'function' &&
    typeof folderMatcher.matchVectorToFolders === 'function';

  if (!hasRequiredMethods) {
    logger.warn('[IMAGE] FolderMatcher invalid or missing required methods');
    return analysis;
  }

  // Initialize on first use
  if (!folderMatcher.embeddingCache?.initialized) {
    try {
      await folderMatcher.initialize();
    } catch (initError) {
      logger.warn('[IMAGE] FolderMatcher initialization error:', initError.message);
      return analysis;
    }
  }

  // Upsert smart folders
  if (smartFolders && Array.isArray(smartFolders) && smartFolders.length > 0) {
    try {
      const validFolders = smartFolders.filter(
        (f) => f && typeof f === 'object' && (f.name || f.id || f.path)
      );
      if (validFolders.length > 0) {
        await folderMatcher.batchUpsertFolders(validFolders);
      }
    } catch (upsertError) {
      logger.warn('[IMAGE] Folder embedding upsert error:', upsertError.message);
    }
  }

  // Build summary for matching
  const summaryBase = [
    analysis.project,
    analysis.purpose,
    (analysis.keywords || []).join(' '),
    analysis.content_type || ''
  ]
    .filter(Boolean)
    .join('\n');

  // FIX: Enrich with semantic keywords based on file extension (e.g. .svg -> "vector graphic")
  // This ensures embedding matching works even if LLM missed the semantic connection
  const fileExtension = path.extname(filePath).toLowerCase();
  const summaryEnriched = enrichFileTextForEmbedding(summaryBase, fileExtension);

  const summary = [
    summaryEnriched,
    (extractedText || '').slice(0, 500) // Include OCR text for better matching
  ]
    .filter(Boolean)
    .join('\n');

  if (!summary || summary.trim().length === 0) {
    logger.debug('[IMAGE] Empty summary, skipping folder matching');
    return analysis;
  }

  try {
    const chromaDbService = container.tryResolve(ServiceIds.CHROMA_DB);
    if (chromaDbService) {
      await chromaDbService.initialize();
    }

    const { vector, model } = await folderMatcher.embedText(summary);
    const candidates = await folderMatcher.matchVectorToFolders(vector, 5);

    // Queue embedding for batch persistence
    // FIX: Include category and confidence in metadata for search display
    const fileName = path.basename(filePath);
    const rawConfidence = analysis.confidence ?? 0;
    const confidencePercent =
      typeof rawConfidence === 'number'
        ? rawConfidence > 1
          ? Math.round(rawConfidence)
          : Math.round(rawConfidence * 100)
        : 0;
    embeddingQueue.enqueue({
      id: getCanonicalFileId(filePath, true),
      vector,
      model,
      meta: {
        path: filePath,
        name: fileName,
        fileExtension: path.extname(fileName).toLowerCase(),
        fileSize,
        category: analysis.category || 'Uncategorized',
        confidence: confidencePercent,
        type: 'image',
        extractionMethod: extractedText ? 'image_ocr' : 'image_analysis',
        summary: summary.substring(0, 500),
        tags: Array.isArray(analysis.keywords) ? analysis.keywords : [],
        keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
        date: analysis.date,
        suggestedName: analysis.suggestedName,
        content_type: analysis.content_type,
        colors: Array.isArray(analysis.colors) ? analysis.colors : [],
        has_text: analysis.has_text === true
      },
      updatedAt: new Date().toISOString()
    });

    if (Array.isArray(candidates) && candidates.length > 0) {
      const top = candidates[0];
      if (top && typeof top === 'object' && typeof top.score === 'number' && top.name) {
        // Only override LLM category if embedding score exceeds both threshold AND LLM confidence
        // This ensures semantic understanding from content analysis remains primary
        const llmConfidence = analysis.confidence || 0.7;
        const shouldOverride =
          top.score >= THRESHOLDS.FOLDER_MATCH_CONFIDENCE && top.score > llmConfidence;

        if (shouldOverride) {
          logger.info('[IMAGE] Embedding override - folder match exceeds LLM confidence', {
            llmCategory: analysis.category,
            llmConfidence,
            embeddingCategory: top.name,
            embeddingScore: top.score
          });
          analysis.llmOriginalCategory = analysis.category;
          analysis.category = top.name;
          analysis.categorySource = 'embedding_override';
          analysis.suggestedFolder = top.name;
          analysis.destinationFolder = top.path || top.name;
        } else if (top.score >= THRESHOLDS.FOLDER_MATCH_CONFIDENCE) {
          // Embedding met threshold but LLM confidence was higher - keep LLM category
          logger.debug('[IMAGE] LLM category preserved - confidence higher than embedding', {
            llmCategory: analysis.category,
            llmConfidence,
            embeddingCategory: top.name,
            embeddingScore: top.score
          });
          analysis.categorySource = 'llm_preserved';
        }
        analysis.folderMatchCandidates = candidates;
      }
    }
  } catch (matchError) {
    logger.warn('[IMAGE] Folder matching error:', matchError.message);
  }

  return analysis;
}

// ============================================================================
// Main Analysis Function
// ============================================================================

async function analyzeImageFile(filePath, smartFolders = [], options = {}) {
  logger.info(`Analyzing image file`, { path: filePath });
  const bypassCache = Boolean(options?.bypassCache);
  const fileExtension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const smartFolderSig = Array.isArray(smartFolders)
    ? smartFolders
        .map((f) => f?.name || '')
        .filter(Boolean)
        .sort()
        .join('|')
    : '';

  // Check if file extension is supported (include SVG by rasterizing via sharp)
  const supportedExtensions = SUPPORTED_IMAGE_EXTENSIONS;
  if (!supportedExtensions.includes(fileExtension)) {
    return {
      error: `Unsupported image format: ${fileExtension}`,
      category: 'unsupported',
      keywords: [],
      confidence: 0,
      suggestedName:
        fileName.replace(fileExtension, '').replace(/[^a-zA-Z0-9_-]/g, '_') + fileExtension
    };
  }

  // Fixed: Proactive graceful degradation - check Ollama availability before processing
  // Use shared detection logic instead of ModelVerifier
  const { isOllamaRunning } = require('../utils/ollamaDetection');

  try {
    const isRunning = await isOllamaRunning();
    if (!isRunning) {
      logger.warn('[ANALYSIS-FALLBACK] Ollama unavailable, using filename-based analysis');
      return createFallbackResult(fileName, fileExtension, 'Ollama unavailable', 60, smartFolders);
    }
  } catch (error) {
    logger.error('[IMAGE] Pre-flight verification failed', {
      error: error.message
    });
    return createFallbackResult(fileName, fileExtension, error.message, 55, smartFolders);
  }

  try {
    // Resolve vision model for cache signatures
    let visionModelName = AppConfig.ai.imageAnalysis.defaultModel;
    try {
      const cfgModel = await loadOllamaConfig();
      visionModelName =
        getOllamaVisionModel() ||
        cfgModel.selectedVisionModel ||
        AppConfig.ai.imageAnalysis.defaultModel;
    } catch (err) {
      logger.debug('[IMAGE] Config load failed, using default model:', err.message);
      visionModelName = AppConfig.ai.imageAnalysis.defaultModel;
    }

    // First, check if file exists and has content
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (statError) {
      // Handle ENOENT and other file access errors gracefully
      if (statError.code === 'ENOENT') {
        logger.error(`Image file does not exist`, { path: filePath });
        return {
          error: 'Image file not found (ENOENT)',
          category: 'error',
          keywords: [],
          confidence: 0
        };
      }
      throw statError; // Re-throw other errors
    }

    if (stats.size === 0) {
      logger.error(`Image file is empty`, { path: filePath });
      return {
        error: 'Image file is empty (0 bytes)',
        category: 'error',
        keywords: [],
        confidence: 0
      };
    }

    logger.debug(`Image file size`, { bytes: stats.size });

    // Handle TOCTOU race condition - file could be deleted between stat() and readFile()
    let imageBuffer;
    try {
      imageBuffer = await fs.readFile(filePath);
    } catch (readError) {
      if (readError.code === 'ENOENT') {
        logger.error(`Image file disappeared during read`, { path: filePath });
        return {
          error: 'Image file was deleted during analysis (TOCTOU)',
          category: 'error',
          keywords: [],
          confidence: 0
        };
      }
      throw readError; // Re-throw other errors
    }

    // Cache quick path: signature based on file stats
    const signature = `${IMAGE_SIGNATURE_VERSION}|${visionModelName}|${smartFolderSig}|${filePath}|${stats.size}|${stats.mtimeMs}`;
    if (!bypassCache && imageAnalysisCache.has(signature)) {
      // FIX CRIT-28: Check TTL
      const cached = imageAnalysisCache.get(signature);
      if (Date.now() - cached.timestamp < IMAGE_CACHE_TTL_MS) {
        return cached.value;
      }
      imageAnalysisCache.delete(signature);
    }
    if (bypassCache) {
      logger.debug('[IMAGE] Bypassing analysis cache for reanalysis', { filePath });
    }

    // Extract EXIF date and preprocess image using helpers
    const exifDate = await extractExifDate(imageBuffer);
    try {
      imageBuffer = await preprocessImageBuffer(imageBuffer, fileExtension);
    } catch (preErr) {
      logger.error(`Failed to pre-process image for analysis`, {
        path: filePath,
        error: preErr.message
      });
      const fallback = createFallbackResult(
        fileName,
        fileExtension,
        'image preprocessing failed',
        40,
        smartFolders
      );
      fallback.error = preErr.message;
      return fallback;
    }

    // Validate buffer is not empty
    if (imageBuffer.length === 0) {
      logger.error(`Image buffer is empty after reading`, { path: filePath });
      return {
        error: 'Image buffer is empty after reading',
        category: 'error',
        keywords: [],
        confidence: 0
      };
    }

    logger.debug(`Image buffer size`, { bytes: imageBuffer.length });
    const imageBase64 = imageBuffer.toString('base64');

    // FIX P1-1: Release image buffer immediately after base64 conversion
    // This prevents holding potentially large (10MB+) buffers in memory during
    // subsequent async operations (Ollama analysis, semantic matching, etc.)
    imageBuffer = null;

    // Validate base64 encoding
    if (!imageBase64 || imageBase64.length === 0) {
      logger.error(`Image base64 encoding failed`, { path: filePath });
      return {
        error: 'Image base64 encoding failed',
        category: 'error',
        keywords: [],
        confidence: 0
      };
    }

    logger.debug(`Base64 length`, { chars: imageBase64.length });

    // ANTI-HALLUCINATION: Extract text from image FIRST to ground the vision analysis
    // This provides OCR-based ground truth that can validate/override visual interpretation
    let extractedText = null;
    try {
      // Only attempt OCR for images that might contain text (documents, screenshots, etc.)
      const fileNameLower = fileName.toLowerCase();
      const mightContainText =
        fileNameLower.includes('report') ||
        fileNameLower.includes('document') ||
        fileNameLower.includes('invoice') ||
        fileNameLower.includes('receipt') ||
        fileNameLower.includes('form') ||
        fileNameLower.includes('screenshot') ||
        fileNameLower.includes('screen') ||
        fileNameLower.includes('budget') ||
        fileNameLower.includes('financial') ||
        fileNameLower.includes('statement') ||
        fileNameLower.includes('tax');

      if (mightContainText) {
        logger.debug('[IMAGE] Filename suggests document content, attempting OCR pre-extraction');
        extractedText = await extractTextFromImage(filePath);
        if (extractedText && extractedText.length > 20) {
          logger.info('[IMAGE] OCR pre-extraction successful', {
            textLength: extractedText.length,
            preview: extractedText.slice(0, 100)
          });
        }
      }
    } catch (ocrError) {
      // Non-fatal: OCR failure doesn't block analysis, just means no grounding
      logger.debug('[IMAGE] OCR pre-extraction failed (non-fatal):', ocrError.message);
    }

    // Analyze with Ollama, passing extracted text for grounding
    let namingContext = [];
    try {
      // Try to get folder matcher to find similar files for naming context
      const chromaDb = container.tryResolve(ServiceIds.CHROMA_DB);
      if (chromaDb) {
        if (chromaDb !== chromaDbSingleton) chromaDbSingleton = chromaDb;
        if (!folderMatcherSingleton) folderMatcherSingleton = new FolderMatchingService(chromaDb);

        // Only if we have some text or at least a filename to embed
        const textForEmbedding = (extractedText || fileName || '').slice(0, 1000);
        if (folderMatcherSingleton && textForEmbedding) {
          if (!folderMatcherSingleton.embeddingCache?.initialized) {
            await folderMatcherSingleton.initialize();
          }
          const { vector } = await folderMatcherSingleton.embedText(textForEmbedding);
          const similarFiles = await folderMatcherSingleton.findSimilarFilesByVector(vector, 5);
          namingContext = similarFiles
            .filter((f) => f.metadata && f.metadata.name && f.metadata.name !== fileName)
            .map((f) => f.metadata.name);

          if (namingContext.length > 0) {
            logger.debug('[IMAGE] Found similar files for naming context', {
              count: namingContext.length
            });
          }
        }
      }
    } catch (ncError) {
      logger.debug('[IMAGE] Failed to get naming context', { error: ncError.message });
    }

    let analysis;
    try {
      analysis = await analyzeImageWithOllama(
        imageBase64,
        fileName,
        smartFolders,
        extractedText,
        namingContext
      );

      // Merge EXIF date if available and Ollama didn't return a valid date (or override it?)
      // The plan says "populate the date field without asking LLM".
      // We'll trust EXIF over LLM hallucination if EXIF is present.
      if (exifDate) {
        if (!analysis) analysis = {};
        analysis.date = exifDate;
      }

      // ANTI-HALLUCINATION: Validate analysis against filename and OCR text
      if (analysis && !analysis.error) {
        analysis = validateAnalysisConsistency(analysis, fileName, extractedText);
      }
    } catch (error) {
      logger.error('[IMAGE] Error calling analyzeImageWithOllama', {
        error: error.message,
        filePath
      });
      const fallback = createFallbackResult(
        fileName,
        fileExtension,
        'analysis error',
        55,
        smartFolders
      );
      const extractedTextForStorage = normalizeExtractedTextForStorage(extractedText);
      if (extractedTextForStorage) {
        fallback.extractedText = extractedTextForStorage;
      }
      fallback.error = error.message;
      return fallback;
    }

    // If OCR not performed earlier, attempt it now when the analysis indicates text content.
    if ((!extractedText || extractedText.length < 20) && analysis && !analysis.error) {
      const contentType = String(analysis.content_type || '').toLowerCase();
      const wantsOcr =
        analysis.has_text === true ||
        contentType.includes('text') ||
        contentType.includes('document') ||
        contentType.includes('screenshot');
      if (wantsOcr) {
        try {
          logger.debug('[IMAGE] Analysis indicates text content, attempting OCR post-extraction');
          extractedText = await extractTextFromImage(filePath);
          if (extractedText && extractedText.length > 20) {
            logger.info('[IMAGE] OCR post-extraction successful', {
              textLength: extractedText.length,
              preview: extractedText.slice(0, 100)
            });
            analysis = validateAnalysisConsistency(analysis, fileName, extractedText);
          }
        } catch (ocrError) {
          logger.debug('[IMAGE] OCR post-extraction failed (non-fatal):', ocrError.message);
        }
      }
    }

    const extractedTextForStorage = normalizeExtractedTextForStorage(extractedText);

    // Semantic folder refinement using embeddings (delegated to helper)
    try {
      await applySemanticFolderMatching(
        analysis,
        filePath,
        smartFolders,
        stats?.size,
        extractedTextForStorage
      );
    } catch (error) {
      logger.warn('[IMAGE] Unexpected error in semantic folder refinement:', {
        error: error?.message,
        filePath
      });
    }

    // Ensure analysis is defined before checking properties
    if (!analysis) {
      logger.warn('[IMAGE] analyzeImageWithOllama returned undefined', {
        filePath
      });
      const result = createFallbackResult(
        fileName,
        fileExtension,
        'undefined result',
        60,
        smartFolders
      );
      result.error = 'Ollama image analysis returned undefined';
      if (extractedTextForStorage) {
        result.extractedText = extractedTextForStorage;
      }
      try {
        setImageCache(signature, result);
      } catch {
        // Non-fatal if caching fails
      }
      return result;
    }

    if (analysis && !analysis.error) {
      // Ensure the original file extension is preserved in suggestedName
      let finalSuggestedName = analysis.suggestedName;
      if (finalSuggestedName && fileExtension) {
        const suggestedExt = path.extname(finalSuggestedName);
        if (!suggestedExt) {
          finalSuggestedName += fileExtension;
        }
      }
      const normalizedCategory =
        typeof analysis.category === 'string' && analysis.category.trim().length > 0
          ? normalizeCategoryToSmartFolder(analysis.category, smartFolders)
          : analysis.category;
      const normalized = normalizeAnalysisResult(
        {
          ...analysis,
          category: normalizedCategory || analysis.category,
          content_type: analysis.content_type || 'unknown',
          suggestedName: finalSuggestedName || safeSuggestedName(fileName, fileExtension),
          extractedText: extractedTextForStorage
        },
        { category: 'image', keywords: [] }
      );
      try {
        setImageCache(signature, normalized);
      } catch {
        // Non-fatal if caching fails
      }
      return normalized;
    }

    // Fallback analysis if Ollama fails
    const result = createFallbackResult(fileName, fileExtension, 'Ollama failed', 60, smartFolders);
    // Preserve keywords from partial analysis if available
    if (Array.isArray(analysis.keywords)) {
      result.keywords = analysis.keywords;
    }
    if (extractedTextForStorage) {
      result.extractedText = extractedTextForStorage;
    }
    result.error = analysis?.error || 'Ollama image analysis failed.';
    try {
      setImageCache(signature, result);
    } catch {
      // Non-fatal if caching fails
    }
    return result;
  } catch (error) {
    logger.error('Error processing image', { filePath, error: error.message });
    return {
      error: `Failed to process image: ${error.message}`,
      category: 'error',
      project: fileName,
      keywords: [],
      confidence: 50
    };
  }
}

// OCR capability using Ollama for text extraction from images
async function extractTextFromImage(filePath) {
  try {
    // FIX CRIT-30: Check file size before reading to prevent memory exhaustion
    const stats = await fs.stat(filePath);
    const MAX_OCR_SIZE = 20 * 1024 * 1024; // 20MB limit for OCR
    if (stats.size > MAX_OCR_SIZE) {
      logger.warn('[IMAGE] Skipping OCR for large file:', {
        filePath,
        size: stats.size,
        limit: MAX_OCR_SIZE
      });
      return null;
    }

    const imageBuffer = await fs.readFile(filePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `Extract all readable text from this image. Return only the text content, maintaining the original structure and formatting as much as possible. If no text is found, return "NO_TEXT_FOUND".`;

    const cfg2 = await loadOllamaConfig();
    const modelToUse2 =
      getOllamaVisionModel() || cfg2.selectedVisionModel || AppConfig.ai.imageAnalysis.defaultModel;
    const client2 = await getOllama();
    const response = await generateWithRetry(
      client2,
      {
        model: modelToUse2,
        prompt,
        images: [imageBase64],
        options: {
          temperature: 0.1, // Lower temperature for text extraction
          num_predict: 2000
        }
      },
      {
        operation: `Text extraction from image ${path.basename(filePath)}`,
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 4000
      }
    );

    if (response.response && response.response.trim() !== 'NO_TEXT_FOUND') {
      return response.response.trim();
    }

    return null;
  } catch (error) {
    logger.error('Error extracting text from image', { error: error.message });
    return null;
  }
}

// Fallback image helpers sourced from fallbackUtils

/**
 * Force flush the embedding queue (useful for cleanup or end of batch)
 */
async function flushAllEmbeddings() {
  await embeddingQueue.flush();
}

/**
 * Reset module singletons and caches
 * Useful for hot reload, testing, or reconnecting to services
 */
function resetSingletons() {
  chromaDbSingleton = null;
  folderMatcherSingleton = null;
  imageAnalysisCache.clear();
}

module.exports = {
  analyzeImageFile,
  extractTextFromImage,
  flushAllEmbeddings,
  resetSingletons
};
