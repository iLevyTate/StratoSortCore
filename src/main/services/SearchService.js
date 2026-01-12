/**
 * SearchService - Hybrid Search with BM25 + Vector Similarity
 *
 * Combines keyword-based BM25 search with semantic vector search
 * using Reciprocal Rank Fusion for optimal result quality.
 *
 * Enhanced with:
 * - QueryProcessor for spell correction and synonym expansion
 * - ReRankerService for LLM-based re-ranking of top results
 *
 * @module services/SearchService
 */

const lunr = require('lunr');
const { logger } = require('../../shared/logger');
const { THRESHOLDS, TIMEOUTS, SEARCH } = require('../../shared/performanceConstants');
const { normalizePathForIndex } = require('../../shared/pathSanitization');
const { validateEmbeddingDimensions } = require('../../shared/vectorMath');
const { getSemanticFileId } = require('../../shared/fileIdUtils');

// Optional services for enhanced query processing
const { getInstance: getQueryProcessor } = require('./QueryProcessor');
const { getInstance: getReRanker } = require('./ReRankerService');

logger.setContext('SearchService');

/**
 * Minimum score threshold for results (filters low-quality matches)
 * Uses MIN_SIMILARITY_SCORE from performanceConstants
 */
const MIN_RESULT_SCORE = THRESHOLDS.MIN_SIMILARITY_SCORE;

/**
 * Vector search timeout before falling back to BM25
 */
const VECTOR_SEARCH_TIMEOUT = TIMEOUTS.SEMANTIC_QUERY;

/**
 * Default search options (from performanceConstants.SEARCH)
 */
const DEFAULT_OPTIONS = {
  topK: SEARCH.DEFAULT_TOP_K,
  mode: 'hybrid', // 'vector', 'bm25', 'hybrid'
  vectorWeight: SEARCH.VECTOR_WEIGHT,
  bm25Weight: SEARCH.BM25_WEIGHT,
  minScore: MIN_RESULT_SCORE, // Minimum score threshold
  // Share the non-BM25 weight between file-level and chunk-level vectors.
  // Chunk results improve deep recall for natural-language queries.
  chunkWeight: 0.5,
  // Query processing options
  expandSynonyms: true, // Expand query with WordNet synonyms
  correctSpelling: false, // DISABLED - causes false corrections on common words (are->api, that->tax)
  // Re-ranking options
  rerank: true, // Enable LLM re-ranking of top results
  rerankTopN: 10 // Number of top results to re-rank
};

class SearchService {
  /**
   * Create a new SearchService instance
   *
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.chromaDbService - ChromaDB service for vector search
   * @param {Object} dependencies.analysisHistoryService - Analysis history for document data
   * @param {Object} dependencies.parallelEmbeddingService - Embedding service for query vectors
   * @param {Object} [dependencies.queryProcessor] - Optional QueryProcessor for spell correction/synonyms
   * @param {Object} [dependencies.reRankerService] - Optional ReRankerService for LLM re-ranking
   * @param {Object} [dependencies.ollamaService] - Optional OllamaService for re-ranking
   */
  constructor({
    chromaDbService,
    analysisHistoryService,
    parallelEmbeddingService,
    queryProcessor,
    reRankerService,
    ollamaService
  } = {}) {
    // Validate required dependencies
    if (!chromaDbService) {
      throw new Error('SearchService requires chromaDbService dependency');
    }
    if (!analysisHistoryService) {
      throw new Error('SearchService requires analysisHistoryService dependency');
    }
    if (!parallelEmbeddingService) {
      throw new Error('SearchService requires parallelEmbeddingService dependency');
    }

    this.chromaDb = chromaDbService;
    this.history = analysisHistoryService;
    this.embedding = parallelEmbeddingService;

    // Optional enhanced services - use singletons if not provided
    this.queryProcessor = queryProcessor || null;
    this.reRanker = reRankerService || null;
    this.ollamaService = ollamaService || null;

    // Lazy initialize optional services
    this._queryProcessorInitialized = false;
    this._reRankerInitialized = false;

    this.bm25Index = null;
    this.documentMap = new Map(); // id -> document metadata
    this.indexBuiltAt = null;
    this.indexVersion = 0;

    // Index staleness threshold (15 minutes)
    this.INDEX_STALE_MS = 15 * 60 * 1000;

    // Cached serialized index for faster rebuilds
    this._serializedIndex = null;
    this._serializedDocMap = null;

    // Lock to prevent concurrent index builds (race condition fix)
    this._indexBuildPromise = null;

    // Maximum cache size in bytes (50MB) to prevent unbounded growth
    this._maxCacheSize = 50 * 1024 * 1024;
  }

  /**
   * Get or initialize QueryProcessor
   * @returns {Object|null} QueryProcessor instance or null
   */
  _getQueryProcessor() {
    if (this.queryProcessor) return this.queryProcessor;
    if (this._queryProcessorInitialized) return this.queryProcessor;

    try {
      this.queryProcessor = getQueryProcessor();
      this._queryProcessorInitialized = true;

      // Extend vocabulary from analysis history (background)
      if (this.history) {
        this.queryProcessor.extendVocabulary(this.history).catch((err) => {
          logger.debug('[SearchService] Vocabulary extension failed:', err.message);
        });
      }

      return this.queryProcessor;
    } catch (error) {
      logger.debug('[SearchService] QueryProcessor not available:', error.message);
      this._queryProcessorInitialized = true;
      return null;
    }
  }

  /**
   * Get or initialize ReRankerService
   * @returns {Object|null} ReRankerService instance or null
   */
  _getReRanker() {
    if (this.reRanker) return this.reRanker;
    if (this._reRankerInitialized) return this.reRanker;

    try {
      // ReRanker needs OllamaService
      if (!this.ollamaService) {
        logger.debug('[SearchService] ReRanker unavailable: no OllamaService');
        this._reRankerInitialized = true;
        return null;
      }

      this.reRanker = getReRanker({ ollamaService: this.ollamaService });
      this._reRankerInitialized = true;
      return this.reRanker;
    } catch (error) {
      logger.debug('[SearchService] ReRanker not available:', error.message);
      this._reRankerInitialized = true;
      return null;
    }
  }

  /**
   * Set OllamaService for re-ranking (can be set after construction)
   * @param {Object} ollamaService - OllamaService instance
   */
  setOllamaService(ollamaService) {
    this.ollamaService = ollamaService;
    // Reset reranker initialization so it can be created with the new service
    this._reRankerInitialized = false;
    this.reRanker = null;
  }

  /**
   * Check if the BM25 index needs rebuilding
   *
   * @returns {boolean} True if index is stale or missing
   */
  isIndexStale() {
    if (!this.bm25Index || !this.indexBuiltAt) {
      return true;
    }
    return Date.now() - this.indexBuiltAt > this.INDEX_STALE_MS;
  }

  /**
   * Build or rebuild the BM25 index from analysis history
   * Uses a lock to prevent concurrent builds (race condition safe)
   *
   * @returns {Promise<{success: boolean, indexed: number, error?: string}>}
   */
  async buildBM25Index() {
    // Prevent concurrent index builds - return existing promise if building
    if (this._indexBuildPromise) {
      logger.debug('[SearchService] Index build already in progress, waiting...');
      return this._indexBuildPromise;
    }

    this._indexBuildPromise = this._doBuildBM25Index();
    try {
      return await this._indexBuildPromise;
    } finally {
      this._indexBuildPromise = null;
    }
  }

