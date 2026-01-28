const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const {
  SUPPORTED_TEXT_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  AI_DEFAULTS
} = require('../../shared/constants');
const { TRUNCATION, TIMEOUTS } = require('../../shared/performanceConstants');
const { logger } = require('../../shared/logger');
const { getOllamaModel, loadOllamaConfig } = require('../ollamaUtils');
const { AppConfig } = require('./documentLlm');

// Enforce required dependency for AI-first operation
const {
  extractTextFromPdf,
  ocrPdfIfNeeded,
  extractTextFromDoc,
  extractTextFromDocx,
  extractTextFromCsv,
  extractTextFromXlsx,
  extractTextFromPptx,
  extractTextFromXls,
  extractTextFromPpt,
  extractTextFromOdfZip,
  extractTextFromEpub,
  extractTextFromEml,
  extractTextFromMsg,
  extractTextFromKml,
  extractTextFromKmz,
  extractPlainTextFromRtf,
  extractPlainTextFromXml,
  extractPlainTextFromHtml
} = require('./documentExtractors');
const { analyzeTextWithOllama, normalizeCategoryToSmartFolders } = require('./documentLlm');
const { normalizeAnalysisResult } = require('./utils');
const { normalizeExtractedTextForStorage } = require('./analysisTextUtils');
const {
  getIntelligentCategory,
  getIntelligentKeywords,
  safeSuggestedName,
  createFallbackAnalysis
} = require('./fallbackUtils');
const embeddingQueue = require('./embeddingQueue');
const { globalDeduplicator } = require('../utils/llmOptimization');
const {
  applySemanticFolderMatching: applyUnifiedFolderMatching,
  getServices
} = require('./semanticFolderMatcher');
const { LRUCache } = require('../../shared/LRUCache');

// Cache configuration constants
const CACHE_CONFIG = {
  MAX_FILE_CACHE: 500, // Maximum number of files to cache in memory
  FALLBACK_CONFIDENCE: 65, // Confidence score for fallback analysis
  DEFAULT_CONFIDENCE: 85, // Default confidence for successful analysis
  CACHE_TTL_MS: 30 * 60 * 1000 // 30 minute TTL to prevent memory leaks
};
const ANALYSIS_SIGNATURE_VERSION = 'v2';

const fileAnalysisCache = new LRUCache({
  maxSize: CACHE_CONFIG.MAX_FILE_CACHE,
  ttlMs: CACHE_CONFIG.CACHE_TTL_MS,
  lruStrategy: 'insertion', // FIFO-style for file analysis cache
  name: 'FileAnalysisCache'
});

/**
 * Get cached value if exists and not expired
 * @param {string} signature - Cache key
 * @returns {Object|null} Cached value or null if expired/missing
 */
function getFileCache(signature) {
  if (!signature) return null;
  return fileAnalysisCache.get(signature);
}

/**
 * Set cache value with automatic TTL and LRU eviction
 * @param {string} signature - Cache key
 * @param {Object} value - Value to cache
 */
function setFileCache(signature, value) {
  if (!signature) return;
  fileAnalysisCache.set(signature, value);
}

/**
 * Cache result only if file remains unchanged, and evict if it changes immediately after.
 * @param {string} signature
 * @param {string} filePath
 * @param {fs.Stats|null} fileStats
 * @param {Object} value
 * @returns {Promise<boolean>} whether the cache was written and retained
 */
async function setFileCacheIfUnchanged(signature, filePath, fileStats, value) {
  if (!signature) return false;
  const unchangedBefore = await isFileUnchangedForCache(filePath, fileStats);
  if (!unchangedBefore) return false;
  setFileCache(signature, value);
  const unchangedAfter = await isFileUnchangedForCache(filePath, fileStats);
  if (!unchangedAfter) {
    fileAnalysisCache.delete(signature);
    return false;
  }
  return true;
}
/**
 * Verify the file has not changed since initial stat.
 * Skips caching if the file was modified during analysis.
 * @param {string} filePath
 * @param {fs.Stats|null} fileStats
 * @returns {Promise<boolean>}
 */
