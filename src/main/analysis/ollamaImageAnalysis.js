const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { getOllamaVisionModel, loadOllamaConfig, getOllama } = require('../ollamaUtils');
const { buildOllamaOptions } = require('../services/PerformanceService');
const { globalDeduplicator } = require('../utils/llmOptimization');
const { generateWithRetry } = require('../utils/ollamaApiRetry');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { attemptJsonRepairWithOllama } = require('../utils/ollamaJsonRepair');
const { AI_DEFAULTS, SUPPORTED_IMAGE_EXTENSIONS } = require('../../shared/constants');
const { TRUNCATION, TIMEOUTS } = require('../../shared/performanceConstants');
const { withAbortableTimeout } = require('../../shared/promiseUtils');
const { ANALYSIS_SCHEMA_PROMPT } = require('../../shared/analysisSchema');
const { normalizeAnalysisResult } = require('./utils');
const { normalizeExtractedTextForStorage } = require('./analysisTextUtils');
const {
  getIntelligentCategory: getIntelligentImageCategory,
  getIntelligentKeywords: getIntelligentImageKeywords,
  safeSuggestedName,
  createFallbackAnalysis
} = require('./fallbackUtils');
const FolderMatchingService = require('../services/FolderMatchingService');
const { analysisQueue } = require('./embeddingQueue/stageQueues');
const embeddingQueueManager = require('./embeddingQueue/queueManager');
const { createLogger } = require('../../shared/logger');
const { findContainingSmartFolder } = require('../../shared/folderUtils');
const { getSemanticFileId } = require('../../shared/fileIdUtils');
const { shouldEmbed } = require('../services/embedding/embeddingGate');
const {
  applySemanticFolderMatching: applyUnifiedFolderMatching,
  getServices,
  resetSingletons: resetMatcherSingletons
} = require('./semanticFolderMatcher');
const { getImageAnalysisCache } = require('../services/AnalysisCacheService');

const logger = createLogger('OllamaImageAnalysis');
const IMAGE_SIGNATURE_VERSION = 'v2';

/**
 * Set image cache value with automatic TTL and LRU eviction
 * @param {string} signature - Cache key
 * @param {Object} value - Value to cache
 */
function setImageCache(signature, value) {
  if (!signature) return;
  getImageAnalysisCache().set(signature, value);
}

// App configuration for image analysis - Optimized for speed
const AppConfig = {
  ai: {
    imageAnalysis: {
      defaultModel: AI_DEFAULTS.IMAGE.MODEL,
      defaultHost: AI_DEFAULTS.IMAGE.HOST,
      // Keep image analysis aligned with global processing timeouts so the renderer lock
      // doesn't get "stuck" for minutes when vision calls hang.
      timeout: TIMEOUTS.AI_ANALYSIS_LONG,
      temperature: AI_DEFAULTS.IMAGE.TEMPERATURE,
      maxTokens: AI_DEFAULTS.IMAGE.MAX_TOKENS
    }
  }
};

const OCR_DEFAULTS = {
  timeoutMs: TIMEOUTS.AI_ANALYSIS_MEDIUM,
  maxTokens: 1000,
  maxRetries: 1
};

const OCR_FILENAME_HINTS = [
  'report',
  'document',
  'invoice',
  'receipt',
  'form',
  'screenshot',
  'screen',
  'budget',
  'financial',
  'statement',
  'tax'
];

function hasTextNameHint(fileNameLower) {
  return OCR_FILENAME_HINTS.some((hint) => fileNameLower.includes(hint));
}

// JSON repair constants and function consolidated to ../utils/ollamaJsonRepair.js
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
        purpose: { type: ['string', 'null'] },
        summary: { type: ['string', 'null'] },
        keywords: { type: 'array', items: { type: 'string' } },
        keyEntities: { type: 'array', items: { type: 'string' } },
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

// Local attemptJsonRepairWithOllama removed - using ../utils/ollamaJsonRepair.js

