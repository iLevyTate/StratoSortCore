/**
 * ClusteringService - Semantic Clustering with K-means
 *
 * Computes clusters of semantically similar files using K-means clustering
 * on embedding vectors. Generates LLM-based labels for cluster interpretation.
 *
 * @module services/ClusteringService
 */

const { createLogger } = require('../../shared/logger');
const path = require('path');
const {
  cosineSimilarity,
  squaredEuclideanDistance,
  validateEmbeddingDimensions
} = require('../../shared/vectorMath');
const { getOllamaModel } = require('../ollamaUtils');
const { AI_DEFAULTS } = require('../../shared/constants');
const { FILE_TYPE_CATEGORIES } = require('./autoOrganize/fileTypeUtils');

const logger = createLogger('ClusteringService');
// -----------------------------------------------------------------------------
// Distinctive term extraction (for "topic" insights)
// -----------------------------------------------------------------------------
const STOPWORDS = new Set(
  [
    // Common English stopwords
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'for',
    'from',
    'has',
    'have',
    'he',
    'her',
    'hers',
    'him',
    'his',
    'i',
    'if',
    'in',
    'into',
    'is',
    'it',
    'its',
    'me',
    'my',
    'no',
    'not',
    'of',
    'on',
    'or',
    'our',
    'ours',
    'she',
    'so',
    'that',
    'the',
    'their',
    'theirs',
    'them',
    'then',
    'there',
    'these',
    'they',
    'this',
    'those',
    'to',
    'too',
    'up',
    'us',
    'was',
    'we',
    'were',
    'what',
    'when',
    'where',
    'which',
    'who',
    'why',
    'with',
    'you',
    'your',
    'yours',
    // Generic file/document words (cluster labels often regress to these)
    'file',
    'files',
    'document',
    'documents',
    'image',
    'images',
    'photo',
    'photos',
    'scan',
    'scans',
    'note',
    'notes',
    'report',
    'reports',
    'draft',
    'final',
    'copy',
    'version',
    'v',
    'tmp',
    'temp',
    'misc',
    'miscellaneous',
    'untitled',
    'unknown',
    // Time filler
    'today',
    'yesterday',
    'tomorrow'
  ].map((w) => String(w).toLowerCase())
);

const FILE_TYPE_STOPWORDS = (() => {
  try {
    const categories = Object.keys(FILE_TYPE_CATEGORIES || {}).map((k) => String(k).toLowerCase());
    const extensions = Object.values(FILE_TYPE_CATEGORIES || {})
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .map((ext) => String(ext).toLowerCase());
    return new Set([...categories, ...extensions]);
  } catch {
    return new Set();
  }
})();

/**
 * Default clustering options
 */
const DEFAULT_OPTIONS = {
  maxIterations: 50,
  minClusterSize: 2,
  maxClusters: 15,
  convergenceThreshold: 0.001
};

/**
 * Maximum number of clusters to compute for a user collection
 * Cap to prevent performance degradation on large datasets
 */
const MAX_USER_CLUSTERS = 100;

class ClusteringService {
  /**
   * Create a new ClusteringService instance
   *
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.chromaDbService - ChromaDB service for embeddings
   * @param {Object} dependencies.ollamaService - Ollama service for label generation
   */
  constructor({ chromaDbService, ollamaService }) {
    // Validate required dependency
    if (!chromaDbService) {
      throw new Error('ClusteringService requires chromaDbService dependency');
    }

    this.chromaDb = chromaDbService;
    this.ollama = ollamaService; // Optional - label generation will be skipped if null

    // Cached cluster data
    this.clusters = [];
    this.centroids = [];
    this.clusterLabels = new Map();
    this.lastComputedAt = null;

    // Staleness threshold (30 minutes)
    this.STALE_MS = 30 * 60 * 1000;

    // Lock to prevent concurrent cluster computation (race condition fix)
    this._computePromise = null;
  }

  /**
   * Invalidate cached clusters (called when files are moved/deleted)
   * Forces recomputation on next access
   */
  invalidateClusters() {
    logger.info('[ClusteringService] Invalidating cached clusters');
    this.lastComputedAt = null;
    // Don't clear clusters/centroids so UI can still show stale data while recomputing
  }

  /**
   * Check if clusters need recomputation
   *
   * @returns {boolean} True if clusters are stale or missing
   */
  isClustersStale() {
    if (this.clusters.length === 0 || !this.lastComputedAt) {
      return true;
    }
    return Date.now() - this.lastComputedAt > this.STALE_MS;
  }

  /**
   * Get all file embeddings from ChromaDB
   *
   * @returns {Promise<Array>} Array of {id, embedding, metadata}
   */
  async getAllFileEmbeddings() {
    try {
      await this.chromaDb.initialize();

      // Null check for fileCollection to prevent runtime crash
      const { fileCollection } = this.chromaDb;
      if (!fileCollection) {
        logger.warn('[ClusteringService] File collection not available');
        return [];
      }

      const MAX_CLUSTERING_EMBEDDINGS = 10000;
      const result = await fileCollection.get({
        include: ['embeddings', 'metadatas'],
        limit: MAX_CLUSTERING_EMBEDDINGS
      });

      if (result.ids && result.ids.length >= MAX_CLUSTERING_EMBEDDINGS) {
        logger.warn(
          `[ClusteringService] Clustering limited to ${MAX_CLUSTERING_EMBEDDINGS} embeddings. Some files may be excluded from cluster analysis.`
        );
      }

      const files = [];
      const ids = result.ids || [];
      const embeddings = result.embeddings || [];
      const metadatas = result.metadatas || [];

      // FIX: Track expected dimension to detect mismatches from mixed embedding models
      let expectedDim = null;
      let skippedCount = 0;

      for (let i = 0; i < ids.length; i++) {
        if (embeddings[i] && embeddings[i].length > 0) {
          // FIX: Validate dimension consistency
          if (expectedDim === null) {
            expectedDim = embeddings[i].length;
          } else if (!validateEmbeddingDimensions(embeddings[i], expectedDim)) {
            logger.warn('[ClusteringService] Skipping file with mismatched embedding dimension', {
              fileId: ids[i],
              expected: expectedDim,
              actual: embeddings[i].length
            });
            skippedCount++;
            continue;
          }

          files.push({
            id: ids[i],
            embedding: embeddings[i],
            metadata: metadatas[i] || {}
          });
        }
      }

      if (skippedCount > 0) {
        logger.warn('[ClusteringService] Skipped files due to dimension mismatch', {
          skipped: skippedCount,
          kept: files.length,
          expectedDim
        });
      }

      return files;
    } catch (error) {
      logger.error('[ClusteringService] Failed to get file embeddings:', error);
      return [];
    }
  }