async function isFileUnchangedForCache(filePath, fileStats) {
  if (!filePath || !fileStats) return false;
  try {
    const latestStats = await fs.stat(filePath);
    return (
      latestStats.size === fileStats.size &&
      Number(latestStats.mtimeMs) === Number(fileStats.mtimeMs)
    );
  } catch (error) {
    logger.debug('Failed to re-stat file for cache validation', {
      path: filePath,
      error: error?.message
    });
    return false;
  }
}

// Import error handling system
const { FileProcessingError } = require('../errors/AnalysisError');

// Set logger context for this module
logger.setContext('DocumentAnalysis');

/**
 * Analyzes a document file using AI or fallback methods
 * @param {string} filePath - Path to the document file
 * @param {Array} smartFolders - Array of smart folder configurations
 * @returns {Promise<Object>} Analysis result with metadata
 */
async function analyzeDocumentFile(filePath, smartFolders = [], options = {}) {
  logger.info('Analyzing document file', { path: filePath });
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

  // Determine model in advance for cache signatures and deduplication
  const defaultTextModel = AppConfig?.ai?.textAnalysis?.defaultModel || AI_DEFAULTS.TEXT.MODEL;

  let modelName = defaultTextModel;
  try {
    const cfg = await loadOllamaConfig();
    modelName = getOllamaModel() || cfg.selectedTextModel || cfg.selectedModel || defaultTextModel;
  } catch {
    modelName = defaultTextModel;
  }

  // Step 1: Attempt to compute file signature and check cache (non-fatal if fails)
  let fileSignature = null;
  let fileStats = null;
  try {
    fileStats = await fs.stat(filePath);
    fileSignature = `${ANALYSIS_SIGNATURE_VERSION}|${modelName}|${smartFolderSig}|${filePath}|${fileStats.size}|${fileStats.mtimeMs}`;
    if (!bypassCache) {
      const cachedResult = getFileCache(fileSignature);
      if (cachedResult) {
        return cachedResult;
      }
      logger.debug('Cache miss, analyzing', { path: filePath });
    } else {
      logger.debug('Bypassing analysis cache for reanalysis', { path: filePath });
    }
  } catch (statError) {
    // Non-fatal: proceed without cache if stats fail
    logger.debug('Could not stat file for caching, proceeding with analysis', {
      path: filePath,
      error: statError.message
    });
  }

  // Get file date from stats or default to today
  // Some test fixtures (and some fs polyfills) may not provide a Date-valued mtime.
  const fileDate = (() => {
    const today = new Date().toISOString().split('T')[0];
    if (!fileStats) return today;

    // Prefer Date-valued mtime when available
    const { mtime } = fileStats;
    if (mtime && typeof mtime.toISOString === 'function') {
      return mtime.toISOString().split('T')[0];
    }

    // Fall back to numeric mtimeMs when present
    const { mtimeMs } = fileStats;
    if (typeof mtimeMs === 'number' && Number.isFinite(mtimeMs) && mtimeMs > 0) {
      return new Date(mtimeMs).toISOString().split('T')[0];
    }

    return today;
  })();

  // FAST SEMANTIC LABELING (Short-circuit)
  // Skip AI analysis for video files and use extension-based fallback immediately
  if ((SUPPORTED_VIDEO_EXTENSIONS || []).includes(fileExtension)) {
    const intelligentCategory = getIntelligentCategory(fileName, fileExtension, smartFolders);
    const intelligentKeywords = getIntelligentKeywords(fileName, fileExtension);
    const safeCategory = intelligentCategory || 'video';

    return {
      purpose: 'Video file',
      project: fileName.replace(fileExtension, ''),
      category: safeCategory,
      date: fileDate,
      keywords: intelligentKeywords,
      confidence: 80, // High confidence for known types
      suggestedName: safeSuggestedName(fileName, fileExtension),
      extractionMethod: 'extension_short_circuit'
    };
  }

  // Pre-flight checks for AI-first operation (graceful fallback if Ollama unavailable)
  try {
    // Check if Ollama is running using shared detection logic with retries
    // This is important because Ollama may be slow to respond when loading models
    const { isOllamaRunningWithRetry } = require('../utils/ollamaDetection');
    const { getOllamaHost } = require('../ollamaUtils');
    const host = getOllamaHost(); // Use configured host, not hardcoded default
    const isRunning = await isOllamaRunningWithRetry(host);

    if (!isRunning) {
      logger.warn('Ollama unavailable after retries. Using filename-based analysis.', { host });
      return createFallbackAnalysis({
        fileName,
        fileExtension,
        reason: 'Ollama unavailable',
        smartFolders,
        type: 'document',
        options: { date: fileDate }
      });
    }
  } catch (error) {
    logger.error('Pre-flight verification failed:', error);
    return createFallbackAnalysis({
      fileName,
      fileExtension,
      reason: 'Pre-flight verification failed',
      smartFolders,
      confidence: 65,
      type: 'document',
      options: { date: fileDate }
    });
  }

  // Step 2: Main content extraction and analysis (errors handled separately)
  try {
    let extractedText = null;

    if (fileExtension === '.pdf') {
      try {
        extractedText = await extractTextFromPdf(filePath, fileName);
        if (!extractedText || extractedText.trim().length === 0) {
          // Try OCR fallback for image-only PDFs
          const ocrText = await ocrPdfIfNeeded(filePath);
          extractedText = ocrText || '';
        }
      } catch (pdfError) {
        logger.error(`Error parsing PDF`, {
          fileName,
          error: pdfError.message
        });
        // Attempt OCR fallback before giving up
        try {
          const ocrText = await ocrPdfIfNeeded(filePath);
          if (ocrText && ocrText.trim().length > 0) {
            extractedText = ocrText;
          } else {
            throw new FileProcessingError('PDF_PROCESSING_FAILURE', fileName, {
              originalError: pdfError.message,
              suggestion: 'PDF may be corrupted, password-protected, or image-based'
            });
          }
        } catch {
          throw new FileProcessingError('PDF_PROCESSING_FAILURE', fileName, {
            originalError: pdfError.message,
            suggestion: 'PDF may be corrupted, password-protected, or image-based'
          });
        }
      }
    } else if ([...SUPPORTED_TEXT_EXTENSIONS, '.doc'].includes(fileExtension)) {
      // Read text files directly
      try {
        if (fileExtension === '.doc') {
          extractedText = await extractTextFromDoc(filePath);
        } else if (fileExtension === '.csv') {
          extractedText = await extractTextFromCsv(filePath);
        } else if (fileExtension === '.xml') {
          const raw = await fs.readFile(filePath, 'utf8');
          extractedText = extractPlainTextFromXml(raw);
        } else {
          // Regular text file reading with basic format-aware cleanup
          const raw = await fs.readFile(filePath, 'utf8');
          if (fileExtension === '.rtf') {
            extractedText = extractPlainTextFromRtf(raw);
          } else if (fileExtension === '.html' || fileExtension === '.htm') {
            extractedText = extractPlainTextFromHtml(raw);
          } else {
            extractedText = raw;
          }
        }

        if (!extractedText || extractedText.trim().length === 0) {
          throw new FileProcessingError('FILE_EMPTY', fileName, {
            suggestion: 'File appears to be empty or unreadable'
          });
        }

        logger.debug(`Extracted characters from text file`, {
          fileName,
          length: extractedText.length
        });
      } catch (textError) {
        logger.error(`Error reading text file`, {
          fileName,
          error: textError.message
        });
        throw new FileProcessingError('DOCUMENT_ANALYSIS_FAILURE', fileName, {
          originalError: textError.message,
          suggestion: 'File may be corrupted or access denied'
        });
      }
    } else if (SUPPORTED_DOCUMENT_EXTENSIONS.includes(fileExtension)) {
      // Extract content from extended document set (office/odf/eml/msg/kml)
      const extractOfficeContent = async () => {
        if (fileExtension === '.docx') return extractTextFromDocx(filePath);
        if (fileExtension === '.xlsx') return extractTextFromXlsx(filePath);
        if (fileExtension === '.pptx') return extractTextFromPptx(filePath);
        if (fileExtension === '.xls') return extractTextFromXls(filePath);
        if (fileExtension === '.ppt') return extractTextFromPpt(filePath);
        if (fileExtension === '.odt' || fileExtension === '.ods' || fileExtension === '.odp')
          return extractTextFromOdfZip(filePath);
        if (fileExtension === '.epub') return extractTextFromEpub(filePath);
        if (fileExtension === '.eml') return extractTextFromEml(filePath);
        if (fileExtension === '.msg') return extractTextFromMsg(filePath);
        if (fileExtension === '.kml') return extractTextFromKml(filePath);
        if (fileExtension === '.kmz') return extractTextFromKmz(filePath);
        return '';
      };

      const logExtraction = () =>
        logger.info(`Extracting content from document`, {
          fileName,
          fileExtension
        });

      try {
        logExtraction();
        extractedText = await extractOfficeContent();

        logger.debug(`Extracted characters from office document`, {
          fileName,
          length: extractedText.length
        });
      } catch (officeError) {
        // Attempt a single retry after a brief delay to handle transient locks/streams
        let finalError = officeError;
        logger.warn(`Office extraction failed, retrying once`, {
          fileName,
          fileExtension,
          error: officeError?.message,
          code: officeError?.code
        });

        try {
          await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_LOCK_RETRY));
          logExtraction();
          extractedText = await extractOfficeContent();
          logger.info(`Office extraction recovered after retry`, {
            fileName,
            fileExtension
          });
        } catch (retryError) {
          finalError = retryError || officeError;
        }

        // If still no extracted text, fall back to filename analysis
        if (!extractedText) {
          const errorMessage =
            finalError?.message || officeError?.message || 'Unknown extraction error';
          const errorCode = finalError?.code || 'UNKNOWN_ERROR';
          const errorDetails = {
            fileName,
            fileExtension,
            error: errorMessage,
            errorCode,
            errorStack: finalError?.stack || officeError?.stack,
            errorType: finalError?.constructor?.name || officeError?.constructor?.name || 'Error'
          };

          if (finalError?.suggestion || officeError?.suggestion) {
            errorDetails.suggestion = finalError?.suggestion || officeError?.suggestion;
          }
          if (finalError?.originalError || officeError?.originalError) {
            errorDetails.originalError = finalError?.originalError || officeError?.originalError;
          }

          logger.error(`Error extracting office content`, errorDetails);

          // Fall back to intelligent filename-based analysis
          const intelligentCategory = getIntelligentCategory(fileName, fileExtension, smartFolders);
          const intelligentKeywords = getIntelligentKeywords(fileName, fileExtension);

          let purpose = 'Office document (content extraction failed)';
          const confidence = 70;

          if (fileExtension === '.docx') {
            purpose = 'Word document - content extraction failed, using filename analysis';
          } else if (fileExtension === '.xlsx') {
            purpose = 'Excel spreadsheet - content extraction failed, using filename analysis';
          } else if (fileExtension === '.pptx') {
            purpose =
              'PowerPoint presentation - content extraction failed, using filename analysis';
          }

          // Fix: Ensure category maps to a valid smart folder, not just "document"
          const category = normalizeCategoryToSmartFolders(
            intelligentCategory || 'document',
            smartFolders
          );

          return {
            purpose,
            project: fileName.replace(fileExtension, ''),
            category,
            date: fileDate,
            keywords: intelligentKeywords || [],
            confidence,
            suggestedName: safeSuggestedName(fileName, fileExtension),
            extractionError: errorMessage,
            extractionErrorCode: errorCode,
            extractionMethod: 'filename_fallback'
          };
        }
      }
    } else if (SUPPORTED_ARCHIVE_EXTENSIONS.includes(fileExtension)) {
      // Archive metadata inspection (best-effort)
      const archiveInfo = await tryExtractArchiveMetadata(filePath);
      const keywords =
        archiveInfo.keywords?.slice(0, TRUNCATION.KEYWORDS_MAX) ||
        getIntelligentKeywords(fileName, fileExtension);

      // Fix: Ensure category maps to a valid smart folder
      const category = normalizeCategoryToSmartFolders('archive', smartFolders);

      return {
        purpose: archiveInfo.summary || 'Archive file',
        project: fileName.replace(fileExtension, ''),
        category,
        date: new Date().toISOString().split('T')[0],
        keywords,
        confidence: 70,
        suggestedName: safeSuggestedName(fileName, fileExtension),
        extractionMethod: 'archive'
      };
    } else {
      // No content parser available - use filename-based fallback
      logger.warn(`[FILENAME-FALLBACK] No content parser`, {
        extension: fileExtension,
        fileName
      });
      return createFallbackAnalysis({
        fileName,
        fileExtension,
        reason: 'No content parser available',
        smartFolders,
        confidence: 75,
        type: 'document',
        options: { extractionMethod: 'filename', date: fileDate }
      });
    }

    // If PDF had no extractable text, attempt OCR on a rasterized page
    // REDUNDANT: OCR is already attempted in the PDF extraction block above.
    // Removing to prevent double-processing and performance waste.
    /*
    if (fileExtension === '.pdf' && (!extractedText || extractedText.trim().length === 0)) {
      const ocrText = await ocrPdfIfNeeded(filePath);
      if (ocrText) extractedText = ocrText;
    }
    */

    if (extractedText && extractedText.trim().length > 0) {
      logger.info(`[CONTENT-ANALYSIS] Processing`, {
        fileName,
        extractedChars: extractedText.length
      });
      logger.debug(`[CONTENT-PREVIEW]`, {
        preview: extractedText.substring(0, TRUNCATION.PREVIEW_MEDIUM)
      });

      // OPTIMIZATION: Retrieve similar file names to improve naming consistency
      // With OLLAMA_MAX_LOADED_MODELS=2, both embedding and text models stay loaded
      // so there's no model swap overhead between embedding and LLM calls
      let namingContext = [];
      try {
        const { matcher } = getServices();
        if (matcher) {
          // Initialize matcher if needed (lazy init pattern)
          if (!matcher.embeddingCache?.initialized) {
            await matcher.initialize();
          }

          // Create a lightweight summary for embedding
          const summaryForEmbedding = extractedText.slice(0, 1500);
          const { vector } = await matcher.embedText(summaryForEmbedding);
          // Find top 5 similar files
          const similarFiles = await matcher.findSimilarFilesByVector(vector, 5);

          // Extract basenames
          namingContext = similarFiles
            .filter((f) => f.metadata && f.metadata.name && f.metadata.name !== fileName)
            .map((f) => f.metadata.name);

          if (namingContext.length > 0) {
            logger.debug('[DocumentAnalysis] Found similar files for naming context', {
              count: namingContext.length,
              examples: namingContext.slice(0, 3)
            });
          }
        }
      } catch (namingError) {
        // Non-fatal, just log and proceed without context
        logger.debug('[DocumentAnalysis] Failed to get naming context (non-fatal)', {
          error: namingError.message
        });
      }

      // Backend Caching & Deduplication:
      // Generate a content hash to prevent duplicate AI processing
      const contentHash = crypto
        .createHash('md5')
        .update(extractedText)
        .update(modelName)
        .digest('hex');

      // Folders are only relevant if they change the prompt structure, but analyzeTextWithOllama uses
      // folders in the prompt. So we SHOULD include folders. But model is in contentHash.
      const deduplicationKey = globalDeduplicator.generateKey({
        contentHash,
        fileName,
        task: 'analyzeTextWithOllama',
        // model: modelName, // Redundant, in contentHash
        folders: Array.isArray(smartFolders) ? smartFolders.map((f) => f?.name || '').join(',') : ''
      });

      const analysis = await globalDeduplicator.deduplicate(deduplicationKey, () =>
        analyzeTextWithOllama(extractedText, fileName, smartFolders, fileDate, namingContext)
      );

      // Semantic folder refinement using embeddings
      if (analysis && typeof analysis === 'object' && !analysis.error) {
        try {
          await applyUnifiedFolderMatching({
            analysis,
            filePath,
            fileName,
            fileExtension,
            fileSize: fileStats?.size,
            smartFolders,
            extractedText,
            type: 'document'
          });
        } catch (e) {
          logger.warn('[DocumentAnalysis] Folder matching failed (non-fatal):', {
            error: e.message,
            filePath
          });
        }
      }

      // Capture values needed from extractedText and release it for GC
      // Large documents can be 2MB+, holding this in memory during subsequent async
      // operations wastes memory. Capture what we need and null the reference.
      const extractedTextLength = extractedText?.length || 0;
      const extractedTextPreview = extractedText?.substring(0, 500) || '';
      const extractedTextForStorage = normalizeExtractedTextForStorage(extractedText);
      extractedText = null;

      if (analysis && !analysis.error) {
        logger.info(`[AI-ANALYSIS-SUCCESS]`, {
          fileName,
          category: analysis.category,
          keywords: analysis.keywords
        });
        const normalized = normalizeAnalysisResult(
          {
            ...analysis,
            contentLength: extractedTextLength,
            extractionMethod: 'content',
            extractedText: extractedTextForStorage
          },
          { category: 'document', keywords: [], confidence: 0 }
        );
        // Use pre-computed signature if available, otherwise skip caching
        if (fileSignature) {
          const cached = await setFileCacheIfUnchanged(
            fileSignature,
            filePath,
            fileStats,
            normalized
          );
          if (!cached) {
            logger.warn('File changed during analysis; skipping cache write', { path: filePath });
          }
        }
        return normalized;
      }

      logger.warn(`[AI-ANALYSIS-FAILED] Content extracted but AI analysis failed`, { fileName });
      return normalizeAnalysisResult(
        {
          rawText: extractedTextPreview,
          extractedText: extractedTextForStorage,
          // Use optional chaining to prevent crash when analysis is null/undefined
          keywords: Array.isArray(analysis?.keywords)
            ? analysis.keywords
            : ['document', 'analysis_failed'],
          purpose: 'Text extracted, but Ollama analysis failed.',
          project: fileName,
          date: fileDate,
          category: 'document',
          confidence: 60,
          error: analysis?.error || 'Ollama analysis failed for document content.',
          contentLength: extractedTextLength,
          extractionMethod: 'content'
        },
        { category: 'document', keywords: [], confidence: 60 }
      );
    }

    logger.error(`[EXTRACTION-FAILED] Could not extract any text content`, {
      fileName
    });
    const result = createFallbackAnalysis({
      fileName,
      fileExtension,
      reason: 'extraction failed',
      smartFolders,
      confidence: 50,
      type: 'document',
      options: {
        extractionMethod: 'failed',
        error: 'Could not extract text or analyze document.'
      }
    });
    // Use pre-computed signature if available, otherwise skip caching
    if (fileSignature) {
      const cached = await setFileCacheIfUnchanged(fileSignature, filePath, fileStats, result);
      if (!cached) {
        logger.warn('File changed during analysis; skipping cache write', { path: filePath });
      }
    }
    return result;
  } catch (error) {
    logger.error(`Error processing document`, {
      path: filePath,
      error: error.message
    });
    return createFallbackAnalysis({
      fileName,
      fileExtension,
      reason: 'Error processing document',
      smartFolders,
      confidence: 60,
      type: 'document',
      options: { date: fileDate, error: error.message }
    });
  }
}

