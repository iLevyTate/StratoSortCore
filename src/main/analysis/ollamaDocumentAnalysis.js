const fs = require('fs').promises;
const path = require('path');
const {
  SUPPORTED_TEXT_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  AI_DEFAULTS,
} = require('../../shared/constants');
const { TRUNCATION, THRESHOLDS } = require('../../shared/performanceConstants');
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
  extractPlainTextFromHtml,
} = require('./documentExtractors');
const { analyzeTextWithOllama } = require('./documentLlm');
const { normalizeAnalysisResult } = require('./utils');
const {
  getIntelligentCategory,
  getIntelligentKeywords,
  safeSuggestedName,
} = require('./fallbackUtils');
const { getInstance: getChromaDB } = require('../services/chromadb');
const FolderMatchingService = require('../services/FolderMatchingService');
const embeddingQueue = require('./embeddingQueue');
const crypto = require('crypto');
const { globalDeduplicator } = require('../utils/llmOptimization');
// Cache configuration constants
const CACHE_CONFIG = {
  MAX_FILE_CACHE: 500, // Maximum number of files to cache in memory
  FALLBACK_CONFIDENCE: 65, // Confidence score for fallback analysis
  DEFAULT_CONFIDENCE: 85, // Default confidence for successful analysis
};
const ANALYSIS_SIGNATURE_VERSION = 'v2';

// Folder match threshold now in THRESHOLDS.FOLDER_MATCH_CONFIDENCE

// In-memory cache of per-file analysis results (path|size|mtimeMs -> result)
const fileAnalysisCache = new Map();
function setFileCache(signature, value) {
  if (!signature) return;
  fileAnalysisCache.set(signature, value);
  if (fileAnalysisCache.size > CACHE_CONFIG.MAX_FILE_CACHE) {
    const firstKey = fileAnalysisCache.keys().next().value;
    fileAnalysisCache.delete(firstKey);
  }
}

// Import error handling system
const { FileProcessingError } = require('../errors/AnalysisError');
const ModelVerifier = require('../services/ModelVerifier');

const modelVerifier = new ModelVerifier();
const chromaDbService = getChromaDB();
const folderMatcher = new FolderMatchingService(chromaDbService);

// Set logger context for this module
logger.setContext('DocumentAnalysis');

// ============================================================================
// Helper Functions - Extracted for readability and maintainability
// ============================================================================

/**
 * Create a fallback analysis result when AI analysis is unavailable
 * @param {string} fileName - Original file name
 * @param {string} fileExtension - File extension
 * @param {string} purpose - Purpose description
 * @param {Array} smartFolders - Smart folders for category matching
 * @param {Object} options - Additional options (confidence, extractionMethod, error)
 * @returns {Object} Fallback analysis result
 */
function createDocumentFallback(
  fileName,
  fileExtension,
  purpose,
  smartFolders,
  options = {},
) {
  const {
    confidence = CACHE_CONFIG.FALLBACK_CONFIDENCE,
    extractionMethod = 'filename_fallback',
    error = null,
  } = options;

  const intelligentCategory = getIntelligentCategory(
    fileName,
    fileExtension,
    smartFolders,
  );
  const intelligentKeywords = getIntelligentKeywords(fileName, fileExtension);
  const safeCategory = intelligentCategory || 'document';

  const result = {
    purpose:
      purpose ||
      `${safeCategory.charAt(0).toUpperCase() + safeCategory.slice(1)} document`,
    project: fileName.replace(fileExtension, ''),
    category: safeCategory,
    date: new Date().toISOString().split('T')[0],
    keywords: intelligentKeywords || [],
    confidence,
    suggestedName: safeSuggestedName(fileName, fileExtension),
    extractionMethod,
  };

  if (error) {
    result.error = error;
  }

  return result;
}

/**
 * Apply semantic folder matching using ChromaDB embeddings
 * @param {Object} analysis - Current analysis result
 * @param {string} filePath - File path
 * @param {string} fileName - File name
 * @param {string} extractedText - Extracted text content
 * @param {Array} smartFolders - Available smart folders
 */
