/**
 * Unified Semantic Folder Matching
 *
 * This module consolidates duplicate folder matching logic from:
 * - ollamaDocumentAnalysis.js:246-401 (applyDocumentFolderMatching)
 * - ollamaImageAnalysis.js:743-922 (applySemanticFolderMatching)
 *
 * Both implementations shared ~80% identical code for:
 * - ChromaDB/FolderMatchingService initialization
 * - Embedding generation and folder matching
 * - Queue management for embeddings
 * - Confidence-based category override logic
 *
 * The main differences are handled via parameters:
 * - type: 'document' vs 'image'
 * - buildSummary: type-specific summary builder function
 * - metadata: type-specific metadata fields
 *
 * @module analysis/semanticFolderMatcher
 */

const { logger } = require('../../shared/logger');
const { THRESHOLDS } = require('../../shared/performanceConstants');
const { normalizePathForIndex, getCanonicalFileId } = require('../../shared/pathSanitization');
const { capEmbeddingInput } = require('../utils/embeddingInput');
const { enrichFileTextForEmbedding } = require('./semanticExtensionMap');
const { container, ServiceIds } = require('../services/ServiceContainer');
const embeddingQueue = require('./embeddingQueue');

logger.setContext('SemanticFolderMatcher');

/**
 * Get or initialize ChromaDB and FolderMatchingService
 * Uses lazy initialization to prevent startup failures
 *
 * @returns {{ chromaDb: Object|null, matcher: FolderMatchingService|null }}
 */
function getServices() {
  const chromaDb = container.tryResolve(ServiceIds.CHROMA_DB);
  const matcher = container.tryResolve(ServiceIds.FOLDER_MATCHING);
  return { chromaDb, matcher };
}

/**
 * Validate that FolderMatchingService has required methods
 *
 * @param {FolderMatchingService} matcher - Matcher instance
 * @returns {boolean} True if matcher has all required methods
 */
function validateMatcher(matcher) {
  return (
    matcher &&
    typeof matcher === 'object' &&
    typeof matcher.initialize === 'function' &&
    typeof matcher.batchUpsertFolders === 'function' &&
    typeof matcher.embedText === 'function' &&
    typeof matcher.matchVectorToFolders === 'function'
  );
}

/**
 * Build embedding summary by combining analysis fields and enriching with semantic keywords
 *
 * @param {Object} analysis - Analysis result
 * @param {string} [extractedText=''] - Extracted text content
 * @param {string} fileExtension - File extension for semantic enrichment
 * @param {string} [type='document'] - Analysis type
 * @returns {{ text: string, wasTruncated: boolean, estimatedTokens: number }}
 */
function buildEmbeddingSummary(analysis, extractedText = '', fileExtension, type = 'document') {
  // Base fields that apply to both document and image analysis
  const baseParts = [
    analysis.summary,
    analysis.purpose,
    analysis.project,
    Array.isArray(analysis.keywords) ? analysis.keywords.join(' ') : ''
  ];

  // Add type-specific fields
  if (type === 'image') {
    baseParts.push(analysis.content_type || '');
  }

  const baseText = baseParts.filter(Boolean).join('\n');

  // Enrich with semantic keywords based on file extension
  const enrichedBase = enrichFileTextForEmbedding(baseText, fileExtension);

  // Add extracted text snippet - Increased from 500 to 2000 to maximize embedding context usage
  // capEmbeddingInput will handle the final token limit safety
  const textSnippet = extractedText ? extractedText.slice(0, 2000) : '';
  const combined = [enrichedBase, textSnippet].filter(Boolean).join('\n');

  // Cap to token limit
  const capped = capEmbeddingInput(combined);

  return capped;
}