// Text normalization helpers moved to documentExtractors

// Best-effort archive metadata extraction (ZIP only without external deps)
async function tryExtractArchiveMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const info = { keywords: [], summary: '' };
  if (ext === '.zip') {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries().slice(0, 50);
      const names = entries.map((e) => e.entryName);
      info.keywords = deriveKeywordsFromFilenames(names);
      info.summary = `ZIP archive with ${zip.getEntries().length} entries`;
      return info;
    } catch {
      info.summary = 'ZIP archive (content listing unavailable)';
      info.keywords = [];
      return info;
    }
  }
  info.summary = `${ext.substring(1).toUpperCase()} archive`;
  info.keywords = [];
  return info;
}

function deriveKeywordsFromFilenames(names) {
  const exts = {};
  const tokens = new Set();
  names.forEach((n) => {
    const parts = n.split('/');
    const b = parts.length > 0 ? parts[parts.length - 1] : '';
    if (!b) return; // Skip empty filenames
    const extParts = b.split('.');
    const e = extParts.length > 1 ? extParts[extParts.length - 1].toLowerCase() : '';
    if (e) exts[e] = (exts[e] || 0) + 1;
    b.replace(/[^a-zA-Z0-9]+/g, ' ')
      .toLowerCase()
      .split(' ')
      .forEach((w) => {
        if (w && w.length > 2 && w.length < 20) tokens.add(w);
      });
  });
  const topExts = Object.entries(exts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  return [...topExts, ...Array.from(tokens)].slice(0, 15);
}

// Fallback helpers removed; sourced from fallbackUtils

/**
 * Force flush the embedding queue (useful for cleanup or end of batch)
 */
async function flushAllEmbeddings() {
  await embeddingQueue.flush();
}

module.exports = {
  analyzeDocumentFile,
  flushAllEmbeddings
};