async function applyDocumentFolderMatching(
  analysis,
  filePath,
  fileName,
  extractedText,
  smartFolders,
) {
  if (!chromaDbService) {
    logger.warn(
      '[DocumentAnalysis] ChromaDB service not available, skipping folder matching',
    );
    return;
  }

  await chromaDbService.initialize();

  if (folderMatcher && !folderMatcher.embeddingCache?.initialized) {
    folderMatcher.initialize();
    logger.debug('[DocumentAnalysis] FolderMatchingService initialized');
  }

  if (smartFolders && smartFolders.length > 0) {
    logger.debug('[DocumentAnalysis] Upserting folder embeddings', {
      folderCount: smartFolders.length,
    });
    await folderMatcher.batchUpsertFolders(smartFolders);
  }

  const fileId = `file:${filePath}`;
  const summaryForEmbedding = [
    analysis.project,
    analysis.purpose,
    (analysis.keywords || []).join(' '),
    extractedText.slice(0, TRUNCATION.TEXT_EXTRACT_MAX),
  ]
    .filter(Boolean)
    .join('\n');

  logger.debug('[DocumentAnalysis] Generating embedding for folder matching', {
    fileId,
    summaryLength: summaryForEmbedding.length,
  });

  const { vector, model } = await folderMatcher.embedText(
    summaryForEmbedding || '',
  );
  const candidates = await folderMatcher.matchVectorToFolders(vector, 5);

  embeddingQueue.enqueue({
    id: fileId,
    vector,
    model,
    meta: { path: filePath, name: fileName },
    updatedAt: new Date().toISOString(),
  });

  if (Array.isArray(candidates) && candidates.length > 0) {
    logger.debug('[DocumentAnalysis] Folder matching results', {
      fileId,
      candidateCount: candidates.length,
      topScore: candidates[0]?.score,
      topFolder: candidates[0]?.name,
    });

    const top = candidates[0];
    if (top && top.score >= THRESHOLDS.FOLDER_MATCH_CONFIDENCE) {
      logger.info(
        '[DocumentAnalysis] Refining category based on folder match',
        {
          originalCategory: analysis.category,
          newCategory: top.name,
          score: top.score,
        },
      );
      analysis.category = top.name;
      analysis.suggestedFolder = top.name;
      analysis.destinationFolder = top.path || top.name;
    }
    analysis.folderMatchCandidates = candidates;
  } else {
    logger.debug('[DocumentAnalysis] No folder matches found', { fileId });
  }
}

/**
 * Analyzes a document file using AI or fallback methods
 * @param {string} filePath - Path to the document file
 * @param {Array} smartFolders - Array of smart folder configurations
 * @returns {Promise<Object>} Analysis result with metadata
 */