/**
 * Unified semantic folder matching for documents and images
 *
 * This function:
 * 1. Initializes ChromaDB and FolderMatchingService if needed
 * 2. Upserts smart folder embeddings
 * 3. Generates embedding for the file's content summary
 * 4. Matches the embedding against folder embeddings
 * 5. Queues the embedding for batch persistence
 * 6. Optionally overrides the LLM category if embedding match is stronger
 *
 * @param {Object} params - Parameters for folder matching
 * @param {Object} params.analysis - Current analysis result (will be mutated)
 * @param {string} params.filePath - File path for embedding ID
 * @param {string} params.fileName - File name for metadata
 * @param {string} params.fileExtension - File extension
 * @param {number} [params.fileSize] - File size in bytes
 * @param {Array} params.smartFolders - Available smart folders
 * @param {string} [params.extractedText=''] - Extracted text content
 * @param {string} [params.type='document'] - Analysis type ('document' or 'image')
 * @returns {Promise<Object>} The analysis object (possibly modified)
 *
 * @example
 * await applySemanticFolderMatching({
 *   analysis,
 *   filePath: '/path/to/file.pdf',
 *   fileName: 'file.pdf',
 *   fileExtension: '.pdf',
 *   fileSize: 12345,
 *   smartFolders: folders,
 *   extractedText: 'Document content...',
 *   type: 'document'
 * });
 */