  /**
   * Initialize centroids using K-means++ algorithm
   *
   * @param {Array} files - Files with embeddings
   * @param {number} k - Number of clusters
   * @returns {number[][]} Initial centroids
   */
  initCentroidsPlusPlus(files, k) {
    if (files.length === 0 || k <= 0) return [];

    const centroids = [];
    const used = new Set();

    // Pick first centroid randomly
    const firstIdx = Math.floor(Math.random() * files.length);
    centroids.push([...files[firstIdx].embedding]);
    used.add(firstIdx);

    // Pick remaining centroids using D^2 weighting
    while (centroids.length < k && centroids.length < files.length) {
      const distances = [];
      let totalDist = 0;

      for (let i = 0; i < files.length; i++) {
        if (used.has(i)) {
          distances.push(0);
          continue;
        }

        // Find minimum squared distance to any existing centroid
        // Using squared distance avoids sqrt() and we need D^2 anyway
        let minDistSq = Infinity;
        for (const centroid of centroids) {
          const distSq = squaredEuclideanDistance(files[i].embedding, centroid);
          if (distSq < minDistSq) minDistSq = distSq;
        }

        distances.push(minDistSq); // D^2 weighting (already squared)
        totalDist += minDistSq;
      }

      // Weighted random selection
      if (totalDist === 0) break;

      let threshold = Math.random() * totalDist;
      let selected = false;
      for (let i = 0; i < files.length; i++) {
        if (used.has(i)) continue;
        threshold -= distances[i];
        if (threshold <= 0) {
          centroids.push([...files[i].embedding]);
          used.add(i);
          selected = true;
          break;
        }
      }

      // Fallback: if weighted selection failed (floating point edge case),
      // select a random unused point to prevent infinite loop
      if (!selected) {
        const unusedIndices = [];
        for (let i = 0; i < files.length; i++) {
          if (!used.has(i)) unusedIndices.push(i);
        }
        if (unusedIndices.length > 0) {
          const randomIdx = unusedIndices[Math.floor(Math.random() * unusedIndices.length)];
          centroids.push([...files[randomIdx].embedding]);
          used.add(randomIdx);
          logger.debug('[ClusteringService] K-means++ used fallback selection');
        }
      }
    }

    return centroids;
  }

  /**
   * Find the nearest centroid for a point
   * Uses squared distance for efficiency (avoids sqrt)
   *
   * @param {number[]} point - Point embedding
   * @param {number[][]} centroids - Current centroids
   * @returns {number} Index of nearest centroid
   */
  nearestCentroid(point, centroids) {
    let minDistSq = Infinity;
    let minIdx = 0;

    for (let i = 0; i < centroids.length; i++) {
      // Use squared distance - avoids sqrt, same comparison result
      const distSq = squaredEuclideanDistance(point, centroids[i]);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        minIdx = i;
      }
    }

