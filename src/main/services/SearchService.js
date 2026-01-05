/**
 * SearchService - Hybrid Search with BM25 + Vector Similarity
 *
 * Combines keyword-based BM25 search with semantic vector search
 * using Reciprocal Rank Fusion for optimal result quality.
 *
 * @module services/SearchService
 */

const lunr = require('lunr');
const { logger } = require('../../shared/logger');
const { THRESHOLDS, TIMEOUTS, SEARCH } = require('../../shared/performanceConstants');

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
  minScore: MIN_RESULT_SCORE // Minimum score threshold
};

class SearchService {
  /**
   * Create a new SearchService instance
   *
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.chromaDbService - ChromaDB service for vector search
   * @param {Object} dependencies.analysisHistoryService - Analysis history for document data
   * @param {Object} dependencies.parallelEmbeddingService - Embedding service for query vectors
   */
  constructor({ chromaDbService, analysisHistoryService, parallelEmbeddingService } = {}) {
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
      const documents = Object.values(entries);

      if (documents.length === 0) {
        logger.warn('[SearchService] No documents to index');
        this.bm25Index = null;
        this.documentMap.clear();
        return { success: true, indexed: 0 };
      }

      // Clear existing document map
      this.documentMap.clear();

      // Build lunr index
      const self = this;
      this.bm25Index = lunr(function () {
        // Configure fields with boosting
        this.ref('id');
        this.field('fileName', { boost: 3 });
        this.field('subject', { boost: 2 });
        this.field('summary', { boost: 1.5 });
        this.field('tags', { boost: 2 });
        this.field('category', { boost: 1.5 });
        this.field('extractedText', { boost: 1 });

        // Add documents
        for (const doc of documents) {
          const analysis = doc.analysis || {};
          const indexDoc = {
            id: doc.id,
            fileName: doc.fileName || '',
            subject: analysis.subject || '',
            summary: analysis.summary || '',
            tags: (analysis.tags || []).join(' '),
            category: analysis.category || '',
            extractedText: self._truncateText(analysis.extractedText, 5000)
          };

          this.add(indexDoc);

          // Store document metadata for result enrichment
          self.documentMap.set(doc.id, {
            id: doc.id,
            path: doc.originalPath,
            name: doc.fileName,
            type: doc.mimeType || 'document',
            subject: analysis.subject,
            summary: analysis.summary,
            tags: analysis.tags || [],
            category: analysis.category
          });
        }
      });

      this.indexBuiltAt = Date.now();
      this.indexVersion++;

      // Cache serialized index for faster subsequent loads (with size limit)
      // Lunr indexes support JSON serialization
      try {
        const serializedIndex = JSON.stringify(this.bm25Index);
        const serializedDocMap = JSON.stringify(Array.from(this.documentMap.entries()));
        const totalSize = serializedIndex.length + serializedDocMap.length;

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

      logger.info(`[SearchService] BM25 index built with ${documents.length} documents`);
      return { success: true, indexed: documents.length };
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
      const results = this.bm25Index.search(safeQuery);

      return results.slice(0, topK).map((result) => {
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
            subject: meta.subject || ''
          },
          source: 'bm25',
          matchDetails: {
            matchedTerms: matchedTerms.slice(0, 5), // Limit to top 5 terms
            matchedFields: Array.from(matchedFields)
          }
        };
      });
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

      // Query ChromaDB
      const chromaResults = await this.chromaDb.querySimilarFiles(embedResult.vector, topK);

      if (!chromaResults || !Array.isArray(chromaResults)) {
        return [];
      }

      // Extract query words for tag/category matching
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      return chromaResults.map((result) => {
        const semanticScore = result.score || 1 - (result.distance || 0);
        const metadata = result.metadata || {};

        // Find query terms that appear in tags
        const tags = Array.isArray(metadata.tags) ? metadata.tags : [];
        const queryTermsInTags = tags.filter((tag) =>
          queryWords.some((word) => tag.toLowerCase().includes(word))
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
      score: (r.score - minScore) / range,
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
    return results.filter((r) => (r.score || 0) >= minScore);
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
      minScore = DEFAULT_OPTIONS.minScore
    } = options;

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return { success: false, results: [], error: 'Query too short' };
    }

    try {
      // Ensure BM25 index is up to date
      if (this.isIndexStale()) {
        await this.buildBM25Index();
      }

      // Handle different search modes
      if (mode === 'bm25') {
        const results = this.bm25Search(query, topK);
        const filtered = this._filterByScore(results, minScore);
        return { success: true, results: filtered, mode: 'bm25' };
      }

      if (mode === 'vector') {
        const results = await this.vectorSearch(query, topK);
        const filtered = this._filterByScore(results, minScore);
        return { success: true, results: filtered, mode: 'vector' };
      }

      // Hybrid mode: combine both search types with timeout protection
      const bm25Results = this.bm25Search(query, topK * 2);
      const { results: vectorResults, timedOut } = await this._vectorSearchWithTimeout(
        query,
        topK * 2
      );

      // If vector search timed out, use BM25-only with degraded mode indicator
      if (timedOut) {
        logger.warn('[SearchService] Vector search timed out, using BM25-only fallback');
        const filtered = this._filterByScore(bm25Results.slice(0, topK), minScore);
        return {
          success: true,
          results: filtered,
          mode: 'bm25-fallback',
          meta: {
            vectorTimedOut: true,
            bm25Count: bm25Results.length
          }
        };
      }

      // Log search results for debugging
      logger.debug('[SearchService] Hybrid search results:', {
        vectorCount: vectorResults.length,
        bm25Count: bm25Results.length
      });

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

      // Weighted hybrid fusion (simple weighted sum of normalized scores)
      const alpha = SEARCH.VECTOR_WEIGHT;
      const beta = SEARCH.BM25_WEIGHT;
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
          source === 'vector'
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
              : existing.vectorRawScore
        });
      };

      normalizedBm25.forEach((r) => upsert(r, 'bm25'));
      normalizedVector.forEach((r) => upsert(r, 'vector'));

      const fusedResults = Array.from(combined.values())
        .map((item) => {
          const semantic = item.vectorScore ?? 0;
          const keyword = item.bm25Score ?? 0;
          const combinedScore = alpha * semantic + beta * keyword;

          return {
            id: item.id,
            score: combinedScore,
            metadata: item.metadata || {},
            sources: item.matchDetails?.sources || ['hybrid'],
            matchDetails: {
              ...item.matchDetails,
              hybrid: {
                semanticScore: semantic,
                keywordScore: keyword,
                combinedScore,
                semanticWeight: alpha,
                keywordWeight: beta,
                bm25RawScore: item.bm25RawScore,
                vectorRawScore: item.vectorRawScore
              }
            }
          };
        })
        .sort((a, b) => (b.score || 0) - (a.score || 0));

      // Apply minimum score filter to fused results
      const filteredResults = this._filterByScore(fusedResults.slice(0, topK), minScore);

      return {
        success: true,
        results: filteredResults,
        mode: 'hybrid',
        meta: {
          vectorCount: vectorResults.length,
          bm25Count: bm25Results.length,
          fusedCount: fusedResults.length,
          filteredCount: filteredResults.length,
          minScoreApplied: minScore,
          weights: { vector: alpha, bm25: beta }
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
            meta: { hybridError: error.message }
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
