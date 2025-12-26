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

logger.setContext('SearchService');

/**
 * Reciprocal Rank Fusion constant
 * Higher values give more weight to top results
 */
const RRF_K = 60;

/**
 * Default search options
 */
const DEFAULT_OPTIONS = {
  topK: 20,
  mode: 'hybrid', // 'vector', 'bm25', 'hybrid'
  vectorWeight: 0.6,
  bm25Weight: 0.4
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
  constructor({ chromaDbService, analysisHistoryService, parallelEmbeddingService }) {
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
   *
   * @returns {Promise<{success: boolean, indexed: number, error?: string}>}
   */
  async buildBM25Index() {
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

      // Cache serialized index for faster subsequent loads
      // Lunr indexes support JSON serialization
      try {
        this._serializedIndex = JSON.stringify(this.bm25Index);
        this._serializedDocMap = JSON.stringify(Array.from(this.documentMap.entries()));
        logger.debug('[SearchService] Index serialized for caching');
      } catch (serializeErr) {
        logger.warn('[SearchService] Failed to serialize index:', serializeErr.message);
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
        return {
          id: result.ref,
          score: result.score,
          metadata: {
            path: meta.path,
            name: meta.name,
            type: meta.type
          },
          source: 'bm25'
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

      return chromaResults.map((result) => ({
        id: result.id,
        score: result.score || 1 - (result.distance || 0),
        metadata: result.metadata || {},
        source: 'vector'
      }));
    } catch (error) {
      logger.error('[SearchService] Vector search failed:', error);
      return [];
    }
  }

  /**
   * Combine results using Reciprocal Rank Fusion
   *
   * RRF formula: score(d) = sum(1 / (k + rank_i(d)))
   *
   * @param {Array<Array>} resultSets - Arrays of ranked results
   * @param {number} k - RRF constant (default: 60)
   * @returns {Array} Fused and re-ranked results
   */
  reciprocalRankFusion(resultSets, k = RRF_K) {
    const rrfScores = new Map();
    const resultData = new Map();

    for (const results of resultSets) {
      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        const id = result.id;

        // RRF score contribution
        const rrfContribution = 1 / (k + rank + 1);
        rrfScores.set(id, (rrfScores.get(id) || 0) + rrfContribution);

        // Prefer vector search metadata (has current file names) over BM25 (may have old names)
        // Vector search uses ChromaDB which is updated when files are organized
        const existing = resultData.get(id);
        if (!existing || (result.source === 'vector' && existing.source !== 'vector')) {
          resultData.set(id, result);
        }
      }
    }

    // Sort by RRF score
    const fusedResults = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, rrfScore]) => {
        const original = resultData.get(id) || {};
        return {
          id,
          score: rrfScore,
          metadata: original.metadata || {},
          sources: original.source ? [original.source] : ['fused']
        };
      });

    return fusedResults;
  }

  /**
   * Perform hybrid search combining BM25 and vector search
   *
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<{success: boolean, results: Array, mode: string}>}
   */
  async hybridSearch(query, options = {}) {
    const { topK = DEFAULT_OPTIONS.topK, mode = DEFAULT_OPTIONS.mode } = options;

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
        return { success: true, results, mode: 'bm25' };
      }

      if (mode === 'vector') {
        const results = await this.vectorSearch(query, topK);
        return { success: true, results, mode: 'vector' };
      }

      // Hybrid mode: combine both search types
      const [vectorResults, bm25Results] = await Promise.all([
        this.vectorSearch(query, topK * 2),
        Promise.resolve(this.bm25Search(query, topK * 2))
      ]);

      // Log search results for debugging
      logger.debug('[SearchService] Hybrid search results:', {
        vectorCount: vectorResults.length,
        bm25Count: bm25Results.length
      });

      // Fuse results using RRF
      const fusedResults = this.reciprocalRankFusion([vectorResults, bm25Results]);

      return {
        success: true,
        results: fusedResults.slice(0, topK),
        mode: 'hybrid',
        meta: {
          vectorCount: vectorResults.length,
          bm25Count: bm25Results.length,
          fusedCount: fusedResults.length
        }
      };
    } catch (error) {
      logger.error('[SearchService] Hybrid search failed:', error);
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
}

module.exports = { SearchService };