async function applySemanticFolderMatching(params) {
  const {
    analysis,
    filePath,
    fileName,
    fileExtension,
    fileSize,
    smartFolders,
    extractedText = '',
    type = 'document'
  } = params;

  // Guard against invalid analysis
  if (!analysis || typeof analysis !== 'object') {
    logger.warn('[FolderMatcher] Invalid analysis object, skipping folder matching', {
      filePath,
      analysisType: typeof analysis
    });
    return analysis;
  }

  // Get services with lazy initialization
  const { chromaDb, matcher } = getServices();

  if (!chromaDb) {
    logger.warn('[FolderMatcher] ChromaDB not available, skipping semantic folder matching');
    return analysis;
  }

  // Validate matcher
  if (!validateMatcher(matcher)) {
    logger.warn('[FolderMatcher] FolderMatcher invalid or missing required methods');
    return analysis;
  }

  // Initialize matcher if needed
  if (!matcher.embeddingCache?.initialized) {
    try {
      await matcher.initialize();
      logger.debug('[FolderMatcher] FolderMatchingService initialized');
    } catch (initError) {
      logger.warn('[FolderMatcher] Initialization error:', initError.message);
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
        await matcher.batchUpsertFolders(validFolders);
        logger.debug('[FolderMatcher] Upserted folder embeddings', {
          folderCount: validFolders.length
        });
      }
    } catch (upsertError) {
      logger.warn('[FolderMatcher] Folder embedding upsert error:', upsertError.message);
    }
  }

  // Build summary for embedding
  const embeddingSummary = buildEmbeddingSummary(analysis, extractedText, fileExtension, type);
  const summaryForEmbedding = embeddingSummary.text;

  if (!summaryForEmbedding || summaryForEmbedding.trim().length === 0) {
    logger.debug('[FolderMatcher] Empty summary, skipping folder matching');
    return analysis;
  }

  if (embeddingSummary.wasTruncated) {
    logger.warn('[FolderMatcher] Embedding summary truncated to token limit', {
      filePath,
      summaryLength: summaryForEmbedding.length,
      estimatedTokens: embeddingSummary.estimatedTokens
    });
  }

  try {
    // Initialize ChromaDB if needed
    if (chromaDb && typeof chromaDb.initialize === 'function') {
      await chromaDb.initialize();
    }

    // Generate embedding
    const embeddingResult = await matcher.embedText(summaryForEmbedding);
    // FIX #2: Also check for empty array to prevent downstream failures
    if (
      !embeddingResult ||
      !embeddingResult.vector ||
      !Array.isArray(embeddingResult.vector) ||
      embeddingResult.vector.length === 0
    ) {
      logger.warn('[FolderMatcher] Failed to generate valid embedding vector', {
        filePath,
        hasResult: !!embeddingResult,
        hasVector: !!embeddingResult?.vector,
        vectorLength: embeddingResult?.vector?.length
      });
      return analysis;
    }

    const { vector, model } = embeddingResult;

    // Match against folders
    const candidates = await matcher.matchVectorToFolders(vector, 5);

    // Generate file ID based on type
    const fileId =
      type === 'image'
        ? getCanonicalFileId(filePath, true)
        : `file:${normalizePathForIndex(filePath)}`;

    // Calculate confidence percent
    const rawConfidence = analysis.confidence ?? 0;
    const confidencePercent =
      typeof rawConfidence === 'number'
        ? rawConfidence > 1
          ? Math.round(rawConfidence)
          : Math.round(rawConfidence * 100)
        : 0;

    // Build metadata based on type
    const baseMeta = {
      path: filePath,
      name: fileName,
      fileExtension: (fileExtension || '').toLowerCase(),
      fileSize,
      category: analysis.category || 'Uncategorized',
      confidence: confidencePercent,
      type,
      extractionMethod: analysis.extractionMethod || (extractedText ? 'content' : 'analysis'),
      summary: (summaryForEmbedding || analysis.summary || analysis.purpose || '').substring(
        0,
        500
      ),
      tags: Array.isArray(analysis.keywords) ? analysis.keywords : [],
      keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
      date: analysis.date,
      suggestedName: analysis.suggestedName
    };

    // Add type-specific metadata
    if (type === 'image') {
      baseMeta.content_type = analysis.content_type;
      baseMeta.colors = Array.isArray(analysis.colors) ? analysis.colors : [];
      baseMeta.has_text = analysis.has_text === true;
    } else {
      baseMeta.entity = analysis.entity;
      baseMeta.project = analysis.project;
      baseMeta.purpose = analysis.purpose;
    }

    // Queue embedding for batch persistence
    await embeddingQueue.enqueue({
      id: fileId,
      vector,
      model,
      meta: baseMeta,
      updatedAt: new Date().toISOString()
    });

    // Process candidates and potentially override category
    if (Array.isArray(candidates) && candidates.length > 0) {
      logger.debug('[FolderMatcher] Folder matching results', {
        fileId,
        candidateCount: candidates.length,
        topScore: candidates[0]?.score,
        topFolder: candidates[0]?.name
      });

      const top = candidates[0];
      if (top && typeof top === 'object' && typeof top.score === 'number' && top.name) {
        // FIX #1: Normalize LLM confidence to 0-1 scale for comparison with embedding score
        // LLM confidence can be 0-100 (percentage) or 0-1 (fraction)
        const rawLlmConfidence = analysis.confidence ?? 70; // Default 70% if missing
        const llmConfidence = rawLlmConfidence > 1 ? rawLlmConfidence / 100 : rawLlmConfidence;
        // Only override LLM category if embedding score exceeds both threshold AND LLM confidence
        const shouldOverride =
          top.score >= THRESHOLDS.FOLDER_MATCH_CONFIDENCE && top.score > llmConfidence;

        if (shouldOverride) {
          logger.info('[FolderMatcher] Embedding override - folder match exceeds LLM confidence', {
            type,
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
          logger.debug(
            '[FolderMatcher] LLM category preserved - confidence higher than embedding',
            {
              type,
              llmCategory: analysis.category,
              llmConfidence,
              embeddingCategory: top.name,
              embeddingScore: top.score
            }
          );
          analysis.categorySource = 'llm_preserved';
        }
        analysis.folderMatchCandidates = candidates;
      }
    } else {
      logger.debug('[FolderMatcher] No folder matches found', { fileId });
    }
  } catch (matchError) {
    logger.warn('[FolderMatcher] Folder matching error:', matchError.message);
  }

  return analysis;
}

/**
 * Reset module singletons
 * Useful for testing or service reconnection
 */
function resetSingletons() {
  // No-op as container manages instances
  logger.debug('[FolderMatcher] Singletons reset (no-op with DI)');
}

module.exports = {
  applySemanticFolderMatching,
  buildEmbeddingSummary,
  resetSingletons,
  // For testing
  getServices,
  validateMatcher
};