  /**
   * Internal method to actually build the BM25 index
   * @private
   */
  async _doBuildBM25Index() {
    try {
      logger.info('[SearchService] Building BM25 index...');

      await this.history.initialize();
      const entries = this.history.analysisHistory?.entries || {};
      // De-dupe by canonical file ID (path-based) and prefer the most recent analysis entry.
      // This is required because analysis history uses UUIDs per analysis run, while semantic search uses path IDs.
      const documents = Object.values(entries).sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      if (documents.length === 0) {
        logger.warn('[SearchService] No documents to index');
        this.bm25Index = null;
        this.documentMap.clear();
        return { success: true, indexed: 0 };
      }

      // Build index into local variables first so a build failure doesn't leave partial state behind.
      const nextDocumentMap = new Map();
      const self = this;
      const seenIds = new Set();
      const nextIndex = lunr(function () {
        // Configure fields with boosting
        // FIX P1-4: Increased extractedText boost from 1 to 2.5 so content matches
        // compete better with metadata matches (subject, tags) in search results
        this.ref('id');
        this.field('fileName', { boost: 3 });
        this.field('subject', { boost: 2 });
        this.field('summary', { boost: 1.5 });
        this.field('tags', { boost: 2 });
        this.field('category', { boost: 1.5 });
        this.field('extractedText', { boost: 2.5 });

        // Add documents
        for (const doc of documents) {
          const analysis = doc.analysis || {};
          const organization = doc.organization || {};

          // FIX: Use current path/name after organization, not original path
          // If file was moved/renamed, use the actual destination path
          const currentPath = organization.actual || doc.originalPath;
          const currentName = organization.newName || doc.fileName || '';

          // Use normalizePathForIndex for Windows case-insensitivity consistency
          // This ensures BM25 index keys match ChromaDB lookups
          const normalizedPath = normalizePathForIndex(currentPath || '');
          const canonicalId = getSemanticFileId(normalizedPath);

          // De-dupe: keep the most recent analysis per canonical file ID
          if (!currentPath || seenIds.has(canonicalId)) {
            continue;
          }
          seenIds.add(canonicalId);

          const indexDoc = {
            id: canonicalId,
            fileName: currentName,
            subject: analysis.subject || '',
            summary: analysis.summary || '',
            tags: (analysis.tags || []).join(' '),
            category: analysis.category || '',
            confidence: analysis.confidence || 0,
            extractedText: self._truncateText(analysis.extractedText, 5000)
          };

          this.add(indexDoc);

          // Store document metadata for result enrichment
          nextDocumentMap.set(canonicalId, {
            id: canonicalId,
            analysisId: doc.id,
            path: currentPath,
            name: currentName,
            type: doc.mimeType || 'document',
            subject: analysis.subject,
            summary: analysis.summary,
            tags: analysis.tags || [],
            category: analysis.category,
            confidence: analysis.confidence
          });
        }
      });

      // Commit the new index atomically.
      this.bm25Index = nextIndex;
      this.documentMap = nextDocumentMap;

      this.indexBuiltAt = Date.now();
      this.indexVersion++;

      // Cache serialized index for faster subsequent loads (with size limit)
      // Lunr indexes support JSON serialization
      try {
        const serializedIndex = JSON.stringify(this.bm25Index);
        const serializedDocMap = JSON.stringify(Array.from(this.documentMap.entries()));
        const totalSize =
          Buffer.byteLength(serializedIndex, 'utf8') + Buffer.byteLength(serializedDocMap, 'utf8');

        if (totalSize < this._maxCacheSize) {
          this._serializedIndex = serializedIndex;
          this._serializedDocMap = serializedDocMap;
          logger.debug(
            `[SearchService] Index serialized for caching (${Math.round(totalSize / 1024)}KB)`
          );
        } else {
          // Clear cache if too large to prevent memory issues
          this._serializedIndex = null;
          this._serializedDocMap = null;
          logger.warn(
            `[SearchService] Index too large to cache (${Math.round(totalSize / 1024 / 1024)}MB > ${this._maxCacheSize / 1024 / 1024}MB limit)`
          );
        }
      } catch (serializeErr) {
        logger.warn('[SearchService] Failed to serialize index:', serializeErr.message);
        this._serializedIndex = null;
        this._serializedDocMap = null;
      }

      // Log sample of indexed content for debugging
      const sampleDocs = documents.slice(0, 3).map((d) => ({
        fileName: d.fileName,
        subject: d.analysis?.subject?.slice(0, 50),
        tags: d.analysis?.tags?.slice(0, 3)
      }));
      logger.info(`[SearchService] BM25 index built with ${this.documentMap.size} documents`);
      logger.debug('[SearchService] Sample indexed docs:', sampleDocs);
      return { success: true, indexed: this.documentMap.size };
    } catch (error) {
      logger.error('[SearchService] Failed to build BM25 index:', error);
      return { success: false, indexed: 0, error: error.message };
    }
  }

  /**
   * Load index from serialized cache if available
   * Much faster than rebuilding from scratch
   *
   * @returns {boolean} True if loaded from cache
   */
  _tryLoadFromCache() {
    if (!this._serializedIndex || !this._serializedDocMap) {
      return false;
    }

    try {
      const startTime = Date.now();
      this.bm25Index = lunr.Index.load(JSON.parse(this._serializedIndex));
      this.documentMap = new Map(JSON.parse(this._serializedDocMap));
      this.indexBuiltAt = Date.now();

      logger.info(`[SearchService] Index loaded from cache in ${Date.now() - startTime}ms`);
      return true;
    } catch (error) {
      logger.warn('[SearchService] Failed to load from cache:', error.message);
      this._serializedIndex = null;
      this._serializedDocMap = null;
      return false;
    }
  }

  /**
   * Truncate text to a maximum length for indexing
   *
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  _truncateText(text, maxLength) {
    if (!text || typeof text !== 'string') return '';
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  }

  _padOrTruncateVector(vector, expectedDim) {
    if (!Array.isArray(vector) || vector.length === 0) return null;
    if (!Number.isInteger(expectedDim) || expectedDim <= 0) return vector;
    if (vector.length === expectedDim) return vector;
    if (vector.length < expectedDim) {
      return vector.concat(new Array(expectedDim - vector.length).fill(0));
    }
    return vector.slice(0, expectedDim);
  }

  /**
   * Normalize query embedding vector to match the stored collection dimension.
   * STRICT MODE: Fails if dimensions mismatch to prevent semantic garbage.
   *
   * @param {number[]} vector
   * @param {'files'|'fileChunks'} collectionType
   * @returns {Promise<number[]|null>}
   */
  async _normalizeQueryVector(vector, collectionType) {
    if (!Array.isArray(vector) || vector.length === 0) return null;
    try {
      const expectedDim = await this.chromaDb.getCollectionDimension(collectionType);

      // If collection is empty, any dimension is valid
      if (expectedDim == null) return vector;

      // STRICT CHECK: Fail if dimensions mismatch
      if (!validateEmbeddingDimensions(vector, expectedDim)) {
        const errorMsg =
          `Embedding model changed. Your search index uses ${expectedDim}-dimension embeddings, ` +
          `but your current model produces ${vector.length}-dimension embeddings. ` +
          `Please rebuild your search index to use the new model.`;

        logger.error('[SearchService] Embedding dimension mismatch - failing vector search', {
          collectionType,
          expected: expectedDim,
          actual: vector.length,
          reason: 'Model mismatch likely'
        });

        // FIX C-1: Throw descriptive error instead of returning null
        // This allows UI to display actionable message to user
        throw new Error(errorMsg);
      }

      return vector;
    } catch (e) {
      // If dimension check fails, log and fail safe
      logger.warn('[SearchService] Failed to validate query vector dimension:', e.message);
      return null;
    }
  }

  /**
   * Search using BM25 keyword matching
   *
   * @param {string} query - Search query
   * @param {number} topK - Number of results to return
   * @returns {Array} Search results with scores
   */
  bm25Search(query, topK = 20) {
    if (!this.bm25Index) {
      logger.warn('[SearchService] BM25 index not built');
      return [];
    }

    try {
      // Escape special lunr characters
      const safeQuery = this._escapeLunrQuery(query);
      logger.debug(`[SearchService] BM25 search query: "${query}" -> escaped: "${safeQuery}"`);
      const results = this.bm25Index.search(safeQuery);
      logger.debug(`[SearchService] BM25 raw results: ${results.length}`);

      const mapped = results.slice(0, topK).map((result) => {
        const meta = this.documentMap.get(result.ref) || {};

        // Extract matched terms and fields from Lunr matchData for match explanations
        const matchedTerms = [];
        const matchedFields = new Set();

        if (result.matchData && result.matchData.metadata) {
          Object.entries(result.matchData.metadata).forEach(([term, fields]) => {
            matchedTerms.push(term);
            Object.keys(fields).forEach((field) => matchedFields.add(field));
          });
        }

        return {
          id: result.ref,
          score: result.score,
          metadata: {
            path: meta.path,
            name: meta.name,
            type: meta.type,
            tags: meta.tags || [],
            category: meta.category || '',
            subject: meta.subject || '',
            confidence: meta.confidence || 0
          },
          source: 'bm25',
          matchDetails: {
            matchedTerms: matchedTerms.slice(0, 5), // Limit to top 5 terms
            matchedFields: Array.from(matchedFields)
          }
        };
      });

      if (mapped.length) {
        logger.debug('[SearchService] BM25 top candidates', {
          top: mapped.slice(0, 3).map((r) => ({
            score: r.score?.toFixed?.(3),
            id: r.id?.split(/[\\/]/).pop(),
            matchedFields: r.matchDetails?.matchedFields
          }))
        });
      } else {
        logger.debug('[SearchService] BM25 produced no mapped results');
      }

      return mapped;
    } catch (error) {
      logger.error('[SearchService] BM25 search failed:', error);
      return [];
    }
  }

  /**
   * Escape special characters for lunr query
   *
   * @param {string} query - Raw query string
   * @returns {string} Escaped query
   */
  _escapeLunrQuery(query) {
    if (!query || typeof query !== 'string') return '';

    // Escape lunr special characters: + - && || ! ( ) { } [ ] ^ " ~ * ? : \
    return query.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ').trim();
  }