async function analyzeImageWithOllama(
  imageBase64,
  originalFileName,
  smartFolders = [],
  extractedText = null,
  namingContext = []
) {
  try {
    const startedAt = Date.now();
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
Always include "keyEntities" as an array (use [] if none are found).
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
    // Include 'type' to prevent cross-file cache contamination with document analysis
    const safeFolders = Array.isArray(smartFolders) ? smartFolders : [];
    // Use a proper hash instead of slicing the first N chars of base64.
    // Slicing is a weak signature: images with similar headers/metadata can
    // share the same prefix, causing false dedup hits. MD5 is fast and
    // collision-resistant enough for cache keying (not security-sensitive).
    const imageHash = crypto.createHash('md5').update(imageBase64).digest('hex');
    const deduplicationKey = globalDeduplicator.generateKey({
      type: 'image', // Prevent cross-type contamination with document analysis
      fileName: originalFileName,
      imageHash,
      model: modelToUse,
      // FIX: Guard against null/undefined elements in safeFolders array
      folders: safeFolders.map((f) => f?.name || '').join(',')
    });

    const client = await getOllama();
    const perfOptions = await buildOllamaOptions('vision');
    const useToolCalling = Boolean(cfg?.useToolCalling);

    // IMPORTANT: Vision model calls can hang indefinitely if the model/server gets stuck.
    // Enforce a hard timeout and abort the underlying request (supported by Ollama client).
    const timeoutMs = Number(AppConfig.ai.imageAnalysis.timeout) || 60000;
    const response = await withAbortableTimeout(
      (abortController) => {
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
        // Reduce retries to prevent exceeding outer timeout
        // With 60s outer timeout and ~20s per LLM call, 2 retries (3 attempts) + delays fits within budget
        return globalDeduplicator.deduplicate(
          deduplicationKey,
          () =>
            generateWithRetry(client, generateRequest, {
              operation: `Image analysis for ${originalFileName}`,
              maxRetries: 2,
              initialDelay: 1000,
              maxDelay: 2000,
              maxTotalTime: timeoutMs
            }),
          { type: 'image', fileName: originalFileName } // Metadata for debugging cache hits
        );
      },
      timeoutMs,
      `Image analysis for ${originalFileName}`
    );

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
            response.response,
            {
              schema: IMAGE_ANALYSIS_SCHEMA,
              maxTokens: AppConfig.ai.imageAnalysis.maxTokens,
              operation: 'Image analysis'
            }
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
          const dateObj = new Date(parsedJson.date);
          if (isNaN(dateObj.getTime())) {
            delete parsedJson.date;
            logger.warn('Ollama returned an invalid date for image, omitting.');
          } else {
            parsedJson.date = dateObj.toISOString().split('T')[0];
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
        // Use fixed default instead of random value
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

  // CRITICAL: Detect financial document → landscape hallucination
  if (filenameIsFinancial && suggestedIsLandscape) {
    warnings.push('HALLUCINATION DETECTED: Suggested landscape name for financial document');
    analysis.confidence = Math.min(analysis.confidence || 75, 25);
    analysis.hallucination_detected = true;

    // Override with filename-based suggestion
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

// createFallbackResult and normalizeCategoryToSmartFolder removed
// Now using createFallbackAnalysis from ./fallbackUtils
// For category normalization, use FolderMatchingService.matchCategoryToFolder directly

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
        const dateVal = exif.exif?.DateTimeOriginal || exif.image?.ModifyDate;
        if (dateVal) {
          let dateResult;
          if (dateVal instanceof Date) {
            // exif-reader v2 returns Date objects
            if (!isNaN(dateVal.getTime())) {
              dateResult = dateVal.toISOString().split('T')[0];
            }
          } else {
            // Legacy string format: "2024:01:15 10:30:00"
            const parts = String(dateVal).split(' ')[0].replace(/:/g, '-');
            if (parts.match(/^\d{4}-\d{2}-\d{2}$/)) {
              dateResult = parts;
            }
          }
          if (dateResult) {
            logger.debug(`[IMAGE] Extracted EXIF date: ${dateResult}`);
            return dateResult;
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
  // Wrap entire preprocessing in try/catch to catch synchronous sharp errors
  try {
    const needsFormatConversion = [
      '.svg',
      '.tiff',
      '.tif',
      '.bmp',
      '.gif',
      '.webp',
      '.heic',
      '.ico'
    ].includes(fileExtension);
    const maxDimension = 1024; // Reduced from 1536 to prevent timeouts on large images while maintaining quality

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

// ============================================================================
// Main Analysis Function
// ============================================================================

async function analyzeImageFile(filePath, smartFolders = [], options = {}) {
  logger.info(`Analyzing image file`, { path: filePath });
  const bypassCache = Boolean(options?.bypassCache);
  const fileExtension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const fileNameLower = fileName.toLowerCase();
  const resolvedSmartFolder = findContainingSmartFolder(filePath, smartFolders);
  const isInSmartFolder = Boolean(resolvedSmartFolder);
  const hasTextHint = hasTextNameHint(fileNameLower);
  let ocrAttempted = false;
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
        path.basename(fileName, fileExtension).replace(/[^a-zA-Z0-9_-]/g, '_') + fileExtension
    };
  }

  // Fixed: Proactive graceful degradation - check Ollama availability before processing
  // Use shared detection logic with retries (Ollama may be slow when loading models)
  const { isOllamaRunningWithRetry } = require('../utils/ollamaDetection');
  const { getOllamaHost } = require('../ollamaUtils');

  try {
    const host = getOllamaHost(); // Use configured host, not hardcoded default
    const isRunning = await isOllamaRunningWithRetry(host);
    if (!isRunning) {
      logger.warn(
        '[ANALYSIS-FALLBACK] Ollama unavailable after retries, using filename-based analysis',
        { host }
      );
      return createFallbackAnalysis({
        fileName,
        fileExtension,
        reason: 'Ollama unavailable',
        smartFolders,
        confidence: 60,
        type: 'image'
      });
    }
  } catch (error) {
    logger.error('[IMAGE] Pre-flight verification failed', {
      error: error.message
    });
    return createFallbackAnalysis({
      fileName,
      fileExtension,
      reason: error.message,
      smartFolders,
      confidence: 55,
      type: 'image'
    });
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

    // Verify required vision model is loaded before proceeding
    // This prevents analysis from timing out on guaranteed failures when model isn't available
    try {
      const ollama = await getOllama();
      const modelList = await ollama.list();
      const availableModels = modelList?.models || [];
      const modelNames = availableModels.map((m) => m.name || m.model || '');
      // Check if the vision model (or a variant with tag) is available
      const modelBase = visionModelName.split(':')[0];
      const isModelAvailable = modelNames.some(
        (name) => name === visionModelName || name.startsWith(modelBase + ':') || name === modelBase
      );
      if (!isModelAvailable) {
        logger.warn('[IMAGE] Vision model not available, using filename-based analysis', {
          requiredModel: visionModelName,
          availableModels: modelNames.slice(0, 5) // Log first 5 for debugging
        });
        return createFallbackAnalysis({
          fileName,
          fileExtension,
          reason: `Vision model '${visionModelName}' not loaded`,
          smartFolders,
          confidence: 55,
          type: 'image'
        });
      }
    } catch (modelCheckError) {
      // If model check fails, log but continue - the analysis may still work
      logger.debug('[IMAGE] Model availability check failed, proceeding anyway', {
        error: modelCheckError.message
      });
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

    // Guard against oversized images that would exhaust memory
    const MAX_IMAGE_SIZE = 100 * 1024 * 1024; // 100MB
    if (stats.size > MAX_IMAGE_SIZE) {
      logger.error(`Image file too large`, {
        bytes: stats.size,
        maxBytes: MAX_IMAGE_SIZE,
        path: filePath
      });
      return {
        error: `Image file too large (${(stats.size / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit)`,
        category: 'error',
        keywords: [],
        confidence: 0
      };
    }

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
    // LRUCache handles TTL automatically - get() returns null for expired entries
    const signature = `${IMAGE_SIGNATURE_VERSION}|${visionModelName}|${smartFolderSig}|${filePath}|${stats.size}|${stats.mtimeMs}`;
    if (!bypassCache) {
      const cached = getImageAnalysisCache().get(signature);
      if (cached != null) {
        return cached;
      }
    } else {
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
      return createFallbackAnalysis({
        fileName,
        fileExtension,
        reason: 'image preprocessing failed',
        smartFolders,
        confidence: 40,
        type: 'image',
        options: { error: preErr.message }
      });
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
    // Release image buffer immediately after base64 conversion
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
      if (hasTextHint) {
        logger.debug('[IMAGE] Filename suggests document content, attempting OCR pre-extraction');
        ocrAttempted = true;
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
      const { matcher } = getServices();
      if (matcher) {
        // Only if we have some text or at least a filename to embed
        const textForEmbedding = (extractedText || fileName || '').slice(0, 1000);
        if (textForEmbedding) {
          if (!matcher.embeddingCache?.initialized) {
            await matcher.initialize();
          }
          const { vector } = await matcher.embedText(textForEmbedding);
          const similarFiles = await matcher.findSimilarFilesByVector(vector, 5);
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
      const fallback = createFallbackAnalysis({
        fileName,
        fileExtension,
        reason: 'analysis error',
        smartFolders,
        confidence: 55,
        type: 'image',
        options: { error: error.message }
      });
      const extractedTextForStorage = normalizeExtractedTextForStorage(extractedText);
      if (extractedTextForStorage) {
        fallback.extractedText = extractedTextForStorage;
      }
      return fallback;
    }

    // If OCR not performed earlier, attempt it now when the analysis indicates text content.
    if (
      (!extractedText || extractedText.length < 20) &&
      analysis &&
      !analysis.error &&
      !ocrAttempted
    ) {
      const contentType = String(analysis.content_type || '').toLowerCase();
      const contentSuggestsText =
        contentType.includes('text') ||
        contentType.includes('document') ||
        contentType.includes('screenshot');
      const wantsOcr = analysis.has_text === true || (contentSuggestsText && hasTextHint);
      if (wantsOcr) {
        try {
          logger.debug('[IMAGE] Analysis indicates text content, attempting OCR post-extraction');
          ocrAttempted = true;
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

    // Semantic folder refinement using embeddings
    // MIGRATION: Now uses unified semanticFolderMatcher module
    try {
      await applyUnifiedFolderMatching({
        analysis,
        filePath,
        fileName: path.basename(filePath),
        fileExtension: path.extname(filePath),
        fileSize: stats?.size,
        smartFolders,
        extractedText: extractedTextForStorage,
        type: 'image'
      });

      // Explicitly queue embedding for images to ensure they are searchable
      // even if they don't have OCR text (using keywords/description instead)
      const { matcher } = getServices();
      const gate = await shouldEmbed({ stage: 'analysis' });
      if (matcher && analysis && isInSmartFolder && gate.shouldEmbed) {
        const textParts = [
          analysis.suggestedName,
          analysis.summary,
          analysis.category,
          ...(analysis.keywords || [])
        ].filter(Boolean);

        // Include OCR text if available to boost search relevance
        if (extractedTextForStorage) {
          textParts.push(extractedTextForStorage.slice(0, 1000));
        }

        const textToEmbed = textParts.join(' ');
        if (textToEmbed.length > 0) {
          // Initialize if needed
          if (!matcher.embeddingCache?.initialized) {
            await matcher.initialize();
          }

          const { vector } = await matcher.embedText(textToEmbed);
          if (vector) {
            await embeddingQueueManager.removeByFilePath?.(filePath);
            await analysisQueue.enqueue({
              id: getSemanticFileId(filePath),
              path: filePath,
              text: textToEmbed,
              vector,
              meta: {
                name: fileName,
                fileSize: stats?.size,
                fileExtension,
                analysis,
                type: 'image',
                smartFolder: resolvedSmartFolder?.name || null,
                smartFolderPath: resolvedSmartFolder?.path || null
              }
            });
            logger.debug('[IMAGE] Queued embedding for persistence', { path: filePath });
          }
        }
      } else if (matcher && analysis && !isInSmartFolder) {
        logger.debug('[IMAGE] Skipping embedding persistence (not in smart folder)', {
          path: filePath
        });
      } else if (matcher && analysis && isInSmartFolder && !gate.shouldEmbed) {
        logger.debug('[IMAGE] Skipping embedding persistence by policy/timing gate', {
          path: filePath,
          timing: gate.timing,
          policy: gate.policy
        });
      }
    } catch (error) {
      logger.warn('[IMAGE] Unexpected error in semantic folder refinement or embedding:', {
        error: error?.message,
        filePath
      });
    }

    // Ensure analysis is defined before checking properties
    if (!analysis) {
      logger.warn('[IMAGE] analyzeImageWithOllama returned undefined', {
        filePath
      });
      const result = createFallbackAnalysis({
        fileName,
        fileExtension,
        reason: 'undefined result',
        smartFolders,
        confidence: 60,
        type: 'image',
        options: { error: 'Ollama image analysis returned undefined' }
      });
      if (extractedTextForStorage) {
        result.extractedText = extractedTextForStorage;
      }
      try {
        setImageCache(signature, result);
      } catch (cacheError) {
        // Log cache failures for debugging instead of silent swallowing
        logger.debug('[IMAGE] Cache write failed (non-fatal):', cacheError?.message);
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
          ? FolderMatchingService.matchCategoryToFolder(analysis.category, smartFolders)
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
      } catch (cacheError) {
        // FIX #5: Log cache failures for debugging instead of silent swallowing
        logger.debug('[IMAGE] Cache write failed (non-fatal):', cacheError?.message);
      }
      return normalized;
    }

    // Fallback analysis if Ollama fails
    const result = createFallbackAnalysis({
      fileName,
      fileExtension,
      reason: 'Ollama failed',
      smartFolders,
      confidence: 60,
      type: 'image',
      options: { error: analysis?.error || 'Ollama image analysis failed.' }
    });
    // Add null check before accessing analysis.keywords
    // Preserve keywords from partial analysis if available
    if (analysis && Array.isArray(analysis.keywords)) {
      result.keywords = analysis.keywords;
    }
    if (extractedTextForStorage) {
      result.extractedText = extractedTextForStorage;
    }
    try {
      setImageCache(signature, result);
    } catch (cacheError) {
      // Log cache failures for debugging instead of silent swallowing
      logger.debug('[IMAGE] Cache write failed (non-fatal):', cacheError?.message);
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
async function extractTextFromImage(filePath, options = {}) {
  let timeoutMs = OCR_DEFAULTS.timeoutMs;
  try {
    const MAX_OCR_SIZE = 20 * 1024 * 1024; // 20MB limit for OCR
    const fileExtension = (options.fileExtension || path.extname(filePath)).toLowerCase();
    let imageBuffer = options.buffer;

    // Check file size before reading to prevent memory exhaustion
    if (imageBuffer) {
      if (imageBuffer.length > MAX_OCR_SIZE) {
        logger.warn('[IMAGE] Skipping OCR for large buffer:', {
          filePath,
          size: imageBuffer.length,
          limit: MAX_OCR_SIZE
        });
        return null;
      }
    } else {
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_OCR_SIZE) {
        logger.warn('[IMAGE] Skipping OCR for large file:', {
          filePath,
          size: stats.size,
          limit: MAX_OCR_SIZE
        });
        return null;
      }
      imageBuffer = await fs.readFile(filePath);
    }

    // Preprocess image for model compatibility (resize/convert)
    try {
      imageBuffer = await preprocessImageBuffer(imageBuffer, fileExtension);
    } catch (preprocessError) {
      logger.warn('[IMAGE-OCR] Preprocessing failed, skipping OCR', {
        filePath,
        error: preprocessError.message
      });
      return null;
    }

    const imageBase64 = imageBuffer.toString('base64');
    imageBuffer = null;

    const prompt = `Extract all readable text from this image. Return only the text content, maintaining the original structure and formatting as much as possible. If no text is found, return "NO_TEXT_FOUND".`;

    const cfg2 = await loadOllamaConfig();
    const modelToUse2 =
      getOllamaVisionModel() || cfg2.selectedVisionModel || AppConfig.ai.imageAnalysis.defaultModel;
    const client2 = await getOllama();
    timeoutMs =
      Number(process.env.AI_OCR_TIMEOUT) ||
      OCR_DEFAULTS.timeoutMs ||
      TIMEOUTS.AI_ANALYSIS_MEDIUM ||
      60000;
    logger.debug('[IMAGE-OCR] Using vision model for OCR', {
      model: modelToUse2,
      fileName: path.basename(filePath),
      timeoutMs
    });
    const response = await withAbortableTimeout(
      (abortController) =>
        generateWithRetry(
          client2,
          {
            model: modelToUse2,
            prompt,
            images: [imageBase64],
            options: {
              temperature: 0.1, // Lower temperature for text extraction
              num_predict: OCR_DEFAULTS.maxTokens
            },
            signal: abortController.signal
          },
          {
            operation: `Text extraction from image ${path.basename(filePath)}`,
            maxRetries: OCR_DEFAULTS.maxRetries,
            initialDelay: 1000,
            maxDelay: 2000,
            maxTotalTime: timeoutMs
          }
        ),
      timeoutMs,
      `Image OCR for ${path.basename(filePath)}`
    );

    if (response.response && response.response.trim() !== 'NO_TEXT_FOUND') {
      return response.response.trim();
    }

    return null;
  } catch (error) {
    const message = error?.message || 'OCR failed';
    const lowerMessage = message.toLowerCase();
    const isTimeout =
      error?.name === 'AbortError' ||
      lowerMessage.includes('timed out') ||
      lowerMessage.includes('aborted');
    if (isTimeout) {
      logger.warn('[IMAGE-OCR] OCR timed out, skipping', {
        fileName: path.basename(filePath),
        timeoutMs
      });
      return null;
    }
    logger.error('Error extracting text from image', { error: message });
    return null;
  }
}

// Fallback image helpers sourced from fallbackUtils

/**
 * Force flush the embedding queue (useful for cleanup or end of batch)
 */
async function flushAllEmbeddings() {
  await analysisQueue.flush();
}

/**
 * Reset module singletons and caches
 * Useful for hot reload, testing, or reconnecting to services
 */
function resetSingletons() {
  // Delegate to unified matcher reset for shared singletons
  resetMatcherSingletons();
  // Clear local image analysis cache
  getImageAnalysisCache().clear();
}

module.exports = {
  analyzeImageFile,
  extractTextFromImage,
  flushAllEmbeddings,
  resetSingletons
};
