/**
 * ReRankerService - LLM-Based Re-Ranking for Semantic Search
 *
 * Uses the Ollama text model to re-rank top search results based on
 * true semantic relevance to the query. This ensures conceptually
 * relevant files rank above keyword-only matches.
 *
 * @module services/ReRankerService
 */

const { logger } = require('../../shared/logger');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { LRUCache } = require('../../shared/LRUCache');
const { getInstance: getCacheInvalidationBus } = require('../../shared/cacheInvalidation');

logger.setContext('ReRankerService');

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  topN: 10, // Number of candidates to re-rank
  timeout: 30000, // Timeout per LLM call (ms)
  cacheMaxSize: 100, // Max cached query-result pairs
  cacheTTLMs: 300000, // Cache TTL (5 minutes)
  fallbackScore: 0.5, // Score to use on LLM error
  batchConcurrency: 5 // Max parallel LLM calls
};

/**
 * Prompt template for relevance scoring
 */
const RELEVANCE_PROMPT = `You are evaluating if a file is relevant to a search query.

Search query: "{query}"

File information:
- Name: {name}
- Category: {category}
- Tags: {tags}
- Summary: {summary}

Rate how relevant this file is to the search query on a scale of 0-10, where:
- 0 = Completely irrelevant
- 5 = Somewhat related
- 10 = Perfect match

Consider semantic meaning, not just keyword matches. A file about "beach vacation" should score high for "holiday photos" even without exact keyword matches.

Respond with ONLY a single number from 0 to 10, nothing else.`;

/**
 * ReRankerService uses LLM to re-rank search results by semantic relevance
 */
class ReRankerService {
  /**
   * Create a new ReRankerService
   *
   * @param {Object} options - Configuration options
   * @param {Object} options.ollamaService - OllamaService instance for LLM calls
   * @param {string} options.textModel - Model to use (default: configured text model)
   * @param {number} options.topN - Number of candidates to re-rank
   */
  constructor(options = {}) {
    this.ollamaService = options.ollamaService;
    this.textModel = options.textModel || null; // Will use OllamaService default
    this.config = { ...DEFAULT_CONFIG, ...options };

    // FIX: Use LRUCache with periodic cleanup instead of plain Map
    // This prevents stale entries from accumulating between queries
    this.scoreCache = new LRUCache({
      maxSize: this.config.cacheMaxSize,
      ttlMs: this.config.cacheTTLMs,
      name: 'ReRankerScoreCache',
      trackMetrics: true
    });
    // Initialize with 1-minute cleanup interval for expired entries
    this.scoreCache.initialize(60000);

    // FIX MED #13: In-flight request tracking to prevent duplicate LLM calls
    // When concurrent requests have the same cache key, they share the same promise
    this._inFlightRequests = new Map();

    // Statistics
    this.stats = {
      totalRerankCalls: 0,
      totalFilesScored: 0,
      cacheHits: 0,
      llmErrors: 0,
      avgLatencyMs: 0
    };

    // Cache invalidation bus subscription
    this._unsubscribe = null;
    this._subscribeToInvalidationBus();

    logger.info('[ReRankerService] Initialized', {
      topN: this.config.topN,
      model: this.textModel || 'default'
    });
  }

  /**
   * Subscribe to the cache invalidation bus for coordinated cache clearing
   * @private
   */
  _subscribeToInvalidationBus() {
    try {
      const bus = getCacheInvalidationBus();
      this._unsubscribe = bus.subscribe('ReRankerService', {
        onInvalidate: (event) => {
          if (event.type === 'full-invalidate') {
            this.clearCache();
          }
        },
        onPathChange: (oldPath) => {
          // Invalidate scores for files that were moved/renamed
          this._invalidateForPath(oldPath);
        },
        onDeletion: (filePath) => {
          this._invalidateForPath(filePath);
        },
        onBatch: (changes) => {
          // For batch operations, invalidate all affected paths
          for (const change of changes) {
            this._invalidateForPath(change.oldPath);
          }
        }
      });
      logger.debug('[ReRankerService] Subscribed to cache invalidation bus');
    } catch (error) {
      logger.warn(
        '[ReRankerService] Failed to subscribe to cache invalidation bus:',
        error.message
      );
    }
  }

