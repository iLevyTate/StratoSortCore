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

    // Cache for query-result scores to avoid redundant LLM calls
    // Key: `${query}::${fileId}`, Value: { score, timestamp }
    this.scoreCache = new Map();

    // Statistics
    this.stats = {
      totalRerankCalls: 0,
      totalFilesScored: 0,
      cacheHits: 0,
      llmErrors: 0,
      avgLatencyMs: 0
    };

    logger.info('[ReRankerService] Initialized', {
      topN: this.config.topN,
      model: this.textModel || 'default'
    });
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

    try {
      const llmScore = await this._scoreRelevance(query, candidate);
      this.stats.totalFilesScored++;

      // Cache the score
      this._setCachedScore(cacheKey, llmScore);

      return { ...candidate, llmScore };
    } catch (error) {
      this.stats.llmErrors++;
      logger.debug('[ReRankerService] Scoring failed for:', fileId, error.message);
      return { ...candidate, llmScore: this.config.fallbackScore, error: error.message };
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
   *
   * @param {string} key - Cache key
   * @returns {number|null} Cached score or null
   */
  _getCachedScore(key) {
    const cached = this.scoreCache.get(key);
    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.timestamp > this.config.cacheTTLMs) {
      this.scoreCache.delete(key);
      return null;
    }

    return cached.score;
  }

  /**
   * Set cached score
   *
   * @param {string} key - Cache key
   * @param {number} score - Score to cache
   */
  _setCachedScore(key, score) {
    // Enforce cache size limit
    if (this.scoreCache.size >= this.config.cacheMaxSize) {
      // Remove oldest entry
      const firstKey = this.scoreCache.keys().next().value;
      this.scoreCache.delete(firstKey);
    }

    this.scoreCache.set(key, {
      score,
      timestamp: Date.now()
    });
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
    return {
      ...this.stats,
      cacheSize: this.scoreCache.size
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
   */
  cleanup() {
    this.scoreCache.clear();
    this.ollamaService = null;
    logger.info('[ReRankerService] Cleanup complete');
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton ReRankerService instance
 *
 * @param {Object} options - Options for initialization
 * @returns {ReRankerService}
 */
function getInstance(options = {}) {
  if (!instance) {
    instance = new ReRankerService(options);
  } else if (options.ollamaService && !instance.ollamaService) {
    // Update ollamaService if provided and not set
    instance.ollamaService = options.ollamaService;
  }
  return instance;
}

/**
 * Reset singleton (for testing)
 */
function resetInstance() {
  if (instance) {
    instance.cleanup();
    instance = null;
  }
}

module.exports = {
  ReRankerService,
  getInstance,
  resetInstance
};