  /**
   * Search using vector similarity via ChromaDB
   *
   * @param {string} query - Search query
   * @param {number} topK - Number of results to return
   * @returns {Promise<Array>} Search results with scores
   */
  async vectorSearch(query, topK = 20) {
    try {
      // Generate query embedding
      const embedResult = await this.embedding.embedText(query);
      if (!embedResult || !embedResult.vector) {
        logger.warn('[SearchService] Failed to generate query embedding');
        return [];
      }
      logger.debug(`[SearchService] Query embedding generated, dim=${embedResult.vector?.length}`);

      // Normalize/Validate vector against collection dimension
      const queryVector = await this._normalizeQueryVector(embedResult.vector, 'files');
      if (!queryVector) {
        logger.warn(
          '[SearchService] Aborting vector search due to invalid/mismatched query vector'
        );
        return [];
      }

      // Query ChromaDB
      const chromaResults = await this.chromaDb.querySimilarFiles(queryVector, topK);
      logger.debug(`[SearchService] ChromaDB returned ${chromaResults?.length || 0} results`);

      if (!chromaResults || !Array.isArray(chromaResults)) {
        logger.warn('[SearchService] ChromaDB returned no results or invalid format');
        return [];
      }

      // Extract query words for tag/category matching
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      return chromaResults.map((result) => {
        // FIX: Use score if available, otherwise convert distance to similarity
        // ChromaDB cosine distance is in range [0, 2], convert with: 1 - distance/2
        // Also handle score=0 as a valid score (not falsy fallback)
        const semanticScore =
          typeof result.score === 'number'
            ? result.score
            : Math.max(0, 1 - (result.distance || 0) / 2);
        const metadata = result.metadata || {};

        // FIX: Tags are stored as JSON string in ChromaDB, need to parse them
        let tags = [];
        if (Array.isArray(metadata.tags)) {
          tags = metadata.tags;
        } else if (typeof metadata.tags === 'string' && metadata.tags) {
          try {
            const parsed = JSON.parse(metadata.tags);
            tags = Array.isArray(parsed) ? parsed : [];
          } catch {
            // If parsing fails, treat as empty array
            tags = [];
          }
        }

        const queryTermsInTags = tags.filter((tag) =>
          queryWords.some((word) => String(tag).toLowerCase().includes(word))
        );

        // Check if query terms appear in category
        const category = metadata.category || '';
        const queryTermsInCategory = queryWords.some((word) =>
          category.toLowerCase().includes(word)
        );

        return {
          id: result.id,
          score: semanticScore,
          metadata,
          source: 'vector',
          matchDetails: {
            semanticScore,
            queryTermsInTags: queryTermsInTags.slice(0, 3),
            queryTermsInCategory
          }
        };
      });
    } catch (error) {
      logger.error('[SearchService] Vector search failed:', error);
      return [];
    }
  }

