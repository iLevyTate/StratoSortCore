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

const { createLogger } = require('../../shared/logger');
const { THRESHOLDS, TIMEOUTS } = require('../../shared/performanceConstants');
const { normalizePathForIndex, getCanonicalFileId } = require('../../shared/pathSanitization');
const { findContainingSmartFolder } = require('../../shared/folderUtils');
const { buildEmbeddingSummary } = require('./embeddingSummary');
const { container, ServiceIds } = require('../services/ServiceContainer');
const { analysisQueue } = require('./embeddingQueue/stageQueues');
const { withTimeout } = require('../../shared/promiseUtils');
const { shouldEmbed } = require('../services/embedding/embeddingGate');

const logger = createLogger('SemanticFolderMatcher');
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

  const resolvedSmartFolder = findContainingSmartFolder(filePath, smartFolders);
  const embeddingCategory = resolvedSmartFolder?.name || analysis.category || 'Uncategorized';

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
    const embeddingResult = await withTimeout(
      matcher.embedText(summaryForEmbedding),
      TIMEOUTS.EMBEDDING_REQUEST || 30000,
      'folder matcher embedText'
    );
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
    const candidates = await withTimeout(
      matcher.matchVectorToFolders(vector, 5),
      TIMEOUTS.SEMANTIC_QUERY || 30000,
      'folder matcher matchVectorToFolders'
    );

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

    // Build metadata based on type - comprehensive for chat/search/graph
    const rawType = typeof analysis.type === 'string' ? analysis.type.trim() : '';
    const isGenericType = ['image', 'document', 'file', 'unknown'].includes(rawType.toLowerCase());
    const documentType = analysis.documentType || (!isGenericType && rawType ? rawType : '');
    const baseMeta = {
      path: filePath,
      name: fileName,
      fileExtension: (fileExtension || '').toLowerCase(),
      fileSize,
      category: embeddingCategory,
      confidence: confidencePercent,
      type,
      extractionMethod: analysis.extractionMethod || (extractedText ? 'content' : 'analysis'),
      summary: (summaryForEmbedding || analysis.summary || analysis.purpose || '').substring(
        0,
        2000
      ),
      tags: Array.isArray(analysis.keywords) ? analysis.keywords : [],
      keywords: Array.isArray(analysis.keywords) ? analysis.keywords : [],
      date: analysis.documentDate || analysis.date || null,
      suggestedName: analysis.suggestedName,
      keyEntities: Array.isArray(analysis.keyEntities) ? analysis.keyEntities.slice(0, 20) : [],
      // Common fields for all file types
      entity: analysis.entity || '',
      project: analysis.project || '',
      purpose: (analysis.purpose || '').substring(0, 1000),
      reasoning: (analysis.reasoning || '').substring(0, 500),
      documentType,
      extractedText: (extractedText || '').substring(0, 5000),
      smartFolder: resolvedSmartFolder?.name || null,
      smartFolderPath: resolvedSmartFolder?.path || null
    };

    // Add image-specific metadata
    if (type === 'image') {
      baseMeta.content_type = analysis.content_type || 'unknown';
      baseMeta.colors = Array.isArray(analysis.colors) ? analysis.colors : [];
      baseMeta.has_text = analysis.has_text === true;
    }

    if (resolvedSmartFolder && type !== 'image') {
      // Queue embedding for batch persistence only once file is in a smart folder,
      // and only when embedding is enabled for this stage.
      // Per-file overrides may be set after analysis; during analysis we only apply global settings.
      const gate = await shouldEmbed({ stage: 'analysis' });
      if (gate.shouldEmbed) {
        await analysisQueue.enqueue({
          id: fileId,
          vector,
          model,
          meta: baseMeta,
          updatedAt: new Date().toISOString()
        });
      } else {
        logger.debug('[FolderMatcher] Embedding skipped by policy/timing gate', {
          timing: gate.timing,
          policy: gate.policy,
          filePath
        });
      }
    } else if (resolvedSmartFolder && type === 'image') {
      logger.debug('[FolderMatcher] Skipping image enqueue (handled by image pipeline)', {
        filePath
      });
    } else {
      logger.debug('[FolderMatcher] Skipping embedding persistence (not in smart folder)', {
        filePath
      });
    }

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

        // If the LLM category is generic or doesn't match any smart folder, don't let it block
        // a strong embedding match from selecting the correct folder.
        const rawCategory = typeof analysis.category === 'string' ? analysis.category.trim() : '';
        const normalizedCategory = rawCategory.toLowerCase();
        const canonicalize = (value) =>
          String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
        const categoryCanonical = canonicalize(normalizedCategory);
        const categoryIsGeneric = [
          'image',
          'images',
          'document',
          'documents',
          'file',
          'files',
          'unknown',
          'default'
        ].includes(normalizedCategory);
        const categoryMatchesFolder = Array.isArray(smartFolders)
          ? smartFolders.some((folder) => {
              const folderName = typeof folder?.name === 'string' ? folder.name.trim() : '';
              if (!folderName) return false;
              if (folderName.toLowerCase() === normalizedCategory) return true;
              return canonicalize(folderName) === categoryCanonical;
            })
          : false;
        const effectiveLlmConfidence =
          categoryIsGeneric || !categoryMatchesFolder ? 0 : llmConfidence;

        // Only override LLM category if embedding score exceeds both threshold AND LLM confidence
        const shouldOverride =
          top.score >= THRESHOLDS.FOLDER_MATCH_CONFIDENCE && top.score > effectiveLlmConfidence;

        if (shouldOverride) {
          logger.info('[FolderMatcher] Embedding override - folder match exceeds LLM confidence', {
            type,
            llmCategory: analysis.category,
            llmConfidence,
            effectiveLlmConfidence,
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
              effectiveLlmConfidence,
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