async function analyzeDocumentFile(filePath, smartFolders = []) {
  logger.info('Analyzing document file', { path: filePath });
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
  const defaultTextModel =
    AppConfig?.ai?.textAnalysis?.defaultModel || AI_DEFAULTS.TEXT.MODEL;

  let modelName = defaultTextModel;
  try {
    const cfg = await loadOllamaConfig();
    modelName =
      getOllamaModel() ||
      cfg.selectedTextModel ||
      cfg.selectedModel ||
      defaultTextModel;
  } catch {
    modelName = defaultTextModel;
  }

  // FAST SEMANTIC LABELING (Short-circuit)
  // Skip AI analysis for video files and use extension-based fallback immediately
  if ((SUPPORTED_VIDEO_EXTENSIONS || []).includes(fileExtension)) {
    const intelligentCategory = getIntelligentCategory(
      fileName,
      fileExtension,
      smartFolders,
    );
    const intelligentKeywords = getIntelligentKeywords(fileName, fileExtension);
    const safeCategory = intelligentCategory || 'video';

    return {
      purpose: 'Video file',
      project: fileName.replace(fileExtension, ''),
      category: safeCategory,
      date: new Date().toISOString().split('T')[0],
      keywords: intelligentKeywords,
      confidence: 80, // High confidence for known types
      suggestedName: safeSuggestedName(fileName, fileExtension),
      extractionMethod: 'extension_short_circuit',
    };
  }

  // Pre-flight checks for AI-first operation (graceful fallback if Ollama unavailable)
  try {
    const connectionCheck = await modelVerifier.checkOllamaConnection();
    if (!connectionCheck.connected) {
      logger.warn(
        `Ollama unavailable (${connectionCheck.error}). Using filename-based analysis.`,
      );
      return createDocumentFallback(
        fileName,
        fileExtension,
        null,
        smartFolders,
      );
    }
  } catch (error) {
    logger.error('Pre-flight verification failed:', error);
    return createDocumentFallback(fileName, fileExtension, null, smartFolders, {
      confidence: 65,
    });
  }

  // FIX: Flattened nested try/catch - separate cache logic from main extraction
  // Step 1: Attempt to compute file signature and check cache (non-fatal if fails)
  let fileSignature = null;
  try {
    const stats = await fs.stat(filePath);
    fileSignature = `${ANALYSIS_SIGNATURE_VERSION}|${modelName}|${smartFolderSig}|${filePath}|${stats.size}|${stats.mtimeMs}`;
    if (fileAnalysisCache.has(fileSignature)) {
      return fileAnalysisCache.get(fileSignature);
    }
    logger.debug('Cache miss, analyzing', { path: filePath });
  } catch (statError) {
    // Non-fatal: proceed without cache if stats fail
    logger.debug('Could not stat file for caching, proceeding with analysis', {
      path: filePath,
      error: statError.message,
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
          error: pdfError.message,
        });
        // Attempt OCR fallback before giving up
        try {
          const ocrText = await ocrPdfIfNeeded(filePath);
          if (ocrText && ocrText.trim().length > 0) {
            extractedText = ocrText;
          } else {
            throw new FileProcessingError('PDF_PROCESSING_FAILURE', fileName, {
              originalError: pdfError.message,
              suggestion:
                'PDF may be corrupted, password-protected, or image-based',
            });
          }
        } catch (ocrErr) {
          throw new FileProcessingError('PDF_PROCESSING_FAILURE', fileName, {
            originalError: pdfError.message,
            suggestion:
              'PDF may be corrupted, password-protected, or image-based',
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
            suggestion: 'File appears to be empty or unreadable',
          });
        }

        logger.debug(`Extracted characters from text file`, {
          fileName,
          length: extractedText.length,
        });
      } catch (textError) {
        logger.error(`Error reading text file`, {
          fileName,
          error: textError.message,
        });
        throw new FileProcessingError('DOCUMENT_ANALYSIS_FAILURE', fileName, {
          originalError: textError.message,
          suggestion: 'File may be corrupted or access denied',
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
        if (
          fileExtension === '.odt' ||
          fileExtension === '.ods' ||
          fileExtension === '.odp'
        )
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
          fileExtension,
        });

      try {
        logExtraction();
        extractedText = await extractOfficeContent();

        logger.debug(`Extracted characters from office document`, {
          fileName,
          length: extractedText.length,
        });
      } catch (officeError) {
        // Attempt a single retry after a brief delay to handle transient locks/streams
        let finalError = officeError;
        logger.warn(`Office extraction failed, retrying once`, {
          fileName,
          fileExtension,
          error: officeError?.message,
          code: officeError?.code,
        });

        try {
          await new Promise((resolve) => setTimeout(resolve, 400));
          logExtraction();
          extractedText = await extractOfficeContent();
          logger.info(`Office extraction recovered after retry`, {
            fileName,
            fileExtension,
          });
        } catch (retryError) {
          finalError = retryError || officeError;
        }

        // If still no extracted text, fall back to filename analysis
        if (!extractedText) {
          const errorMessage =
            finalError?.message ||
            officeError?.message ||
            'Unknown extraction error';
          const errorCode = finalError?.code || 'UNKNOWN_ERROR';
          const errorDetails = {
            fileName,
            fileExtension,
            error: errorMessage,
            errorCode,
            errorStack: finalError?.stack || officeError?.stack,
            errorType:
              finalError?.constructor?.name ||
              officeError?.constructor?.name ||
              'Error',
          };

          if (finalError?.suggestion || officeError?.suggestion) {
            errorDetails.suggestion =
              finalError?.suggestion || officeError?.suggestion;
          }
          if (finalError?.originalError || officeError?.originalError) {
            errorDetails.originalError =
              finalError?.originalError || officeError?.originalError;
          }

          logger.error(`Error extracting office content`, errorDetails);

          // Fall back to intelligent filename-based analysis
          const intelligentCategory = getIntelligentCategory(
            fileName,
            fileExtension,
            smartFolders,
          );
          const intelligentKeywords = getIntelligentKeywords(
            fileName,
            fileExtension,
          );

          let purpose = 'Office document (content extraction failed)';
          const confidence = 70;

          if (fileExtension === '.docx') {
            purpose =
              'Word document - content extraction failed, using filename analysis';
          } else if (fileExtension === '.xlsx') {
            purpose =
              'Excel spreadsheet - content extraction failed, using filename analysis';
          } else if (fileExtension === '.pptx') {
            purpose =
              'PowerPoint presentation - content extraction failed, using filename analysis';
          }

          return {
            purpose,
            project: fileName.replace(fileExtension, ''),
            category: intelligentCategory || 'document',
            date: new Date().toISOString().split('T')[0],
            keywords: intelligentKeywords || [],
            confidence,
            suggestedName: safeSuggestedName(fileName, fileExtension),
            extractionError: errorMessage,
            extractionErrorCode: errorCode,
            extractionMethod: 'filename_fallback',
          };
        }
      }
    } else if (SUPPORTED_ARCHIVE_EXTENSIONS.includes(fileExtension)) {
      // Archive metadata inspection (best-effort)
      const archiveInfo = await tryExtractArchiveMetadata(filePath);
      const keywords =
        archiveInfo.keywords?.slice(0, TRUNCATION.KEYWORDS_MAX) ||
        getIntelligentKeywords(fileName, fileExtension);
      const category = 'archive';
      return {
        purpose: archiveInfo.summary || 'Archive file',
        project: fileName.replace(fileExtension, ''),
        category,
        date: new Date().toISOString().split('T')[0],
        keywords,
        confidence: 70,
        suggestedName: safeSuggestedName(fileName, fileExtension),
        extractionMethod: 'archive',
      };
    } else {
      // No content parser available - use filename-based fallback
      logger.warn(`[FILENAME-FALLBACK] No content parser`, {
        extension: fileExtension,
        fileName,
      });
      return createDocumentFallback(
        fileName,
        fileExtension,
        null,
        smartFolders,
        {
          confidence: 75,
          extractionMethod: 'filename',
        },
      );
    }

    // If PDF had no extractable text, attempt OCR on a rasterized page
    if (
      fileExtension === '.pdf' &&
      (!extractedText || extractedText.trim().length === 0)
    ) {
      const ocrText = await ocrPdfIfNeeded(filePath);
      if (ocrText) extractedText = ocrText;
    }

    if (extractedText && extractedText.trim().length > 0) {
      logger.info(`[CONTENT-ANALYSIS] Processing`, {
        fileName,
        extractedChars: extractedText.length,
      });
      logger.debug(`[CONTENT-PREVIEW]`, {
        preview: extractedText.substring(0, TRUNCATION.PREVIEW_MEDIUM),
      });

      // Backend Caching & Deduplication:
      // Generate a content hash to prevent duplicate AI processing
      const contentHash = crypto
        .createHash('md5')
        .update(extractedText)
        .update(modelName)
        .digest('hex');

      const deduplicationKey = globalDeduplicator.generateKey({
        contentHash,
        fileName,
        task: 'analyzeTextWithOllama',
        model: modelName,
        folders: Array.isArray(smartFolders)
          ? smartFolders.map((f) => f?.name || '').join(',')
          : '',
      });

      const analysis = await globalDeduplicator.deduplicate(
        deduplicationKey,
        () => analyzeTextWithOllama(extractedText, fileName, smartFolders),
      );

      // Semantic folder refinement using embeddings (delegated to helper)
      try {
        await applyDocumentFolderMatching(
          analysis,
          filePath,
          fileName,
          extractedText,
          smartFolders,
        );
      } catch (e) {
        logger.warn('[DocumentAnalysis] Folder matching failed (non-fatal):', {
          error: e.message,
          filePath,
        });
      }

      if (analysis && !analysis.error) {
        logger.info(`[AI-ANALYSIS-SUCCESS]`, {
          fileName,
          category: analysis.category,
          keywords: analysis.keywords,
        });
        const normalized = normalizeAnalysisResult(
          {
            ...analysis,
            contentLength: extractedText.length,
            extractionMethod: 'content',
          },
          { category: 'document', keywords: [], confidence: 0 },
        );
        // Use pre-computed signature if available, otherwise skip caching
        if (fileSignature) {
          setFileCache(fileSignature, normalized);
        }
        return normalized;
      }

      logger.warn(
        `[AI-ANALYSIS-FAILED] Content extracted but AI analysis failed`,
        { fileName },
      );
      return normalizeAnalysisResult(
        {
          rawText: extractedText.substring(0, 500),
          keywords: Array.isArray(analysis.keywords)
            ? analysis.keywords
            : ['document', 'analysis_failed'],
          purpose: 'Text extracted, but Ollama analysis failed.',
          project: fileName,
          date: new Date().toISOString().split('T')[0],
          category: 'document',
          confidence: 60,
          error:
            analysis?.error || 'Ollama analysis failed for document content.',
          contentLength: extractedText.length,
          extractionMethod: 'content',
        },
        { category: 'document', keywords: [], confidence: 60 },
      );
    }

    logger.error(`[EXTRACTION-FAILED] Could not extract any text content`, {
      fileName,
    });
    const result = {
      error: 'Could not extract text or analyze document.',
      project: fileName,
      category: 'document',
      date: new Date().toISOString().split('T')[0],
      keywords: [],
      confidence: 50,
      extractionMethod: 'failed',
    };
    // Use pre-computed signature if available, otherwise skip caching
    if (fileSignature) {
      setFileCache(fileSignature, result);
    }
    return result;
  } catch (error) {
    logger.error(`Error processing document`, {
      path: filePath,
      error: error.message,
    });
    return createDocumentFallback(fileName, fileExtension, null, smartFolders, {
      confidence: 60,
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
    } catch (e) {
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
    const e =
      extParts.length > 1 ? extParts[extParts.length - 1].toLowerCase() : '';
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
  flushAllEmbeddings,
};