  /**
   * Invalidate cache entries for a specific file path
   * @param {string} filePath - Path to invalidate
   * @private
   */
  _invalidateForPath(filePath) {
    if (!filePath) return;

    // Score cache keys are in format: "query::fileId"
    // We need to invalidate any entry where the fileId contains the path
    let invalidated = 0;
    for (const key of this.scoreCache.keys()) {
      if (key.includes(filePath)) {
        this.scoreCache.delete(key);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      logger.debug(`[ReRankerService] Invalidated ${invalidated} scores for path change`);
    }
  }

  /**
   * Re-rank search results using LLM scoring
   *
   * @param {string} query - Search query
   * @param {Array} candidates - Array of search result candidates
   * @param {Object} options - Re-ranking options
   * @param {number} options.topN - Number of candidates to re-rank (default: 10)
   * @returns {Promise<Array>} Re-ranked results with llmScore added
   */
  async rerank(query, candidates, options = {}) {
    const topN = options.topN || this.config.topN;
    const startTime = Date.now();

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return candidates;
    }

    if (!this.ollamaService) {
      logger.warn('[ReRankerService] No OllamaService available, returning original order');
      return candidates;
    }

    this.stats.totalRerankCalls++;

    // Split into candidates to re-rank and remainder
    const toRerank = candidates.slice(0, topN);
    const rest = candidates.slice(topN);

    logger.debug('[ReRankerService] Re-ranking candidates', {
      query,
      toRerankCount: toRerank.length,
      restCount: rest.length
    });

    try {
      // Score each candidate with LLM (with concurrency limit)
      const scored = await this._scoreWithConcurrencyLimit(
        query,
        toRerank,
        this.config.batchConcurrency
      );

      // Sort by LLM score (descending)
      scored.sort((a, b) => (b.llmScore || 0) - (a.llmScore || 0));

      // Log re-ranking results
      const topMovers = scored.slice(0, 3).map((r) => ({
        name: r.metadata?.name || r.id,
        originalScore: r.score?.toFixed(3),
        llmScore: r.llmScore?.toFixed(2)
      }));

      logger.debug('[ReRankerService] Re-ranking complete', {
        topMovers,
        latencyMs: Date.now() - startTime
      });

      // Update average latency
      this._updateLatencyStats(Date.now() - startTime);

      // Return re-ranked results with remainder appended
      return [...scored, ...rest];
    } catch (error) {
      logger.error('[ReRankerService] Re-ranking failed:', error.message);
      // Return original order on failure
      return candidates;
    }
  }

  /**
   * Score candidates with concurrency limit
   *
   * @param {string} query - Search query
   * @param {Array} candidates - Candidates to score
   * @param {number} concurrency - Max concurrent LLM calls
   * @returns {Promise<Array>} Scored candidates
   */
  async _scoreWithConcurrencyLimit(query, candidates, concurrency) {
    const results = [];
    const queue = [...candidates];

    // Process in batches
    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);
      const batchResults = await Promise.all(
        batch.map((candidate) => this._scoreSingleCandidate(query, candidate))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Score a single candidate
   *
   * @param {string} query - Search query
   * @param {Object} candidate - Search result candidate
   * @returns {Promise<Object>} Candidate with llmScore added
   */
  async _scoreSingleCandidate(query, candidate) {
    const fileId = candidate.id || '';
    const cacheKey = `${query}::${fileId}`;

    // Check cache
    const cached = this._getCachedScore(cacheKey);
    if (cached !== null) {
      this.stats.cacheHits++;
      return { ...candidate, llmScore: cached, fromCache: true };
    }

    // FIX MED #13: Check for in-flight request with same key to prevent duplicate LLM calls
    // If another request is already fetching this score, wait for it instead of making duplicate call
    if (this._inFlightRequests.has(cacheKey)) {
      try {
        const llmScore = await this._inFlightRequests.get(cacheKey);
        return { ...candidate, llmScore, fromInFlight: true };
      } catch (error) {
        // In-flight request failed, return fallback
        return { ...candidate, llmScore: this.config.fallbackScore, error: error.message };
      }
    }

    // Create promise for this request and track it
    const scorePromise = this._scoreRelevance(query, candidate);
    this._inFlightRequests.set(cacheKey, scorePromise);

    try {
      const llmScore = await scorePromise;
      this.stats.totalFilesScored++;

      // Cache the score
      this._setCachedScore(cacheKey, llmScore);

      return { ...candidate, llmScore };
    } catch (error) {
      this.stats.llmErrors++;
      logger.debug('[ReRankerService] Scoring failed for:', fileId, error.message);
      return { ...candidate, llmScore: this.config.fallbackScore, error: error.message };
    } finally {
      // FIX MED #13: Always remove from in-flight tracking when done
      this._inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Score relevance using LLM
   *
   * @param {string} query - Search query
   * @param {Object} result - Search result with metadata
   * @returns {Promise<number>} Relevance score 0-1
   */
  async _scoreRelevance(query, result) {
    const metadata = result.metadata || {};
    const name = metadata.name || metadata.path?.split(/[\\/]/).pop() || 'Unknown';
    const category = metadata.category || 'Uncategorized';
    const summary = metadata.summary || metadata.subject || '';

    // Parse tags - may be JSON string or array
    let tags = [];
    if (Array.isArray(metadata.tags)) {
      tags = metadata.tags;
    } else if (typeof metadata.tags === 'string') {
      try {
        tags = JSON.parse(metadata.tags);
      } catch {
        tags = metadata.tags.split(',').map((t) => t.trim());
      }
    }
    const tagsStr = Array.isArray(tags) ? tags.join(', ') : 'None';

    // Build prompt
    const prompt = RELEVANCE_PROMPT.replace('{query}', query)
      .replace('{name}', name)
      .replace('{category}', category)
      .replace('{tags}', tagsStr)
      .replace('{summary}', summary.slice(0, 200));

    // Call LLM with timeout
    const response = await this._callLLMWithTimeout(prompt);

    // Parse response - expect a single number 0-10
    const score = this._parseScoreResponse(response);

    return score;
  }

  /**
   * Call LLM with timeout protection
   *
   * @param {string} prompt - Prompt to send
   * @returns {Promise<string>} LLM response
   */
  async _callLLMWithTimeout(prompt) {
    const timeout = this.config.timeout || TIMEOUTS.AI_ANALYSIS_SHORT;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('LLM request timeout')), timeout);
    });