  /**
   * Chunk search: query against extractedText chunk embeddings.
   *
   * Returns file-level candidates aggregated from chunk hits.
   * @param {string} query
   * @param {number} topKFiles
   * @param {number} topKChunks
   * @returns {Promise<Array>}
   */
  async chunkSearch(query, topKFiles = 20, topKChunks = 80) {
    try {
      // Inspect chunk collection availability and count
      try {
        const chunkCollection = this.chromaDb?.fileChunkCollection;
        if (!chunkCollection) {
          logger.warn('[SearchService] Chunk collection unavailable; skipping chunk search');
          return [];
        }
        const chunkCount = (await chunkCollection.count?.()) ?? null;
        if (chunkCount === 0) {
          logger.debug('[SearchService] Chunk collection empty; no chunk results available');
          return [];
        }
        logger.debug('[SearchService] Chunk collection ready', { chunkCount, topKChunks });
      } catch (countErr) {
        logger.debug('[SearchService] Unable to get chunk collection count', {
          error: countErr.message
        });
      }

      const embedResult = await this.embedding.embedText(query);
      if (!embedResult || !embedResult.vector) {
        logger.warn('[SearchService] Failed to generate query embedding for chunk search');
        return [];
      }

      // Normalize/Validate vector against collection dimension
      const queryVector = await this._normalizeQueryVector(embedResult.vector, 'fileChunks');
      if (!queryVector) {
        logger.warn('[SearchService] Aborting chunk search due to invalid/mismatched query vector');
        return [];
      }

      const chunkResults = await this.chromaDb.querySimilarFileChunks(queryVector, topKChunks);
      if (!Array.isArray(chunkResults) || chunkResults.length === 0) {
        logger.debug('[SearchService] Chunk search returned no results');
        return [];
      }

      // Aggregate chunk hits into file candidates (max score wins)
      const byFile = new Map();
      for (const hit of chunkResults) {
        const meta = hit?.metadata || {};
        const fileId = meta.fileId;
        if (!fileId) continue;

        const score = typeof hit.score === 'number' ? hit.score : 0;
        const existing = byFile.get(fileId);
        if (!existing || score > existing.score) {
          byFile.set(fileId, {
            id: fileId,
            score,
            metadata: {
              path: meta.path,
              name: meta.name,
              type: meta.type || 'document'
            },
            source: 'chunk',
            matchDetails: {
              chunkScore: score,
              bestSnippet: meta.snippet || hit.document || '',
              chunkIndex: meta.chunkIndex,
              charStart: meta.charStart,
              charEnd: meta.charEnd
            }
          });
        }
      }

      return Array.from(byFile.values())
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, topKFiles);
    } catch (error) {
      logger.error('[SearchService] Chunk search failed:', error);
      return [];
    }
  }

  /**
   * Enrich results with metadata from documentMap (AnalysisHistory)
   * This ensures we have the latest category/confidence even if the search source (e.g. vector) is stale
   *
   * @param {Array} results - Search results to enrich
   * @private
   */
  _enrichResults(results) {
    if (!results || !Array.isArray(results) || this.documentMap.size === 0) return;

    for (const r of results) {
      if (!r.id) continue;
      const doc = this.documentMap.get(r.id);
      if (doc) {
        // Merge metadata, preferring documentMap (latest analysis) over vector metadata (embed time)
        // This ensures category, confidence, etc are up to date
        r.metadata = { ...r.metadata, ...doc };
      }
    }
  }

  /**
   * Normalize scores to [0, 1] range using min-max scaling
   *
   * @param {Array} results - Array of results with scores
   * @returns {Array} Results with normalized scores
   */
  _normalizeScores(results) {
    if (!results || results.length === 0) return results;

    const scores = results.map((r) => r.score || 0);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    // If all scores are the same, return with score 1.0
    if (range === 0) {
      return results.map((r) => ({ ...r, score: 1.0, originalScore: r.score }));
    }

    return results.map((r) => ({
      ...r,
      score: ((typeof r.score === 'number' ? r.score : 0) - minScore) / range,
      originalScore: r.score
    }));
  }

  /**
   * Combine results using Reciprocal Rank Fusion with score normalization
   *
   * RRF formula: score(d) = sum(1 / (k + rank_i(d)))
   * Enhanced with optional weighted score blending for better ranking
   *
   * @param {Array<Array>} resultSets - Arrays of ranked results
   * @param {number} k - RRF constant (default: 60)
   * @param {Object} options - Fusion options
   * @param {boolean} options.normalizeScores - Whether to normalize source scores (default: true)
   * @param {boolean} options.useScoreBlending - Blend original scores with RRF (default: true)
   * @returns {Array} Fused and re-ranked results
   */
  reciprocalRankFusion(resultSets, k = SEARCH.RRF_K, options = {}) {
    const { normalizeScores = true, useScoreBlending = true } = options;

    const rrfScores = new Map();
    const originalScores = new Map(); // Track original scores for blending
    const resultData = new Map();
    const matchDetailsMap = new Map(); // Track and merge match details from all sources

    // Normalize scores within each result set for fair comparison
    const normalizedSets = normalizeScores
      ? resultSets.map((set) => this._normalizeScores(set))
      : resultSets;

    for (const results of normalizedSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const id = result?.id;

        // Skip results with missing ID to prevent corruption
        if (!id) {
          logger.warn('[SearchService] Skipping result with missing id in RRF fusion');
          continue;
        }

        // RRF score contribution
        const rrfContribution = 1 / (k + rank + 1);
        rrfScores.set(id, (rrfScores.get(id) || 0) + rrfContribution);

        // Track normalized scores for blending
        if (useScoreBlending) {
          const currentMax = originalScores.get(id) || 0;
          originalScores.set(id, Math.max(currentMax, result.score || 0));
        }

        // Merge match details from all sources
        const existingDetails = matchDetailsMap.get(id) || { sources: [] };
        const newDetails = result.matchDetails || {};
        matchDetailsMap.set(id, {
          ...existingDetails,
          ...newDetails,
          sources: [...existingDetails.sources, result.source].filter(Boolean)
        });

        // Prefer vector search metadata (has current file names) over BM25 (may have old names)
        // Vector search uses ChromaDB which is updated when files are organized
        const existing = resultData.get(id);
        if (!existing || (result.source === 'vector' && existing.source !== 'vector')) {
          resultData.set(id, result);
        }
      }
    }

    // Normalize RRF scores to [0, 1]
    const rrfValues = Array.from(rrfScores.values());
    const maxRrf = Math.max(...rrfValues, SEARCH.MIN_EPSILON);

    // Sort by RRF score
    const fusedResults = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, rrfScore]) => {
        const original = resultData.get(id) || {};
        const normalizedRrf = rrfScore / maxRrf;

        // Blend RRF with original score for better ranking
        let finalScore = normalizedRrf;
        if (useScoreBlending && originalScores.has(id)) {
          const origScore = originalScores.get(id);
          finalScore =
            SEARCH.RRF_NORMALIZED_WEIGHT * normalizedRrf + SEARCH.RRF_ORIGINAL_WEIGHT * origScore;
        }

        return {
          id,
          score: finalScore,
          rrfScore: normalizedRrf,
          metadata: original.metadata || {},
          sources: original.source ? [original.source] : ['fused'],
          matchDetails: matchDetailsMap.get(id) || {}
        };
      });

    return fusedResults;
  }

  /**
   * Execute vector search with timeout, falling back to empty results on timeout
   * Properly clears timeout to prevent timer leaks
   *
   * @param {string} query - Search query
   * @param {number} topK - Number of results
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<{results: Array, timedOut: boolean}>}
   */
  async _vectorSearchWithTimeout(query, topK, timeout = VECTOR_SEARCH_TIMEOUT) {
    let timeoutId = null;

    try {
      const result = await Promise.race([
        this.vectorSearch(query, topK).then((results) => {
          // Clear timeout immediately when search completes to prevent leak
          if (timeoutId) clearTimeout(timeoutId);
          return { results, timedOut: false };
        }),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({ results: [], timedOut: true }), timeout);
        })
      ]);

      // Ensure timeout is cleared in case of timeout winning the race
      if (timeoutId && result.timedOut) {
        // Timeout already fired, but clear for safety
        clearTimeout(timeoutId);
      }

      return result;
    } catch (error) {
      // Clear timeout on error to prevent leak
      if (timeoutId) clearTimeout(timeoutId);
      logger.warn('[SearchService] Vector search error, falling back:', error.message);
      return { results: [], timedOut: false, error: error.message };
    }
  }

  /**
   * Filter results by minimum score threshold
   *
   * @param {Array} results - Search results
   * @param {number} minScore - Minimum score threshold
   * @returns {Array} Filtered results
   */
  _filterByScore(results, minScore) {
    if (!minScore || minScore <= 0) return results;
    const filtered = results.filter((r) => (r.score || 0) >= minScore);
    const removedCount = results.length - filtered.length;
    if (removedCount > 0) {
      const topRemoved = results
        .filter((r) => (r.score || 0) < minScore)
        .slice(0, 3)
        .map((r) => ({ score: r.score?.toFixed(3), id: r.id?.slice(-20) }));
      logger.debug(
        `[SearchService] Filtered out ${removedCount} results below minScore ${minScore}:`,
        topRemoved
      );
    }
    return filtered;
  }

  /**
   * Perform hybrid search combining BM25 and vector search
   *
   * Features:
   * - Score normalization before RRF fusion
   * - Timeout fallback to BM25-only on vector search timeout
   * - Minimum score filtering for quality control
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {number} options.topK - Number of results (default: 20)
   * @param {string} options.mode - Search mode: 'hybrid', 'vector', 'bm25' (default: 'hybrid')
   * @param {number} options.minScore - Minimum score threshold (default: 0.5)
   * @returns {Promise<{success: boolean, results: Array, mode: string}>}
   */
  async hybridSearch(query, options = {}) {
    const {
      topK = DEFAULT_OPTIONS.topK,
      mode = DEFAULT_OPTIONS.mode,
      minScore = DEFAULT_OPTIONS.minScore,
      chunkWeight = DEFAULT_OPTIONS.chunkWeight,
      chunkTopK,
      // Query processing options
      expandSynonyms = DEFAULT_OPTIONS.expandSynonyms,
      correctSpelling = DEFAULT_OPTIONS.correctSpelling,
      // Re-ranking options
      rerank = DEFAULT_OPTIONS.rerank,
      rerankTopN = DEFAULT_OPTIONS.rerankTopN
    } = options;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return { success: false, results: [], error: 'Query too short' };
    }

    // FIX P2-1: Normalize query for all search modes (trim, collapse whitespace)
    // BM25 will additionally expand synonyms, but vector search uses this normalized version
    const normalizedQuery = query.trim().replace(/\s+/g, ' ');

    // Process query through QueryProcessor (spell correction + synonyms)
    // Start with normalized query, then optionally expand with synonyms
    let processedQuery = normalizedQuery;
    let queryMeta = null;
    const queryProcessor = this._getQueryProcessor();

    if (queryProcessor && (expandSynonyms || correctSpelling)) {
      try {
        const processed = await queryProcessor.processQuery(query, {
          expandSynonyms,
          correctSpelling,
          maxSynonymsPerWord: 3
        });
        processedQuery = processed.expanded || query;
        queryMeta = {
          original: processed.original,
          expanded: processed.expanded,
          corrections: processed.corrections,
          synonymsAdded: processed.synonymsAdded?.length || 0
        };

        if (processed.corrections?.length > 0) {
          logger.debug('[SearchService] Query corrections applied:', processed.corrections);
        }
      } catch (procErr) {
        logger.debug('[SearchService] Query processing failed, using original:', procErr.message);
      }
    }

    try {
      // Log collection and index status to aid troubleshooting
      try {
        const fileCount = await this.chromaDb?.fileCollection?.count?.();
        const chunkCount = await this.chromaDb?.fileChunkCollection?.count?.();
        const bm25Status = this.getIndexStatus();
        logger.debug('[SearchService] Search preflight status', {
          fileEmbeddings: fileCount,
          chunkEmbeddings: chunkCount,
          bm25Indexed: bm25Status.documentCount,
          bm25Stale: bm25Status.isStale,
          topK,
          minScore,
          mode,
          chunkTopK: Number.isInteger(chunkTopK) ? chunkTopK : topK * 6,
          queryExpanded: processedQuery !== query
        });
      } catch (statusErr) {
        logger.debug('[SearchService] Failed to gather preflight status', {
          error: statusErr.message
        });
      }

      // Ensure BM25 index is up to date
      if (this.isIndexStale()) {
        await this.buildBM25Index();
      }

      // Handle different search modes
      if (mode === 'bm25') {
        // Use expanded query for BM25 (benefits from synonyms)
        const results = this.bm25Search(processedQuery, topK);
        const filtered = this._filterByScore(results, minScore);
        return { success: true, results: filtered, mode: 'bm25', queryMeta };
      }

      if (mode === 'vector') {
        // FIX P2-1: Use normalized query for vector search (consistent preprocessing)
        const results = await this.vectorSearch(normalizedQuery, topK);
        this._enrichResults(results);
        const filtered = this._filterByScore(results, minScore);
        return { success: true, results: filtered, mode: 'vector', queryMeta };
      }

      // Hybrid mode: combine both search types with timeout protection
      // FIX P2-1: Use expanded query for BM25, normalized for vector (consistent preprocessing)
      const bm25Results = this.bm25Search(processedQuery, topK * 2);
      const { results: vectorResults, timedOut } = await this._vectorSearchWithTimeout(
        normalizedQuery,
        topK * 2
      );
      const chunkResults = await this.chunkSearch(
        normalizedQuery,
        topK * 2,
        Number.isInteger(chunkTopK) ? chunkTopK : topK * 6
      );

      // If vector search timed out, use BM25-only with degraded mode indicator
      if (timedOut) {
        logger.warn('[SearchService] Vector search timed out, using BM25-only fallback');
        const filtered = this._filterByScore(bm25Results.slice(0, topK), minScore);
        return {
          success: true,
          results: filtered,
          mode: 'bm25-fallback',
          queryMeta,
          meta: {
            fallback: true,
            fallbackReason: 'vector search timeout',
            originalMode: 'hybrid',
            vectorTimedOut: true,
            bm25Count: bm25Results.length,
            queryExpanded: processedQuery !== query
          }
        };
      }

      // Enrich vector/chunk results with up-to-date metadata from documentMap if available
      this._enrichResults(vectorResults);
      this._enrichResults(chunkResults);

      // Log search results for debugging
      logger.debug('[SearchService] Hybrid search results:', {
        vectorCount: vectorResults.length,
        bm25Count: bm25Results.length,
        chunkCount: chunkResults.length
      });

      // Quick peek at top scores/ids for troubleshooting (redacted to last path segment)
      const peek = (arr) =>
        arr.slice(0, 3).map((r) => ({
          score: r.score?.toFixed?.(3),
          id: r.id?.split(/[\\/]/).pop()
        }));
      if (vectorResults.length || bm25Results.length || chunkResults.length) {
        logger.debug('[SearchService] Top candidates preview', {
          vectorTop: peek(vectorResults),
          bm25Top: peek(bm25Results),
          chunkTop: peek(chunkResults)
        });
      }

      // Normalize scores within each source so weights are comparable
      const normalizedBm25 = this._normalizeScores(bm25Results).map((r) => ({
        ...r,
        bm25Score: r.score,
        bm25RawScore: r.originalScore ?? r.score
      }));
      const normalizedVector = this._normalizeScores(vectorResults).map((r) => ({
        ...r,
        vectorScore: r.score,
        vectorRawScore: r.originalScore ?? r.score
      }));
      const normalizedChunks = this._normalizeScores(chunkResults).map((r) => ({
        ...r,
        chunkScore: r.score,
        chunkRawScore: r.originalScore ?? r.score
      }));

      // Weighted hybrid fusion (simple weighted sum of normalized scores)
      // Keep BM25 weight as configured; split remaining weight between file-vector and chunk-vector.
      const beta = SEARCH.BM25_WEIGHT;
      const remaining = Math.max(0, 1 - beta);
      const chunkShare = Math.min(1, Math.max(0, Number(chunkWeight)));
      const gamma = remaining * chunkShare;
      const alpha = remaining - gamma;
      const combined = new Map();

      const upsert = (entry, source) => {
        if (!entry?.id) return;
        const existing = combined.get(entry.id) || {
          id: entry.id,
          metadata: entry.metadata || {},
          matchDetails: { sources: [] }
        };

        // Prefer vector metadata when available
        const metadata =
          source === 'vector' || source === 'chunk'
            ? entry.metadata || existing.metadata
            : existing.metadata || entry.metadata || {};

        // Merge matchDetails and sources
        const mergedMatchDetails = {
          ...existing.matchDetails,
          ...entry.matchDetails,
          sources: [...(existing.matchDetails.sources || []), source].filter(Boolean)
        };

        combined.set(entry.id, {
          ...existing,
          metadata,
          matchDetails: mergedMatchDetails,
          bm25Score:
            source === 'bm25' ? (entry.bm25Score ?? existing.bm25Score) : existing.bm25Score,
          bm25RawScore:
            source === 'bm25'
              ? (entry.bm25RawScore ?? existing.bm25RawScore)
              : existing.bm25RawScore,
          vectorScore:
            source === 'vector'
              ? (entry.vectorScore ?? existing.vectorScore)
              : existing.vectorScore,
          vectorRawScore:
            source === 'vector'
              ? (entry.vectorRawScore ?? existing.vectorRawScore)
              : existing.vectorRawScore,
          chunkScore:
            source === 'chunk' ? (entry.chunkScore ?? existing.chunkScore) : existing.chunkScore,
          chunkRawScore:
            source === 'chunk'
              ? (entry.chunkRawScore ?? existing.chunkRawScore)
              : existing.chunkRawScore
        });
      };

      normalizedBm25.forEach((r) => upsert(r, 'bm25'));
      normalizedVector.forEach((r) => upsert(r, 'vector'));
      normalizedChunks.forEach((r) => upsert(r, 'chunk'));

      const fusedResults = Array.from(combined.values())
        .map((item) => {
          const semantic = item.vectorScore ?? 0;
          const chunk = item.chunkScore ?? 0;
          const keyword = item.bm25Score ?? 0;
          const combinedScore = alpha * semantic + gamma * chunk + beta * keyword;

          return {
            id: item.id,
            score: combinedScore,
            metadata: item.metadata || {},
            sources: item.matchDetails?.sources || ['hybrid'],
            matchDetails: {
              ...item.matchDetails,
              hybrid: {
                semanticScore: semantic,
                chunkScore: chunk,
                keywordScore: keyword,
                combinedScore,
                semanticWeight: alpha,
                chunkWeight: gamma,
                keywordWeight: beta,
                bm25RawScore: item.bm25RawScore,
                vectorRawScore: item.vectorRawScore,
                chunkRawScore: item.chunkRawScore
              }
            }
          };
        })
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      // Apply minimum score filter to fused results
      let filteredResults = this._filterByScore(fusedResults.slice(0, topK), minScore);

      // Apply LLM re-ranking if enabled
      let reranked = false;
      const reRanker = this._getReRanker();

      if (rerank && reRanker && reRanker.isAvailable() && filteredResults.length > 1) {
        try {
          logger.debug('[SearchService] Applying LLM re-ranking to top results', {
            candidateCount: filteredResults.length,
            rerankTopN
          });

          const rerankStartTime = Date.now();
          filteredResults = await reRanker.rerank(query, filteredResults, { topN: rerankTopN });
          reranked = true;

          logger.debug('[SearchService] Re-ranking complete', {
            latencyMs: Date.now() - rerankStartTime
          });
        } catch (rerankErr) {
          logger.warn('[SearchService] Re-ranking failed, using fusion order:', rerankErr.message);
        }
      }

      // Build diagnostic warnings for common issues
      const diagnosticWarnings = [];

      // CRITICAL: Vector search returning 0 results when BM25 has results indicates dimension mismatch
      if (vectorResults.length === 0 && bm25Results.length > 0) {
        diagnosticWarnings.push({
          type: 'VECTOR_SEARCH_EMPTY',
          severity: 'critical',
          message:
            'Vector search returned 0 results but BM25 has results. This strongly indicates an embedding dimension mismatch. Run "Rebuild Embeddings" to fix.'
        });
        logger.warn(
          '[SearchService] Vector search empty but BM25 has results - likely dimension mismatch',
          {
            bm25Count: bm25Results.length,
            query: query.substring(0, 50)
          }
        );

        // Auto-run full diagnostics when critical issue detected
        this._autoRunDiagnostics('Vector search returned 0 results with BM25 having results');
      }

      // Chunk search empty when file embeddings exist indicates chunks weren't built
      if (chunkResults.length === 0 && vectorResults.length > 0) {
        // Only warn if file collection has entries (otherwise chunk collection being empty is expected)
        try {
          const chunkCount = (await this.chromaDb?.fileChunkCollection?.count?.()) || 0;
          if (chunkCount === 0) {
            diagnosticWarnings.push({
              type: 'CHUNKS_NOT_BUILT',
              severity: 'medium',
              message:
                'Chunk embeddings not built. Deep text search unavailable. Run "Rebuild Embeddings" to enable.'
            });
          }
        } catch {
          // Non-critical
        }
      }

      // High filter rate indicates potential score calibration issues
      if (fusedResults.length > 0 && filteredResults.length === 0) {
        diagnosticWarnings.push({
          type: 'ALL_RESULTS_FILTERED',
          severity: 'high',
          message: `All ${fusedResults.length} results were filtered out by minScore=${minScore}. Consider lowering the threshold.`
        });
        // Auto-run diagnostics when all results filtered
        this._autoRunDiagnostics(
          `All ${fusedResults.length} results filtered out by minScore=${minScore}`
        );
      } else if (fusedResults.length > filteredResults.length * 2) {
        diagnosticWarnings.push({
          type: 'HIGH_FILTER_RATE',
          severity: 'low',
          message: `${fusedResults.length - filteredResults.length} of ${fusedResults.length} results filtered by minScore=${minScore}.`
        });
      }

      // Detect if vector search effectively failed (dimension mismatch or other issue)
      const vectorSearchFailed = vectorResults.length === 0 && bm25Results.length > 0;

      return {
        success: true,
        results: filteredResults,
        mode: reranked ? 'hybrid-reranked' : 'hybrid',
        queryMeta,
        meta: {
          vectorCount: vectorResults.length,
          bm25Count: bm25Results.length,
          chunkCount: chunkResults.length,
          fusedCount: fusedResults.length,
          filteredCount: filteredResults.length,
          minScoreApplied: minScore,
          weights: { vector: alpha, bm25: beta, chunk: gamma },
          reranked,
          queryExpanded: processedQuery !== query,
          // Signal fallback when vector search effectively unavailable
          ...(vectorSearchFailed && {
            fallback: true,
            fallbackReason: 'dimension mismatch or model unavailable',
            originalMode: 'hybrid'
          }),
          // Include warnings if any issues detected
          ...(diagnosticWarnings.length > 0 && { warnings: diagnosticWarnings })
        }
      };
    } catch (error) {
      logger.error('[SearchService] Hybrid search failed:', error);

      // Last resort: try BM25-only on complete failure
      try {
        const bm25Results = this.bm25Search(query, topK);
        if (bm25Results.length > 0) {
          logger.info('[SearchService] Falling back to BM25-only after hybrid failure');
          const filtered = this._filterByScore(bm25Results, minScore);
          return {
            success: true,
            results: filtered,
            mode: 'bm25-fallback',
            meta: {
              fallback: true,
              fallbackReason: 'hybrid search error',
              originalMode: 'hybrid',
              hybridError: error.message
            }
          };
        }
      } catch (bm25Error) {
        logger.error('[SearchService] BM25 fallback also failed:', bm25Error);
      }

      return {
        success: false,
        results: [],
        error: error.message
      };
    }
  }

  /**
   * Get the current index status
   *
   * @returns {Object} Index status information
   */
  getIndexStatus() {
    return {
      hasIndex: !!this.bm25Index,
      documentCount: this.documentMap.size,
      indexBuiltAt: this.indexBuiltAt,
      indexVersion: this.indexVersion,
      isStale: this.isIndexStale()
    };
  }

  /**
   * Force rebuild the BM25 index
   *
   * @returns {Promise<Object>} Build result
   */
  async rebuildIndex() {
    return this.buildBM25Index();
  }

  /**
   * Clear the BM25 index
   */
  clearIndex() {
    this.bm25Index = null;
    this.documentMap.clear();
    this.indexBuiltAt = null;
    logger.info('[SearchService] BM25 index cleared');
  }

  /**
   * Invalidate the BM25 index to force rebuild on next search
   * Call this after file moves/deletes to ensure fresh results
   *
   * @param {Object} options - Invalidation options
   * @param {string} [options.reason] - Reason for invalidation (for logging)
   * @param {string} [options.oldPath] - Old file path (for move operations)
   * @param {string} [options.newPath] - New file path (for move operations)
   */
  invalidateIndex(options = {}) {
    const { reason = 'manual', oldPath, newPath } = options;

    // Mark index as stale by setting indexBuiltAt to past
    if (this.indexBuiltAt) {
      this.indexBuiltAt = 0;
      logger.info('[SearchService] BM25 index invalidated', { reason, oldPath, newPath });
    }

    // Clear serialized cache to force full rebuild
    this._serializedIndex = null;
    this._serializedDocMap = null;
  }

  /**
   * Invalidate and optionally immediately rebuild the BM25 index
   * Use this for critical path updates where search results must be consistent immediately
   *
   * @param {Object} options - Options
   * @param {boolean} [options.immediate=true] - Whether to rebuild immediately
   * @param {string} [options.reason='manual'] - Reason for invalidation
   * @param {string} [options.oldPath] - Old file path (for move operations)
   * @param {string} [options.newPath] - New file path (for move operations)
   * @returns {Promise<{success: boolean, rebuilt?: boolean, indexed?: number, error?: string}>}
   */
  async invalidateAndRebuild(options = {}) {
    const { immediate = true, reason = 'manual', oldPath, newPath } = options;

    // First invalidate the index
    this.invalidateIndex({ reason, oldPath, newPath });

    if (immediate) {
      try {
        logger.info('[SearchService] Triggering immediate BM25 rebuild', { reason });
        const result = await this.buildBM25Index();
        return {
          success: result.success,
          rebuilt: true,
          indexed: result.indexed,
          error: result.error
        };
      } catch (error) {
        logger.warn('[SearchService] Immediate rebuild failed', { error: error.message });
        return {
          success: false,
          rebuilt: false,
          error: error.message
        };
      }
    }

    // If not immediate, just return success (index will rebuild on next search)
    return { success: true, rebuilt: false };
  }

  /**
   * Warm up the search service by pre-building indices
   * Call this during app startup for faster first search
   *
   * @param {Object} options - Warm-up options
   * @param {boolean} [options.buildBM25=true] - Build BM25 index
   * @param {boolean} [options.warmChroma=true] - Warm ChromaDB connection
   * @returns {Promise<{success: boolean, bm25Indexed: number, chromaReady: boolean}>}
   */
  async warmUp(options = {}) {
    const { buildBM25 = true, warmChroma = true } = options;
    const result = { success: true, bm25Indexed: 0, chromaReady: false };

    try {
      logger.info('[SearchService] Starting warm-up...');

      const tasks = [];

      // Build BM25 index in background
      if (buildBM25) {
        tasks.push(
          this.buildBM25Index().then((res) => {
            result.bm25Indexed = res.indexed || 0;
            return res;
          })
        );
      }

      // Warm ChromaDB connection
      if (warmChroma && this.chromaDb) {
        tasks.push(
          this.chromaDb.initialize().then(() => {
            result.chromaReady = true;
            return true;
          })
        );
      }

      await Promise.allSettled(tasks);

      logger.info('[SearchService] Warm-up complete', result);
      return result;
    } catch (error) {
      logger.warn('[SearchService] Warm-up failed:', error.message);
      result.success = false;
      return result;
    }
  }

  /**
   * Get search performance metrics
   *
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    return {
      indexStatus: this.getIndexStatus(),
      hasCachedIndex: !!this._serializedIndex,
      cachedIndexSize: this._serializedIndex?.length || 0,
      documentCount: this.documentMap.size
    };
  }

  /**
   * Get embedding health diagnostics
   * Analyzes ChromaDB state, model distribution, and orphaned entries
   *
   * @returns {Promise<Object>} Health report
   */
  async getEmbeddingHealth() {
    try {
      const stats = await this.chromaDb.getStats();
      const historyEntries = this.history.analysisHistory?.entries || {};
      const historyCount = Object.keys(historyEntries).length;

      // Get sample of file embeddings to check model/dimensions
      const fileSample = [];
      try {
        if (this.chromaDb.fileCollection) {
          const result = await this.chromaDb.fileCollection.peek({ limit: 50 });
          if (result && result.ids && result.ids.length > 0) {
            // Reconstruct objects from columnar arrays
            for (let i = 0; i < result.ids.length; i++) {
              fileSample.push({
                id: result.ids[i],
                embedding: result.embeddings ? result.embeddings[i] : [],
                metadata: result.metadatas ? result.metadatas[i] : {}
              });
            }
          }
        }
      } catch (e) {
        logger.warn('[SearchService] Failed to peek file embeddings:', e.message);
      }

      // Analyze models and dimensions
      const models = {};
      const dimensions = {};

      fileSample.forEach((item) => {
        const model = item.metadata?.model || 'unknown';
        models[model] = (models[model] || 0) + 1;

        const dim = Array.isArray(item.embedding) ? item.embedding.length : 0;
        if (dim > 0) {
          dimensions[dim] = (dimensions[dim] || 0) + 1;
        }
      });

      // Check for orphans (files in history but not in vector DB)
      // Note: This is an approximation as history IDs != vector IDs (vector IDs are file paths)
      // We'll skip precise orphan checking here to avoid perf impact on large libraries

      return {
        healthy: true,
        stats: {
          historyCount,
          vectorFileCount: stats.files,
          vectorChunkCount: stats.fileChunks,
          vectorFolderCount: stats.folders
        },
        models,
        dimensions,
        sampleSize: fileSample.length
      };
    } catch (error) {
      logger.error('[SearchService] Health check failed:', error);
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  /**
   * Comprehensive search diagnostics - identifies why search may return partial results
   * Call this when troubleshooting search issues
   *
   * @param {string} [testQuery='test'] - Optional query to test embedding generation
   * @returns {Promise<Object>} Diagnostic report with issues and recommendations
   */
  async diagnoseSearchIssues(testQuery = 'test') {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      issues: [],
      warnings: [],
      recommendations: [],
      details: {}
    };

    try {
      // 1. Check ChromaDB collection status
      let fileCount = 0;
      let chunkCount = 0;
      let folderCount = 0;

      try {
        fileCount = (await this.chromaDb?.fileCollection?.count?.()) || 0;
        chunkCount = (await this.chromaDb?.fileChunkCollection?.count?.()) || 0;
        folderCount = (await this.chromaDb?.folderCollection?.count?.()) || 0;
      } catch (e) {
        diagnostics.issues.push({
          type: 'CHROMADB_ERROR',
          severity: 'critical',
          message: `ChromaDB connection error: ${e.message}`
        });
      }

      diagnostics.details.collections = { fileCount, chunkCount, folderCount };

      if (fileCount === 0) {
        diagnostics.issues.push({
          type: 'EMPTY_FILE_COLLECTION',
          severity: 'critical',
          message: 'File embeddings collection is empty. Vector search will return no results.'
        });
        diagnostics.recommendations.push(
          'Run "Rebuild Embeddings" from Settings to populate the vector database.'
        );
      }

      if (chunkCount === 0 && fileCount > 0) {
        diagnostics.warnings.push({
          type: 'EMPTY_CHUNK_COLLECTION',
          severity: 'medium',
          message:
            'Chunk embeddings collection is empty. Deep text search (chunk search) is unavailable.'
        });
        diagnostics.recommendations.push(
          'Run "Rebuild Embeddings" to enable deep text search from extracted content.'
        );
      }

      // 2. Check BM25 index status
      const bm25Status = this.getIndexStatus();
      diagnostics.details.bm25 = bm25Status;

      if (!bm25Status.hasIndex) {
        diagnostics.issues.push({
          type: 'NO_BM25_INDEX',
          severity: 'high',
          message: 'BM25 keyword search index not built.'
        });
      } else if (bm25Status.documentCount === 0) {
        diagnostics.issues.push({
          type: 'EMPTY_BM25_INDEX',
          severity: 'high',
          message: 'BM25 index has no documents indexed.'
        });
      } else if (bm25Status.isStale) {
        diagnostics.warnings.push({
          type: 'STALE_BM25_INDEX',
          severity: 'low',
          message: 'BM25 index is stale and will be rebuilt on next search.'
        });
      }

      // 3. Check embedding dimension consistency
      let storedDimension = null;
      let queryDimension = null;
      let dimensionMismatch = false;

      try {
        storedDimension = await this.chromaDb.getCollectionDimension('files');
        diagnostics.details.storedDimension = storedDimension;

        // Generate a test embedding to check current model dimensions
        const testResult = await this.embedding.embedText(testQuery);
        if (testResult?.vector && Array.isArray(testResult.vector)) {
          queryDimension = testResult.vector.length;
          diagnostics.details.queryDimension = queryDimension;
          diagnostics.details.embeddingModel = testResult.model || 'unknown';

          if (storedDimension && queryDimension && storedDimension !== queryDimension) {
            dimensionMismatch = true;
            diagnostics.issues.push({
              type: 'DIMENSION_MISMATCH',
              severity: 'critical',
              message: `Embedding dimension mismatch! Stored vectors have ${storedDimension} dimensions, but current model produces ${queryDimension} dimensions. Vector search will fail.`,
              storedDimension,
              queryDimension
            });
            diagnostics.recommendations.push(
              'Run "Full Rebuild" from Settings to regenerate all embeddings with the current model.'
            );
          }
        } else {
          diagnostics.issues.push({
            type: 'EMBEDDING_GENERATION_FAILED',
            severity: 'critical',
            message:
              'Failed to generate test embedding. Ollama may not be running or embedding model may not be available.'
          });
          diagnostics.recommendations.push(
            'Ensure Ollama is running and the embedding model is installed (ollama pull embeddinggemma).'
          );
        }
      } catch (e) {
        diagnostics.warnings.push({
          type: 'DIMENSION_CHECK_ERROR',
          severity: 'medium',
          message: `Could not verify embedding dimensions: ${e.message}`
        });
      }

      // 4. Check chunk collection dimension (for hybrid search)
      if (chunkCount > 0 && !dimensionMismatch) {
        try {
          const chunkDimension = await this.chromaDb.getCollectionDimension('fileChunks');
          diagnostics.details.chunkDimension = chunkDimension;

          if (chunkDimension && queryDimension && chunkDimension !== queryDimension) {
            diagnostics.issues.push({
              type: 'CHUNK_DIMENSION_MISMATCH',
              severity: 'high',
              message: `Chunk collection dimension (${chunkDimension}) differs from current model (${queryDimension}). Chunk search will fail.`
            });
          }
        } catch (e) {
          // Non-critical
        }
      }

      // 5. Compare history count vs embedding count
      try {
        await this.history.initialize();
        const historyEntries = this.history.analysisHistory?.entries || {};
        const historyCount = Object.keys(historyEntries).length;
        diagnostics.details.historyCount = historyCount;

        if (historyCount > 0 && fileCount === 0) {
          diagnostics.issues.push({
            type: 'HISTORY_WITHOUT_EMBEDDINGS',
            severity: 'high',
            message: `Analysis history has ${historyCount} entries but file embeddings collection is empty.`
          });
          diagnostics.recommendations.push(
            'Run "Rebuild Embeddings" to create embeddings from your analysis history.'
          );
        } else if (historyCount > fileCount * 1.5) {
          diagnostics.warnings.push({
            type: 'EMBEDDINGS_OUT_OF_SYNC',
            severity: 'medium',
            message: `Analysis history (${historyCount}) significantly exceeds file embeddings (${fileCount}). Some files may not be searchable.`
          });
        }
      } catch (e) {
        // Non-critical
      }

      // 6. Check Ollama health status
      try {
        if (this.ollamaService?.getHealthStatus) {
          const healthStatus = await this.ollamaService.getHealthStatus();
          const ollamaHealth = healthStatus?.resilientClient || {};
          diagnostics.details.ollama = {
            isHealthy: ollamaHealth.isHealthy ?? healthStatus?.available ?? false,
            consecutiveFailures: ollamaHealth.consecutiveFailures || 0,
            lastHealthCheck: ollamaHealth.lastHealthCheck,
            offlineQueueSize: ollamaHealth.offlineQueueSize || 0,
            available: healthStatus?.available,
            latencyMs: healthStatus?.latencyMs
          };

          if (!diagnostics.details.ollama.isHealthy) {
            diagnostics.issues.push({
              type: 'OLLAMA_UNHEALTHY',
              severity: 'critical',
              message: `Ollama server is unhealthy. Consecutive failures: ${ollamaHealth.consecutiveFailures || 0}`
            });
            diagnostics.recommendations.push('Check if Ollama is running: ollama serve');
          }

          if (ollamaHealth.offlineQueueSize > 0) {
            diagnostics.warnings.push({
              type: 'OLLAMA_OFFLINE_QUEUE',
              severity: 'medium',
              message: `${ollamaHealth.offlineQueueSize} Ollama requests queued offline waiting for server recovery.`
            });
          }
        }
      } catch (e) {
        // Non-critical - Ollama service may not be available
        logger.debug('[SearchService] Could not get Ollama health status:', e.message);
      }

      // 7. Check ChromaDB circuit breaker status
      try {
        const circuitStats = this.chromaDb?.getCircuitStats?.();
        if (circuitStats) {
          diagnostics.details.circuitBreaker = circuitStats;

          if (circuitStats.state === 'OPEN') {
            diagnostics.issues.push({
              type: 'CIRCUIT_BREAKER_OPEN',
              severity: 'critical',
              message: `ChromaDB circuit breaker is OPEN due to ${circuitStats.failures} failures. All vector operations are blocked.`
            });
            diagnostics.recommendations.push(
              'Wait for circuit breaker to reset or restart the application.'
            );
          } else if (circuitStats.state === 'HALF_OPEN') {
            diagnostics.warnings.push({
              type: 'CIRCUIT_BREAKER_RECOVERING',
              severity: 'medium',
              message: 'ChromaDB circuit breaker is recovering (HALF_OPEN state).'
            });
          }
        }
      } catch (e) {
        // Non-critical
      }

      // 8. Check ChromaDB offline queue status
      try {
        const queueStats = this.chromaDb?.getQueueStats?.();
        if (queueStats) {
          diagnostics.details.chromaOfflineQueue = queueStats;

          if (queueStats.queueSize > 0) {
            diagnostics.warnings.push({
              type: 'CHROMADB_OFFLINE_QUEUE',
              severity: 'medium',
              message: `${queueStats.queueSize} ChromaDB operations queued offline. These will process when server recovers.`
            });
          }
        }
      } catch (e) {
        // Non-critical
      }

      // 9. Check query cache stats
      try {
        const cacheStats = this.chromaDb?.getQueryCacheStats?.();
        if (cacheStats) {
          diagnostics.details.queryCache = cacheStats;

          if (cacheStats.totalQueries > 100 && cacheStats.hitRate < 0.1) {
            diagnostics.warnings.push({
              type: 'LOW_CACHE_HIT_RATE',
              severity: 'low',
              message: `Query cache hit rate is very low (${(cacheStats.hitRate * 100).toFixed(1)}%). This may indicate cache misconfiguration.`
            });
          }
        }
      } catch (e) {
        // Non-critical
      }

      // 10. Check embedding queue status
      try {
        const embeddingQueue = require('../analysis/embeddingQueue');
        const queueStats = embeddingQueue.getStats?.();
        if (queueStats) {
          diagnostics.details.embeddingQueue = {
            queueLength: queueStats.queueLength,
            capacityPercent: queueStats.capacityPercent,
            isFlushing: queueStats.isFlushing,
            failedItemCount: queueStats.failedItemCount,
            deadLetterCount: queueStats.deadLetterCount,
            healthStatus: queueStats.healthStatus
          };

          if (queueStats.queueLength > 0) {
            diagnostics.warnings.push({
              type: 'PENDING_EMBEDDINGS',
              severity: 'low',
              message: `${queueStats.queueLength} embeddings pending in queue (${queueStats.capacityPercent?.toFixed(1) || 0}% capacity).`
            });
          }

          if (queueStats.failedItemCount > 0) {
            diagnostics.warnings.push({
              type: 'FAILED_EMBEDDINGS',
              severity: 'medium',
              message: `${queueStats.failedItemCount} embeddings failed and awaiting retry.`
            });
          }

          if (queueStats.deadLetterCount > 0) {
            diagnostics.issues.push({
              type: 'DEAD_LETTER_ITEMS',
              severity: 'high',
              message: `${queueStats.deadLetterCount} embeddings permanently failed (in dead letter queue).`
            });
            diagnostics.recommendations.push(
              'Review dead letter items in Settings > Advanced to identify recurring failures.'
            );
          }

          if (queueStats.healthStatus === 'critical') {
            diagnostics.issues.push({
              type: 'EMBEDDING_QUEUE_CRITICAL',
              severity: 'high',
              message: 'Embedding queue is at critical capacity. New embeddings may be dropped.'
            });
          } else if (queueStats.healthStatus === 'warning') {
            diagnostics.warnings.push({
              type: 'EMBEDDING_QUEUE_HIGH',
              severity: 'medium',
              message: 'Embedding queue is at high capacity. Processing may be slow.'
            });
          }
        }
      } catch (e) {
        // Non-critical - queue module may not be available
      }

      // 11. Check for orphaned embeddings
      try {
        const orphanedFiles = await this.chromaDb?.getOrphanedEmbeddings?.({ maxAge: null });
        const orphanedChunks = await this.chromaDb?.getOrphanedChunks?.({ maxAge: null });

        if (orphanedFiles?.length > 0 || orphanedChunks?.length > 0) {
          diagnostics.details.orphaned = {
            files: orphanedFiles?.length || 0,
            chunks: orphanedChunks?.length || 0
          };

          if ((orphanedFiles?.length || 0) + (orphanedChunks?.length || 0) > 100) {
            diagnostics.warnings.push({
              type: 'ORPHANED_EMBEDDINGS',
              severity: 'low',
              message: `${orphanedFiles?.length || 0} orphaned file embeddings and ${orphanedChunks?.length || 0} orphaned chunk embeddings. Consider cleanup.`
            });
          }
        }
      } catch (e) {
        // Non-critical
      }

      // 12. Summary
      diagnostics.summary = {
        criticalIssues: diagnostics.issues.filter((i) => i.severity === 'critical').length,
        highIssues: diagnostics.issues.filter((i) => i.severity === 'high').length,
        warnings: diagnostics.warnings.length,
        searchFunctional:
          fileCount > 0 &&
          !dimensionMismatch &&
          (bm25Status.hasIndex || bm25Status.documentCount > 0),
        vectorSearchFunctional: fileCount > 0 && !dimensionMismatch,
        chunkSearchFunctional: chunkCount > 0 && !dimensionMismatch,
        bm25SearchFunctional: bm25Status.hasIndex && bm25Status.documentCount > 0
      };

      // Log comprehensive diagnostic output to both logger and terminal
      this._logDiagnosticsToTerminal(diagnostics);

      return diagnostics;
    } catch (error) {
      logger.error('[SearchService] Diagnosis failed:', error);
      return {
        ...diagnostics,
        error: error.message,
        issues: [
          ...diagnostics.issues,
          {
            type: 'DIAGNOSIS_ERROR',
            severity: 'critical',
            message: `Diagnostic check failed: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Auto-run diagnostics when issues are detected (debounced to avoid spam)
   * @param {string} trigger - What triggered the auto-diagnostic
   * @private
   */
  _autoRunDiagnostics(trigger) {
    // Debounce: only run once per 5 minutes to avoid spamming terminal
    const now = Date.now();
    const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

    if (this._lastAutoDiagnostic && now - this._lastAutoDiagnostic < DEBOUNCE_MS) {
      logger.debug('[SearchService] Skipping auto-diagnostics (debounced)', {
        trigger,
        lastRun: new Date(this._lastAutoDiagnostic).toISOString()
      });
      return;
    }

    this._lastAutoDiagnostic = now;

    // Run diagnostics asynchronously to not block search response
    logger.terminal('warn', '[SearchService] Auto-running diagnostics due to: ' + trigger);

    // Run in next tick to not block
    setImmediate(async () => {
      try {
        await this.diagnoseSearchIssues('auto-diagnostic');
      } catch (err) {
        logger.error('[SearchService] Auto-diagnostics failed:', err.message);
      }
    });
  }

  /**
   * Log diagnostics to both logger and terminal (stdout) for visibility
   * @param {Object} diagnostics - The diagnostic report object
   * @private
   */
  _logDiagnosticsToTerminal(diagnostics) {
    const divider = '='.repeat(70);
    const subDivider = '-'.repeat(70);

    // Build formatted output
    const lines = [
      '',
      divider,
      '  SEMANTIC SEARCH DIAGNOSTICS',
      `  Timestamp: ${diagnostics.timestamp}`,
      divider,
      ''
    ];

    // Summary section
    lines.push('SUMMARY:');
    lines.push(subDivider);
    if (diagnostics.summary) {
      lines.push(`  Critical Issues: ${diagnostics.summary.criticalIssues}`);
      lines.push(`  High Issues:     ${diagnostics.summary.highIssues}`);
      lines.push(`  Warnings:        ${diagnostics.summary.warnings}`);
      lines.push('');
      lines.push(
        `  Search Functional:        ${diagnostics.summary.searchFunctional ? 'YES' : 'NO'}`
      );
      lines.push(
        `  Vector Search Functional: ${diagnostics.summary.vectorSearchFunctional ? 'YES' : 'NO'}`
      );
      lines.push(
        `  Chunk Search Functional:  ${diagnostics.summary.chunkSearchFunctional ? 'YES' : 'NO'}`
      );
      lines.push(
        `  BM25 Search Functional:   ${diagnostics.summary.bm25SearchFunctional ? 'YES' : 'NO'}`
      );
    }
    lines.push('');

    // Details section
    lines.push('COLLECTION STATUS:');
    lines.push(subDivider);
    if (diagnostics.details?.collections) {
      lines.push(`  File Embeddings:  ${diagnostics.details.collections.fileCount}`);
      lines.push(`  Chunk Embeddings: ${diagnostics.details.collections.chunkCount}`);
      lines.push(`  Folder Embeddings: ${diagnostics.details.collections.folderCount}`);
    }
    if (diagnostics.details?.historyCount !== undefined) {
      lines.push(`  Analysis History: ${diagnostics.details.historyCount}`);
    }
    lines.push('');

    // Dimension info
    lines.push('EMBEDDING DIMENSIONS:');
    lines.push(subDivider);
    if (diagnostics.details?.storedDimension) {
      lines.push(`  Stored (in DB):   ${diagnostics.details.storedDimension}`);
    }
    if (diagnostics.details?.queryDimension) {
      lines.push(`  Current Model:    ${diagnostics.details.queryDimension}`);
    }
    if (diagnostics.details?.embeddingModel) {
      lines.push(`  Model Name:       ${diagnostics.details.embeddingModel}`);
    }
    if (diagnostics.details?.chunkDimension) {
      lines.push(`  Chunk Dimension:  ${diagnostics.details.chunkDimension}`);
    }
    lines.push('');

    // BM25 status
    lines.push('BM25 INDEX STATUS:');
    lines.push(subDivider);
    if (diagnostics.details?.bm25) {
      lines.push(`  Has Index:      ${diagnostics.details.bm25.hasIndex ? 'YES' : 'NO'}`);
      lines.push(`  Document Count: ${diagnostics.details.bm25.documentCount}`);
      lines.push(`  Is Stale:       ${diagnostics.details.bm25.isStale ? 'YES' : 'NO'}`);
    }
    lines.push('');

    // Ollama status
    if (diagnostics.details?.ollama) {
      lines.push('OLLAMA STATUS:');
      lines.push(subDivider);
      lines.push(`  Available:          ${diagnostics.details.ollama.available ? 'YES' : 'NO'}`);
      lines.push(`  Healthy:            ${diagnostics.details.ollama.isHealthy ? 'YES' : 'NO'}`);
      if (diagnostics.details.ollama.latencyMs) {
        lines.push(`  Latency:            ${diagnostics.details.ollama.latencyMs}ms`);
      }
      lines.push(`  Consecutive Fails:  ${diagnostics.details.ollama.consecutiveFailures || 0}`);
      if (diagnostics.details.ollama.offlineQueueSize > 0) {
        lines.push(`  Offline Queue:      ${diagnostics.details.ollama.offlineQueueSize}`);
      }
      lines.push('');
    }

    // Circuit breaker status
    if (diagnostics.details?.circuitBreaker) {
      lines.push('CIRCUIT BREAKER:');
      lines.push(subDivider);
      lines.push(`  State:    ${diagnostics.details.circuitBreaker.state || 'CLOSED'}`);
      lines.push(`  Failures: ${diagnostics.details.circuitBreaker.failures || 0}`);
      lines.push('');
    }

    // Embedding queue status
    if (diagnostics.details?.embeddingQueue) {
      lines.push('EMBEDDING QUEUE:');
      lines.push(subDivider);
      lines.push(`  Pending:      ${diagnostics.details.embeddingQueue.queueLength || 0}`);
      lines.push(
        `  Capacity:     ${diagnostics.details.embeddingQueue.capacityPercent?.toFixed(1) || 0}%`
      );
      lines.push(`  Failed:       ${diagnostics.details.embeddingQueue.failedItemCount || 0}`);
      lines.push(`  Dead Letter:  ${diagnostics.details.embeddingQueue.deadLetterCount || 0}`);
      lines.push(`  Health:       ${diagnostics.details.embeddingQueue.healthStatus || 'unknown'}`);
      lines.push('');
    }

    // Query cache stats
    if (diagnostics.details?.queryCache) {
      lines.push('QUERY CACHE:');
      lines.push(subDivider);
      lines.push(`  Size:      ${diagnostics.details.queryCache.size || 0}`);
      lines.push(
        `  Hit Rate:  ${((diagnostics.details.queryCache.hitRate || 0) * 100).toFixed(1)}%`
      );
      lines.push('');
    }

    // Orphaned embeddings
    if (diagnostics.details?.orphaned) {
      lines.push('ORPHANED EMBEDDINGS:');
      lines.push(subDivider);
      lines.push(`  Files:  ${diagnostics.details.orphaned.files || 0}`);
      lines.push(`  Chunks: ${diagnostics.details.orphaned.chunks || 0}`);
      lines.push('');
    }

    // Issues section
    if (diagnostics.issues && diagnostics.issues.length > 0) {
      lines.push('ISSUES DETECTED:');
      lines.push(subDivider);
      diagnostics.issues.forEach((issue, idx) => {
        const severityIcon =
          issue.severity === 'critical'
            ? '[CRITICAL]'
            : issue.severity === 'high'
              ? '[HIGH]'
              : '[MEDIUM]';
        lines.push(`  ${idx + 1}. ${severityIcon} ${issue.type}`);
        lines.push(`     ${issue.message}`);
        lines.push('');
      });
    }

    // Warnings section
    if (diagnostics.warnings && diagnostics.warnings.length > 0) {
      lines.push('WARNINGS:');
      lines.push(subDivider);
      diagnostics.warnings.forEach((warning, idx) => {
        lines.push(`  ${idx + 1}. [${warning.severity.toUpperCase()}] ${warning.type}`);
        lines.push(`     ${warning.message}`);
        lines.push('');
      });
    }

    // Recommendations section
    if (diagnostics.recommendations && diagnostics.recommendations.length > 0) {
      lines.push('RECOMMENDATIONS:');
      lines.push(subDivider);
      diagnostics.recommendations.forEach((rec, idx) => {
        lines.push(`  ${idx + 1}. ${rec}`);
      });
      lines.push('');
    }

    lines.push(divider);
    lines.push('');

    // Join all lines
    const output = lines.join('\n');

    // Write to terminal AND log file using logger.terminalRaw
    logger.terminalRaw(output);

    // Also log structured data to logger for searchability
    if (diagnostics.summary?.criticalIssues > 0) {
      logger.terminal('error', '[SearchService] CRITICAL search issues detected', {
        summary: diagnostics.summary,
        issues: diagnostics.issues
      });
    } else if (diagnostics.summary?.highIssues > 0) {
      logger.terminal('warn', '[SearchService] Search issues detected', {
        summary: diagnostics.summary,
        issues: diagnostics.issues,
        warnings: diagnostics.warnings
      });
    } else if (diagnostics.warnings?.length > 0) {
      logger.terminal('info', '[SearchService] Search diagnostics completed with warnings', {
        summary: diagnostics.summary,
        warnings: diagnostics.warnings
      });
    } else {
      logger.terminal('info', '[SearchService] Search diagnostics completed - no issues found', {
        summary: diagnostics.summary
      });
    }
  }

  /**
   * Cleanup resources on shutdown
   * Clears all cached data and pending operations
   */
  cleanup() {
    logger.info('[SearchService] Cleaning up...');

    // Clear index and cache
    this.bm25Index = null;
    this.documentMap.clear();
    this._serializedIndex = null;
    this._serializedDocMap = null;
    this.indexBuiltAt = null;
    this._indexBuildPromise = null;

    logger.info('[SearchService] Cleanup complete');
  }

  /**
   * Alias for cleanup (for consistency with other services)
   */
  shutdown() {
    this.cleanup();
  }
}

module.exports = { SearchService };