    return minIdx;
  }

  /**
   * Update centroids based on current assignments
   * Handles empty clusters by reinitializing them with the farthest point
   *
   * @param {Array} files - Files with embeddings
   * @param {number[]} assignments - Cluster assignments
   * @param {number[][]} centroids - Current centroids (modified in place)
   */
  updateCentroids(files, assignments, centroids) {
    const dim = centroids[0]?.length || 0;
    if (dim === 0) return;

    const sums = centroids.map(() => new Array(dim).fill(0));
    const counts = new Array(centroids.length).fill(0);

    for (let i = 0; i < files.length; i++) {
      const cluster = assignments[i];
      counts[cluster]++;
      for (let d = 0; d < dim; d++) {
        sums[cluster][d] += files[i].embedding[d];
      }
    }

    // FIX H-1: Track used points to prevent infinite loop in reinitialization
    const usedForReinit = new Set();

    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] > 0) {
        // Normal case: update centroid to mean of assigned points
        for (let d = 0; d < dim; d++) {
          centroids[c][d] = sums[c][d] / counts[c];
        }
      } else {
        // Empty cluster fix: reinitialize with the point farthest from its assigned centroid
        // This helps the algorithm recover from pathological cases
        let maxDist = -1;
        let farthestIdx = -1;

        for (let i = 0; i < files.length; i++) {
          // FIX H-1: Skip points already used for reinitialization to prevent cycles
          if (usedForReinit.has(i)) continue;

          const assignedCentroid = centroids[assignments[i]];
          const dist = squaredEuclideanDistance(files[i].embedding, assignedCentroid);
          if (dist > maxDist) {
            maxDist = dist;
            farthestIdx = i;
          }
        }

        if (farthestIdx >= 0) {
          usedForReinit.add(farthestIdx);
          for (let d = 0; d < dim; d++) {
            centroids[c][d] = files[farthestIdx].embedding[d];
          }
          logger.debug(`[ClusteringService] Reinitialized empty cluster ${c} with farthest point`);
        } else {
          // FIX H-1: All points exhausted, log warning and skip
          logger.warn(`[ClusteringService] Cannot reinitialize cluster ${c}, no available points`);
        }
      }
    }
  }

  /**
   * Check if two arrays are equal
   *
   * @param {number[]} a - First array
   * @param {number[]} b - Second array
   * @returns {boolean} True if equal
   */
  arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Run K-means clustering
   *
   * @param {Array} files - Files with embeddings
   * @param {number} k - Number of clusters
   * @param {Object} options - Clustering options
   * @returns {{assignments: number[], centroids: number[][]}}
   */
  kmeans(files, k, options = {}) {
    const { maxIterations = DEFAULT_OPTIONS.maxIterations } = options;

    if (files.length === 0 || k <= 0) {
      return { assignments: [], centroids: [] };
    }

    // Clamp k to valid range
    k = Math.min(k, files.length);

    // Initialize centroids with K-means++
    const centroids = this.initCentroidsPlusPlus(files, k);
    let assignments = new Array(files.length).fill(0);

    for (let iter = 0; iter < maxIterations; iter++) {
      // Assign points to nearest centroid
      const newAssignments = files.map((f) => this.nearestCentroid(f.embedding, centroids));

      // Check convergence
      if (this.arraysEqual(assignments, newAssignments)) {
        logger.debug('[ClusteringService] K-means converged at iteration', iter);
        break;
      }

      assignments = newAssignments;

      // Update centroids
      this.updateCentroids(files, assignments, centroids);
    }

    return { assignments, centroids };
  }

  /**
   * Determine optimal number of clusters using elbow method
   *
   * @param {Array} files - Files with embeddings
   * @returns {number} Optimal k value
   */
  estimateOptimalK(files) {
    const n = files.length;

    // Simple heuristic: sqrt(n/2) clamped to [2, maxClusters]
    const estimate = Math.ceil(Math.sqrt(n / 2));
    return Math.max(2, Math.min(DEFAULT_OPTIONS.maxClusters, estimate));
  }

  /**
   * Group files by cluster assignment
   *
   * @param {Array} files - Files with embeddings
   * @param {number[]} assignments - Cluster assignments
   * @returns {Array} Array of cluster objects
   */
  groupByCluster(files, assignments) {
    const clusterMap = new Map();

    for (let i = 0; i < files.length; i++) {
      const clusterId = assignments[i];
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, {
          id: clusterId,
          members: [],
          label: null
        });
      }
      clusterMap.get(clusterId).members.push(files[i]);
    }

    // Filter out small clusters and convert to array
    return Array.from(clusterMap.values()).filter(
      (c) => c.members.length >= DEFAULT_OPTIONS.minClusterSize
    );
  }

  /**
   * Compute semantic clusters of files
   *
   * @param {string|number} k - Number of clusters or 'auto'
   * @returns {Promise<{success: boolean, clusters: Array, centroids: Array}>}
   */
  async computeClusters(k = 'auto') {
    // Prevent concurrent cluster computation - return existing promise if computing
    if (this._computePromise) {
      logger.debug('[ClusteringService] Cluster computation already in progress, waiting...');
      return this._computePromise;
    }

    this._computePromise = this._doComputeClusters(k);
    this._startTime = Date.now();
    try {
      return await this._computePromise;
    } finally {
      this._computePromise = null;
      this._startTime = null;
    }
  }

  /**
   * Internal implementation of cluster computation
   * @private
   */
  async _doComputeClusters(k) {
    try {
      logger.info('[ClusteringService] Computing clusters...', { k });

      const files = await this.getAllFileEmbeddings();

      if (files.length < 3) {
        logger.warn('[ClusteringService] Not enough files for clustering');
        return {
          success: false,
          error: 'Need at least 3 files for clustering',
          clusters: [],
          centroids: []
        };
      }

      // FIX M-2: Add upper bound on cluster count to prevent performance degradation
      let numClusters;
      if (k === 'auto') {
        numClusters = this.estimateOptimalK(files);
      } else {
        numClusters = Math.max(2, Math.min(k, files.length, MAX_USER_CLUSTERS));
        if (k > MAX_USER_CLUSTERS) {
          logger.warn(
            `[ClusteringService] Requested ${k} clusters, capped at ${MAX_USER_CLUSTERS}`
          );
        }
      }

      // Run K-means
      const { assignments, centroids } = this.kmeans(files, numClusters);

      // Group files by cluster
      const clusters = this.groupByCluster(files, assignments);

      // Store results
      this.clusters = clusters;
      this.centroids = centroids;
      this.lastComputedAt = Date.now();

      logger.info('[ClusteringService] Clustering complete', {
        files: files.length,
        k: numClusters,
        clusters: clusters.length
      });

      return {
        success: true,
        clusters: clusters.map((c) => ({
          id: c.id,
          memberCount: c.members.length,
          memberIds: c.members.map((m) => m.id),
          label: c.label
        })),
        centroids: centroids.length
      };
    } catch (error) {
      logger.error('[ClusteringService] Clustering failed:', error);
      return {
        success: false,
        error: error.message,
        clusters: [],
        centroids: []
      };
    }
  }

  /**
   * Helper: Get most frequent item from array
   * @private
   */
  _getMostFrequent(arr) {
    if (!arr || arr.length === 0) return null;
    const counts = {};
    arr.forEach((item) => {
      if (item) counts[item] = (counts[item] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return sorted.length > 0 ? { item: sorted[0][0], count: sorted[0][1] } : null;
  }

  /**
   * Helper: Get common tags that appear in at least threshold% of items
   * @private
   */
  _getCommonTags(members, threshold = 0.4) {
    const tagCounts = {};
    members.forEach((m) => {
      // Parse tags from JSON string if needed
      let tags = m.metadata?.tags || [];
      if (typeof tags === 'string') {
        try {
          tags = JSON.parse(tags);
        } catch {
          tags = [];
        }
      }
      if (Array.isArray(tags)) {
        tags.forEach((tag) => {
          if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });

    const minCount = Math.ceil(members.length * threshold);
    return Object.entries(tagCounts)
      .filter(([, count]) => count >= minCount)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }

  /**
   * Tokenize and score distinctive "topic" terms for a member.
   *
   * This is intentionally deterministic and bounded. It does not rely on LLM output.
   *
   * @private
   * @param {Object} member
   * @returns {{ tokenSet: Set<string>, tokenCounts: Map<string, number> }}
   */
  _extractMemberTermSignals(member) {
    const tokenCounts = new Map();
    const tokenSet = new Set();

    const addTokens = (text, weight = 1) => {
      if (!text) return;
      const s = String(text);
      // Keep extraction bounded to avoid accidental O(N^2) behavior on huge strings.
      const limited = s.length > 5000 ? s.slice(0, 5000) : s;
      const matches = limited.toLowerCase().match(/[a-z0-9]+/g) || [];

      // Cap tokens per field to avoid pathological filenames/tags.
      const MAX_FIELD_TOKENS = 80;
      for (let i = 0; i < matches.length && i < MAX_FIELD_TOKENS; i++) {
        const raw = matches[i];
        if (!raw || raw.length < 3) continue;
        if (/^\d+$/.test(raw)) continue; // digits-only tokens are rarely helpful as topics
        if (STOPWORDS.has(raw)) continue;
        if (FILE_TYPE_STOPWORDS.has(raw)) continue;

        // Normalize common underscore/camel artifacts already handled by regex; just keep.
        tokenSet.add(raw);
        tokenCounts.set(raw, (tokenCounts.get(raw) || 0) + weight);
      }
    };

    const meta = member?.metadata || {};
    const name = meta.name || '';
    const subject = meta.subject || '';
    const summary = meta.summary || meta.description || '';
    const category = meta.category || '';

    // Tags are stored as JSON string in Chroma; normalize to array of strings.
    let tags = meta.tags || [];
    if (typeof tags === 'string' && tags.trim()) {
      try {
        tags = JSON.parse(tags);
      } catch {
        tags = tags.split(',').map((t) => t.trim());
      }
    }
    if (!Array.isArray(tags)) tags = [];

    // Weights (simple, deterministic): tags > subject > summary > name/category.
    addTokens(tags.join(' '), 3);
    addTokens(subject, 2);
    addTokens(summary, 1);
    addTokens(name, 1);
    addTokens(category, 1);

    return { tokenSet, tokenCounts };
  }

  /**
   * Compute TF-IDF-like distinctive terms for a cluster.
   *
   * score(term) = tf(term) * log((N+1)/(df(term)+1))
   *
   * @private
   * @param {Array} members
   * @param {Map<string, { tokenSet:Set<string>, tokenCounts:Map<string,number> }>} memberSignals
   * @param {Map<string, number>} globalDf
   * @param {number} totalDocs
   * @param {number} maxTerms
   * @returns {string[]}
   */
  _computeDistinctiveTermsForCluster(members, memberSignals, globalDf, totalDocs, maxTerms = 10) {
    if (!Array.isArray(members) || members.length === 0) return [];
    if (!(globalDf instanceof Map) || !Number.isFinite(totalDocs) || totalDocs <= 0) return [];

    const tf = new Map();
    for (const m of members) {
      const key = m?.id;
      const signals = key ? memberSignals.get(key) : null;
      const counts = signals?.tokenCounts;
      if (!(counts instanceof Map)) continue;
      for (const [term, count] of counts.entries()) {
        tf.set(term, (tf.get(term) || 0) + count);
      }
    }

    const scored = [];
    for (const [term, count] of tf.entries()) {
      const df = globalDf.get(term) || 0;
      const idf = Math.log((totalDocs + 1) / (df + 1));
      const score = count * idf;
      if (!Number.isFinite(score) || score <= 0) continue;
      scored.push({ term, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.term.localeCompare(b.term);
    });

    return scored.slice(0, Math.max(0, Math.min(50, maxTerms))).map((s) => s.term);
  }

  /**
   * Generate a label for a single cluster using LLM
   * Uses metadata as context to help LLM generate better names
   * @private
   */
  async _generateSingleClusterLabel(cluster) {
    const members = cluster.members || [];
    if (members.length === 0) {
      return {
        label: `Cluster ${cluster.id + 1}`,
        confidence: 'low',
        dominantCategory: null,
        commonTags: []
      };
    }

    // 1. Extract metadata for context (used to enrich LLM prompt)
    const categories = members.map((m) => m.metadata?.category).filter(Boolean);
    const dominantCategoryResult = this._getMostFrequent(categories);
    const dominantCategory = dominantCategoryResult?.item;

    // 2. Extract common tags (appear in >40% of files)
    const commonTags = this._getCommonTags(members, 0.4);

    // 3. Always use LLM to generate cluster name (if available)
    if (this.ollama) {
      try {
        const fileNames = members
          .slice(0, 8)
          .map((f) => f.metadata?.name || f.id)
          .filter(Boolean)
          .join(', ');

        const subjects = members
          .slice(0, 5)
          .map((f) => f.metadata?.subject)
          .filter(Boolean)
          .join('; ');

        const descriptions = members
          .slice(0, 3)
          .map((f) => f.metadata?.description || f.metadata?.summary)
          .filter(Boolean)
          .join('; ');

        const prompt = `You are naming a cluster of similar files. Generate a concise, descriptive 2-5 word name that captures what these files have in common.

Files in this cluster: ${fileNames}
${subjects ? `Topics/Subjects: ${subjects}` : ''}
${descriptions ? `Descriptions: ${descriptions}` : ''}
${dominantCategory ? `Detected category: ${dominantCategory}` : ''}
${commonTags.length > 0 ? `Common tags: ${commonTags.join(', ')}` : ''}
File count: ${members.length}

Requirements:
- Be specific and descriptive (not generic like "Documents" or "Files")
- Use title case
- 2-5 words maximum
- No quotes or punctuation

Respond with ONLY the cluster name, nothing else.

Examples of good names: "Q4 Financial Reports", "Employee Onboarding Materials", "Product Launch Assets", "Client Meeting Notes", "Marketing Campaign Images"`;

        const response = await this.ollama.analyzeText(prompt, {
          model: getOllamaModel() || AI_DEFAULTS.TEXT.MODEL,
          maxTokens: 30
        });

        const label = (response?.response || response || '')
          .trim()
          .replace(/["']/g, '')
          .replace(/^(Cluster|Group|Category|Collection):\s*/i, '')
          .replace(/\.$/, '');

        if (
          label &&
          label.length > 0 &&
          label.length < 60 &&
          !label.toLowerCase().includes('cluster')
        ) {
          return {
            label,
            confidence: 'high',
            reason: 'LLM generated',
            dominantCategory,
            commonTags
          };
        }
      } catch (llmError) {
        logger.warn(
          '[ClusteringService] LLM label generation failed for cluster',
          cluster.id,
          llmError.message
        );
      }
    }

    // 4. Fallback to metadata-based labels if LLM unavailable or failed
    if (dominantCategory && commonTags.length > 0) {
      const tagPart = commonTags.slice(0, 2).join(' ');
      return {
        label: `${tagPart} ${dominantCategory}`.trim(),
        confidence: 'medium',
        reason: 'Based on metadata (LLM unavailable)',
        dominantCategory,
        commonTags
      };
    }

    if (dominantCategory) {
      return {
        label: dominantCategory,
        confidence: 'medium',
        reason: 'Based on dominant category (LLM unavailable)',
        dominantCategory,
        commonTags
      };
    }

    if (commonTags.length > 0) {
      return {
        label: commonTags.slice(0, 3).join(', '),
        confidence: 'low',
        reason: 'Based on common tags (LLM unavailable)',
        dominantCategory,
        commonTags
      };
    }

    // 5. Final fallback
    return {
      label: `Cluster ${cluster.id + 1}`,
      confidence: 'low',
      dominantCategory: null,
      commonTags: []
    };
  }

  /**
   * Generate labels for clusters using LLM
   * Uses metadata as context to help LLM generate descriptive names
   * Falls back to metadata-based labels only if LLM is unavailable
   *
   * @param {Object} options - Label generation options
   * @param {number} [options.concurrency=3] - Max concurrent LLM calls
   * @returns {Promise<{success: boolean, labels: Map}>}
   */
  async generateClusterLabels(options = {}) {
    if (this.clusters.length === 0) {
      return { success: false, error: 'No clusters computed yet' };
    }

    const { concurrency = 3 } = options;

    try {
      const labels = new Map();

      // Process clusters in batches
      for (let i = 0; i < this.clusters.length; i += concurrency) {
        const batch = this.clusters.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
          batch.map((cluster) => this._generateSingleClusterLabel(cluster))
        );

        // Process batch results
        batchResults.forEach((result, idx) => {
          const cluster = batch[idx];
          if (result.status === 'fulfilled') {
            const { label, confidence, reason, dominantCategory, commonTags } = result.value;
            labels.set(cluster.id, label);

            // Update cluster object with rich metadata
            cluster.label = label;
            cluster.labelConfidence = confidence;
            cluster.labelReason = reason;
            cluster.dominantCategory = dominantCategory;
            cluster.commonTags = commonTags || [];
          } else {
            labels.set(cluster.id, `Cluster ${cluster.id + 1}`);
            cluster.label = `Cluster ${cluster.id + 1}`;
            cluster.labelConfidence = 'low';
          }
        });
      }

      this.clusterLabels = labels;

      logger.info('[ClusteringService] Generated labels for clusters', {
        count: labels.size,
        highConfidence: this.clusters.filter((c) => c.labelConfidence === 'high').length,
        mediumConfidence: this.clusters.filter((c) => c.labelConfidence === 'medium').length
      });

      return {
        success: true,
        labels: Object.fromEntries(labels)
      };
    } catch (error) {
      logger.error('[ClusteringService] Label generation failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get computed clusters for graph visualization
   *
   * @returns {Array} Clusters with labels, metadata, and member info
   */
  getClustersForGraph() {
    // Precompute global document-frequency across all cluster members so we can
    // compute *distinctive* (not just frequent) terms per cluster.
    const memberSignals = new Map();
    const globalDf = new Map();

    for (const cluster of this.clusters) {
      const members = Array.isArray(cluster?.members) ? cluster.members : [];
      for (const m of members) {
        const id = m?.id;
        if (!id || typeof id !== 'string') continue;
        if (memberSignals.has(id)) continue;
        const signals = this._extractMemberTermSignals(m);
        memberSignals.set(id, signals);
        // Update global DF once per member.
        for (const term of signals.tokenSet) {
          globalDf.set(term, (globalDf.get(term) || 0) + 1);
        }
      }
    }
    const totalDocs = memberSignals.size;

    const parseDateCandidateMs = (value) => {
      if (!value) return null;
      const ms = Date.parse(String(value));
      return Number.isFinite(ms) ? ms : null;
    };

    const getMemberPath = (member) => {
      const metaPath = member?.metadata?.path;
      if (typeof metaPath === 'string' && metaPath.trim()) return metaPath;
      const id = member?.id;
      if (typeof id !== 'string') return '';
      return id.replace(/^(file|image):/, '');
    };

    const getExtensionKey = (filePath) => {
      const ext = (path.extname(String(filePath || '')) || '').toLowerCase();
      return ext.replace(/^\./, '');
    };

    const getFileCategoryKey = (extKey) => {
      const ext = String(extKey || '').toLowerCase();
      if (!ext) return 'other';

      // Match using the same canonical extension lists as auto-organize.
      if (FILE_TYPE_CATEGORIES.documents.includes(ext)) return 'document';
      if (FILE_TYPE_CATEGORIES.spreadsheets.includes(ext)) return 'spreadsheet';
      if (FILE_TYPE_CATEGORIES.presentations.includes(ext)) return 'presentation';
      if (FILE_TYPE_CATEGORIES.images.includes(ext)) return 'image';
      if (FILE_TYPE_CATEGORIES.videos.includes(ext)) return 'video';
      if (FILE_TYPE_CATEGORIES.audio.includes(ext)) return 'audio';
      if (FILE_TYPE_CATEGORIES.code.includes(ext)) return 'code';
      if (FILE_TYPE_CATEGORIES.archives.includes(ext)) return 'archive';

      return 'other';
    };

    const getFileCategoryLabel = (categoryKey) => {
      switch (categoryKey) {
        case 'document':
          return 'Document';
        case 'spreadsheet':
          return 'Spreadsheet';
        case 'presentation':
          return 'Presentation';
        case 'image':
          return 'Image';
        case 'video':
          return 'Video';
        case 'audio':
          return 'Audio';
        case 'code':
          return 'Code';
        case 'archive':
          return 'Archive';
        default:
          return 'Other';
      }
    };

    const getMostFrequentKey = (items) => {
      const counts = new Map();
      for (const item of items) {
        const key = String(item || '').trim();
        if (!key) continue;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      let bestKey = null;
      let bestCount = 0;
      for (const [key, count] of counts.entries()) {
        if (count > bestCount) {
          bestKey = key;
          bestCount = count;
        }
      }
      return bestKey;
    };

    const getMemberTimestampMs = (member) => {
      const meta = member?.metadata || {};
      // Prefer an actual document date if present, otherwise fall back to recency.
      return (
        parseDateCandidateMs(meta.documentDate) ??
        parseDateCandidateMs(meta.date) ??
        parseDateCandidateMs(meta.updatedAt) ??
        null
      );
    };

    return this.clusters.map((c) => {
      const memberIds = c.members.map((m) => m.id);

      // Derive a dominant file-category bucket for "Type (file category)" clustering in UI.
      const fileCategoryKeys = c.members.map((m) =>
        getFileCategoryKey(getExtensionKey(getMemberPath(m)))
      );
      const dominantFileCategoryKey = getMostFrequentKey(fileCategoryKeys) || 'other';

      // Derive a dominant folder label for "Tag/Folder" clustering in UI.
      // Use parent directory base name to avoid leaking full paths into cluster labels.
      const parentFolderNames = c.members
        .map((m) => {
          const p = getMemberPath(m);
          if (!p) return '';
          const dir = path.dirname(p);
          const base = path.basename(dir);
          return base || '';
        })
        .filter(Boolean);
      const dominantFolderName = getMostFrequentKey(parentFolderNames) || null;

      // Derive a time range from member metadata when available.
      const memberTimestamps = c.members
        .map((m) => getMemberTimestampMs(m))
        .filter((ms) => Number.isFinite(ms));
      const timeRange =
        memberTimestamps.length > 0
          ? (() => {
              // Avoid spread operator to prevent stack overflow for large clusters
              let startMs = memberTimestamps[0];
              let endMs = memberTimestamps[0];
              for (let t = 1; t < memberTimestamps.length; t++) {
                if (memberTimestamps[t] < startMs) startMs = memberTimestamps[t];
                if (memberTimestamps[t] > endMs) endMs = memberTimestamps[t];
              }
              return {
                start: new Date(startMs).toISOString(),
                end: new Date(endMs).toISOString(),
                startMs,
                endMs
              };
            })()
          : null;

      // Distinctive terms used for cluster explanation and bridge “why”.
      const topTerms = this._computeDistinctiveTermsForCluster(
        c.members,
        memberSignals,
        globalDf,
        totalDocs,
        10
      );
      // Cache on the cluster object so other methods (e.g., cross-cluster edges) can reuse it
      // without recomputing.
      c.topTerms = topTerms;

      return {
        id: `cluster:${c.id}`,
        clusterId: c.id,
        label: c.label || this.clusterLabels.get(c.id) || `Cluster ${c.id + 1}`,
        memberCount: c.members.length,
        memberIds,
        // Rich metadata for meaningful display
        confidence: c.labelConfidence || 'low',
        reason: c.labelReason || '',
        dominantCategory: c.dominantCategory || null,
        commonTags: c.commonTags || [],
        topTerms,
        // Additional metadata for renderer-side cluster modes
        dominantFileCategory: dominantFileCategoryKey,
        dominantFileCategoryLabel: getFileCategoryLabel(dominantFileCategoryKey),
        dominantFolderName,
        timeRange
      };
    });
  }

  /**
   * Get members of a specific cluster with fresh metadata from ChromaDB
   *
   * @param {number} clusterId - Cluster ID
   * @returns {Promise<Array>} Cluster members with current metadata
   */
  async getClusterMembers(clusterId) {
    const cluster = this.clusters.find((c) => c.id === clusterId);
    if (!cluster) return [];

    const memberIds = cluster.members.map((m) => m.id);

    // Fetch fresh metadata from ChromaDB to get current file paths/names
    try {
      await this.chromaDb.initialize();

      const result = await this.chromaDb.fileCollection.get({
        ids: memberIds,
        include: ['metadatas']
      });

      // Guard against null/malformed result from ChromaDB
      if (!result || !Array.isArray(result.ids)) {
        logger.warn('[ClusteringService] ChromaDB returned invalid result, using cached metadata');
        return cluster.members.map((m) => ({ id: m.id, metadata: m.metadata }));
      }

      // Build a map of fresh metadata
      const freshMetadata = new Map();
      for (let i = 0; i < result.ids.length; i++) {
        freshMetadata.set(result.ids[i], result.metadatas?.[i] || {});
      }

      // Return members with fresh metadata (current paths and names)
      return cluster.members.map((m) => ({
        id: m.id,
        metadata: freshMetadata.get(m.id) || m.metadata
      }));
    } catch (error) {
      logger.warn('[ClusteringService] Failed to fetch fresh metadata, using cached:', error);
      // Fallback to cached metadata
      return cluster.members.map((m) => ({
        id: m.id,
        metadata: m.metadata
      }));
    }
  }

  /**
   * Select a representative subset of members to avoid heavy computations.
   * Uses similarity to the cluster's own centroid to pick the most central items.
   *
   * @private
   * @param {Array} members - Cluster members with embeddings
   * @param {Array<number>} centroid - Cluster centroid embedding
   * @param {number} maxCandidates - Max candidates to return
   * @returns {Array} Representative member subset
   */
  _selectBridgeCandidates(members, centroid, maxCandidates) {
    if (!Array.isArray(members) || members.length === 0) return [];
    if (!Array.isArray(centroid) || centroid.length === 0) return [];

    if (members.length <= maxCandidates) {
      return members;
    }

    const scored = [];
    for (const member of members) {
      const vector = member?.embedding;
      if (!Array.isArray(vector) || vector.length !== centroid.length) continue;
      const sim = cosineSimilarity(vector, centroid);
      scored.push({ member, sim });
    }

    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, maxCandidates).map((entry) => entry.member);
  }

  /**
   * Build bridge file samples between two clusters.
   * Picks top files from each cluster that are most similar to the other cluster's centroid.
   *
   * @private
   * @param {Object} clusterA
   * @param {Object} clusterB
   * @param {Array<number>} centroidA
   * @param {Array<number>} centroidB
   * @param {Object} options
   * @returns {Array<{id:string,name?:string,path?:string,similarity:number,clusterId:string}>}
   */
  _buildBridgeFilesForEdge(clusterA, clusterB, centroidA, centroidB, options) {
    const {
      maxBridgeFilesPerCluster = 3,
      maxCandidatesPerCluster = 50,
      minBridgeSimilarity = 0.55
    } = options || {};

    if (!clusterA || !clusterB) return [];
    if (!Array.isArray(centroidA) || !Array.isArray(centroidB)) return [];

    const candidatesA = this._selectBridgeCandidates(
      clusterA.members,
      centroidA,
      maxCandidatesPerCluster
    );
    const candidatesB = this._selectBridgeCandidates(
      clusterB.members,
      centroidB,
      maxCandidatesPerCluster
    );

    const pickTop = (candidates, otherCentroid, clusterId) => {
      const scored = [];
      for (const member of candidates) {
        const vector = member?.embedding;
        if (!Array.isArray(vector) || vector.length !== otherCentroid.length) continue;
        const sim = cosineSimilarity(vector, otherCentroid);
        if (sim < minBridgeSimilarity) continue;
        const meta = member?.metadata || {};
        scored.push({
          id: member.id,
          name: meta.name || meta.path || member.id,
          path: meta.path || null,
          similarity: Math.round(sim * 100) / 100,
          clusterId: `cluster:${clusterId}`
        });
      }
      scored.sort((a, b) => b.similarity - a.similarity);
      return scored.slice(0, maxBridgeFilesPerCluster);
    };

    const topA = pickTop(candidatesA, centroidB, clusterA.id);
    const topB = pickTop(candidatesB, centroidA, clusterB.id);

    return [...topA, ...topB];
  }

  /**
   * Find cross-cluster edges based on centroid similarity
   *
   * @param {number} threshold - Similarity threshold (0-1)
   * @param {Object} options - Options
   * @returns {Array} Cross-cluster edges
   */
  findCrossClusterEdges(threshold = 0.6, options = {}) {
    const {
      includeBridgeFiles = true,
      maxBridgeFilesPerCluster = 3,
      maxCandidatesPerCluster = 50,
      minBridgeSimilarity = Math.max(0.5, threshold - 0.1)
    } = options;
    const edges = [];

    // Build a set of cluster IDs that actually exist (some may have been filtered)
    const existingClusterIds = new Set(this.clusters.map((c) => c.id));

    for (let i = 0; i < this.centroids.length; i++) {
      // Skip centroids whose clusters were filtered out (below minClusterSize)
      if (!existingClusterIds.has(i)) continue;

      for (let j = i + 1; j < this.centroids.length; j++) {
        if (!existingClusterIds.has(j)) continue;

        const similarity = cosineSimilarity(this.centroids[i], this.centroids[j]);

        if (similarity >= threshold) {
          const clusterA = this.clusters.find((c) => c.id === i);
          const clusterB = this.clusters.find((c) => c.id === j);

          const pickTerms = (cluster) => {
            const t =
              Array.isArray(cluster?.topTerms) && cluster.topTerms.length > 0
                ? cluster.topTerms
                : Array.isArray(cluster?.commonTags) && cluster.commonTags.length > 0
                  ? cluster.commonTags
                  : [];
            return t.filter((x) => typeof x === 'string' && x.trim().length > 0);
          };

          const termsA = pickTerms(clusterA);
          const termsB = pickTerms(clusterB);
          const termsBSet = new Set(termsB.map((t) => t.toLowerCase()));
          const sharedTerms = [];
          for (const t of termsA) {
            if (termsBSet.has(t.toLowerCase())) {
              sharedTerms.push(t);
              if (sharedTerms.length >= 3) break;
            }
          }

          const edge = {
            source: `cluster:${i}`,
            target: `cluster:${j}`,
            similarity,
            type: 'cross_cluster',
            sharedTerms
          };

          if (includeBridgeFiles) {
            const bridgeFiles = this._buildBridgeFilesForEdge(
              clusterA,
              clusterB,
              this.centroids[i],
              this.centroids[j],
              {
                maxBridgeFilesPerCluster,
                maxCandidatesPerCluster,
                minBridgeSimilarity
              }
            );
            edge.bridgeFiles = bridgeFiles;
            edge.count = bridgeFiles.length;
          }

          edges.push(edge);
        }
      }
    }

    return edges;
  }

  /**
   * Clear cached clusters
   */
  clearClusters() {
    this.clusters = [];
    this.centroids = [];
    this.clusterLabels.clear();
    this.lastComputedAt = null;
    logger.info('[ClusteringService] Clusters cleared');
  }

  /**
   * Find similarity edges between files for graph visualization
   * Returns edges between files that are semantically similar
   *
   * @param {Array<string>} fileIds - Array of file IDs to compute edges for
   * @param {Object} options - Options
   * @param {number} options.threshold - Similarity threshold (0-1), default 0.5
   * @param {number} options.maxEdgesPerNode - Maximum edges per node, default 3
   * @returns {Promise<Array>} Array of similarity edges
   */
  async findFileSimilarityEdges(fileIds, options = {}) {
    const { threshold = 0.5, maxEdgesPerNode = 3 } = options;

    if (!fileIds || fileIds.length < 2) {
      return [];
    }

    try {
      // Get embeddings for the specified files
      await this.chromaDb.initialize();

      const result = await this.chromaDb.fileCollection.get({
        ids: fileIds,
        include: ['embeddings', 'metadatas']
      });

      if (!result.ids || result.ids.length < 2) {
        return [];
      }

      // Build a map of id -> embedding
      const embeddings = new Map();
      for (let i = 0; i < result.ids.length; i++) {
        if (result.embeddings?.[i]) {
          embeddings.set(result.ids[i], {
            vector: result.embeddings[i],
            metadata: result.metadatas?.[i] || {}
          });
        }
      }

      // Compute pairwise similarities
      const edges = [];
      const edgeCounts = new Map();
      const ids = Array.from(embeddings.keys());

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const idA = ids[i];
          const idB = ids[j];
          const embA = embeddings.get(idA);
          const embB = embeddings.get(idB);

          // Skip if either embedding is missing or malformed
          if (!embA?.vector || !embB?.vector) continue;
          // Skip mismatched dimensions to avoid silent 0-similarity results
          if (embA.vector.length !== embB.vector.length) continue;

          const similarity = cosineSimilarity(embA.vector, embB.vector);

          if (similarity >= threshold) {
            // Check if we've reached max edges for either node
            const countA = edgeCounts.get(idA) || 0;
            const countB = edgeCounts.get(idB) || 0;

            if (countA < maxEdgesPerNode && countB < maxEdgesPerNode) {
              edges.push({
                id: `sim:${idA}->${idB}`,
                source: idA,
                target: idB,
                similarity: Math.round(similarity * 100) / 100,
                type: 'similarity'
              });

              edgeCounts.set(idA, countA + 1);
              edgeCounts.set(idB, countB + 1);
            }
          }
        }
      }

      // Sort by similarity (highest first) and limit total edges
      edges.sort((a, b) => b.similarity - a.similarity);

      logger.debug('[ClusteringService] Found similarity edges', {
        fileCount: fileIds.length,
        edgeCount: edges.length
      });

      return edges;
    } catch (error) {
      logger.error('[ClusteringService] Failed to find similarity edges:', error);
      return [];
    }
  }

  /**
   * Find near-duplicate files across the entire indexed collection
   *
   * @param {Object} options - Search options
   * @param {number} options.threshold - Similarity threshold (default: 0.9 for near-duplicates)
   * @param {number} options.maxResults - Maximum duplicate groups to return (default: 50)
   * @returns {Promise<Object>} Object with duplicate groups and metadata
   */
  async findNearDuplicates(options = {}) {
    // FIX: HIGH - Enforce minimum threshold to prevent resource exhaustion
    // Low thresholds (e.g., 0.1) would match nearly all files, causing OOM
    const MIN_SAFE_THRESHOLD = 0.7;
    const MAX_PAIRS_LIMIT = 10000; // Prevent memory exhaustion from unbounded pairs

    const { threshold: requestedThreshold = 0.9, maxResults = 50 } = options;
    const threshold = Math.max(requestedThreshold, MIN_SAFE_THRESHOLD);

    if (requestedThreshold < MIN_SAFE_THRESHOLD) {
      logger.warn('[ClusteringService] Threshold increased to minimum safe value', {
        requested: requestedThreshold,
        enforced: threshold
      });
    }

    try {
      await this.chromaDb.initialize();

      // Get all files with embeddings
      const collection = this.chromaDb.fileCollection;
      const count = await collection.count();

      if (count < 2) {
        return { success: true, groups: [], totalDuplicates: 0 };
      }

      // Get all embeddings (limited to prevent memory issues)
      const limit = Math.min(count, 1000);
      const result = await collection.get({
        limit,
        include: ['embeddings', 'metadatas']
      });

      if (!result.ids || result.ids.length < 2) {
        return { success: true, groups: [], totalDuplicates: 0 };
      }

      // Build embedding map
      const embeddings = new Map();
      for (let i = 0; i < result.ids.length; i++) {
        if (result.embeddings?.[i]) {
          embeddings.set(result.ids[i], {
            vector: result.embeddings[i],
            metadata: result.metadatas?.[i] || {}
          });
        }
      }

      // Find all high-similarity pairs
      const duplicatePairs = [];
      const ids = Array.from(embeddings.keys());
      let pairsLimitReached = false;

      // FIX: HIGH - Add early exit when max pairs limit is reached
      outerLoop: for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          // Check pairs limit before processing
          if (duplicatePairs.length >= MAX_PAIRS_LIMIT) {
            pairsLimitReached = true;
            logger.warn('[ClusteringService] Duplicate detection capped at MAX_PAIRS_LIMIT', {
              limit: MAX_PAIRS_LIMIT,
              filesProcessed: i,
              totalFiles: ids.length
            });
            break outerLoop;
          }

          const idA = ids[i];
          const idB = ids[j];
          const embA = embeddings.get(idA);
          const embB = embeddings.get(idB);

          if (!embA?.vector || !embB?.vector) continue;
          // Skip mismatched dimensions to avoid silent 0-similarity results
          if (embA.vector.length !== embB.vector.length) continue;

          const similarity = cosineSimilarity(embA.vector, embB.vector);

          if (similarity >= threshold) {
            duplicatePairs.push({
              source: idA,
              target: idB,
              similarity,
              sourceMetadata: embA.metadata,
              targetMetadata: embB.metadata
            });
          }
        }
      }

      // Group connected duplicates using union-find
      const parent = new Map();
      const find = (x) => {
        if (!parent.has(x)) parent.set(x, x);
        if (parent.get(x) !== x) {
          parent.set(x, find(parent.get(x)));
        }
        return parent.get(x);
      };
      const union = (a, b) => {
        const rootA = find(a);
        const rootB = find(b);
        if (rootA !== rootB) {
          parent.set(rootA, rootB);
        }
      };

      // Union all duplicate pairs
      for (const pair of duplicatePairs) {
        union(pair.source, pair.target);
      }

      // Group by root
      const groupMap = new Map();
      for (const pair of duplicatePairs) {
        const root = find(pair.source);
        if (!groupMap.has(root)) {
          groupMap.set(root, new Set());
        }
        groupMap.get(root).add(pair.source);
        groupMap.get(root).add(pair.target);
      }

      // Build result groups with metadata
      const groups = [];
      for (const [, memberSet] of groupMap) {
        const members = Array.from(memberSet).map((id) => ({
          id,
          ...embeddings.get(id)?.metadata
        }));

        // Calculate average similarity within group
        let totalSim = 0;
        let simCount = 0;
        for (const pair of duplicatePairs) {
          if (memberSet.has(pair.source) && memberSet.has(pair.target)) {
            totalSim += pair.similarity;
            simCount++;
          }
        }

        groups.push({
          id: `dup-group-${groups.length}`,
          members,
          memberCount: members.length,
          averageSimilarity:
            simCount > 0 ? Math.round((totalSim / simCount) * 100) / 100 : threshold
        });
      }

      // Sort by group size (largest first) and limit results
      groups.sort((a, b) => b.memberCount - a.memberCount);
      const limitedGroups = groups.slice(0, maxResults);

      const totalDuplicates = limitedGroups.reduce((sum, g) => sum + g.memberCount, 0);

      logger.info('[ClusteringService] Found near-duplicates', {
        pairCount: duplicatePairs.length,
        groupCount: limitedGroups.length,
        totalDuplicates,
        pairsLimitReached
      });

      return {
        success: true,
        groups: limitedGroups,
        totalDuplicates,
        threshold,
        // FIX: Include warning if results were truncated
        truncated: pairsLimitReached,
        warning: pairsLimitReached
          ? `Results truncated: exceeded ${MAX_PAIRS_LIMIT} pairs limit. Consider increasing threshold.`
          : undefined
      };
    } catch (error) {
      logger.error('[ClusteringService] Failed to find near-duplicates:', error);
      return {
        success: false,
        error: error.message,
        groups: [],
        totalDuplicates: 0
      };
    }
  }

  /**
   * Cleanup resources on shutdown
   * Clears all cached data and pending operations
   */
  cleanup() {
    logger.info('[ClusteringService] Cleaning up...');

    // Clear all cached data
    this.clusters = [];
    this.centroids = [];
    this.clusterLabels.clear();
    this.lastComputedAt = null;
    this._computePromise = null;

    logger.info('[ClusteringService] Cleanup complete');
  }

  /**
   * Alias for cleanup (for consistency with other services)
   */
  shutdown() {
    this.cleanup();
  }
}

module.exports = { ClusteringService };