    try {
      const responsePromise = this.ollamaService.generate({
        prompt,
        model: this.textModel,
        options: {
          temperature: 0.1, // Low temperature for consistent scoring
          num_predict: 10 // Short response expected
        }
      });

      const response = await Promise.race([responsePromise, timeoutPromise]);
      return response?.response || response?.text || '';
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Parse LLM response to extract score
   *
   * @param {string} response - LLM response text
   * @returns {number} Score normalized to 0-1
   */
  _parseScoreResponse(response) {
    if (!response) return this.config.fallbackScore;

    // Extract first number from response
    const match = response.match(/\b(\d+(?:\.\d+)?)\b/);
    if (!match) return this.config.fallbackScore;

    const rawScore = parseFloat(match[1]);

    // Validate and normalize to 0-1 range
    if (isNaN(rawScore)) return this.config.fallbackScore;

    // Clamp to 0-10 range and normalize
    const clamped = Math.max(0, Math.min(10, rawScore));
    return clamped / 10;
  }

  /**
   * Get cached score if valid
   * FIX: Updated to use LRUCache API (TTL check handled by cache)
   *
   * @param {string} key - Cache key
   * @returns {number|null} Cached score or null
   */
  _getCachedScore(key) {
    return this.scoreCache.get(key);
  }

  /**
   * Set cached score
   * FIX: Updated to use LRUCache API (size enforcement handled by cache)
   *
   * @param {string} key - Cache key
   * @param {number} score - Score to cache
   */
  _setCachedScore(key, score) {
    this.scoreCache.set(key, score);
  }

  /**
   * Update latency statistics
   *
   * @param {number} latencyMs - Latest latency measurement
   */
  _updateLatencyStats(latencyMs) {
    const { totalRerankCalls, avgLatencyMs } = this.stats;
    // Rolling average
    this.stats.avgLatencyMs = Math.round(
      (avgLatencyMs * (totalRerankCalls - 1) + latencyMs) / totalRerankCalls
    );
  }

  /**
   * Get service statistics
   *
   * @returns {Object} Statistics
   */
  getStats() {
    const cacheStats = this.scoreCache.getStats();
    return {
      ...this.stats,
      cacheSize: cacheStats.size,
      cacheHitRate: cacheStats.hitRate
    };
  }

  /**
   * Clear score cache
   */
  clearCache() {
    this.scoreCache.clear();
    logger.debug('[ReRankerService] Cache cleared');
  }

  /**
   * Check if service is available
   *
   * @returns {boolean} True if service can re-rank
   */
  isAvailable() {
    return !!this.ollamaService;
  }

  /**
   * Cleanup resources
   * FIX: Use LRUCache shutdown to clean up intervals
   */
  async cleanup() {
    // Unsubscribe from cache invalidation bus
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    await this.scoreCache.shutdown();
    this.ollamaService = null;
    logger.info('[ReRankerService] Cleanup complete');
  }
}

// Use singleton factory to prevent race conditions in getInstance()
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const {
  getInstance: _getInstance,
  resetInstance,
  registerWithContainer
} = createSingletonHelpers({
  ServiceClass: ReRankerService,
  serviceId: 'RERANKER',
  serviceName: 'ReRankerService',
  containerPath: './ServiceContainer',
  shutdownMethod: 'cleanup'
});

/**
 * Get singleton ReRankerService instance
 * FIX: Wrapped to handle ollamaService injection safely after initialization
 * @param {Object} options - Options for initialization
 * @returns {ReRankerService}
 */
function getInstance(options = {}) {
  const instance = _getInstance(options);
  // FIX: Handle ollamaService injection after singleton is created
  // This is safe because we're setting a property, not creating a new instance
  if (options.ollamaService && instance && !instance.ollamaService) {
    instance.ollamaService = options.ollamaService;
  }
  return instance;
}

module.exports = {
  ReRankerService,
  getInstance,
  resetInstance,
  registerWithContainer
};
