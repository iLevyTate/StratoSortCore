/**
 * ClusteringService - Semantic Clustering with K-means
 *
 * Computes clusters of semantically similar files using K-means clustering
 * on embedding vectors. Generates LLM-based labels for cluster interpretation.
 *
 * @module services/ClusteringService
 */

const { logger } = require('../../shared/logger');
const {
  cosineSimilarity,
  squaredEuclideanDistance,
  validateEmbeddingDimensions
} = require('../../shared/vectorMath');
const { getOllamaModel } = require('../ollamaUtils');

logger.setContext('ClusteringService');

/**
 * Default clustering options
 */
const DEFAULT_OPTIONS = {
  maxIterations: 50,
  minClusterSize: 2,
  maxClusters: 15,
  convergenceThreshold: 0.001
};

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

      const result = await fileCollection.get({
        include: ['embeddings', 'metadatas']
      });

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
    try {
      return await this._computePromise;
    } finally {
      this._computePromise = null;
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
      const MAX_USER_CLUSTERS = 100;
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
   * Generate a label for a single cluster using metadata-first approach
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

    // 1. Extract categories from all members
    const categories = members.map((m) => m.metadata?.category).filter(Boolean);
    const dominantCategoryResult = this._getMostFrequent(categories);
    const dominantCategory = dominantCategoryResult?.item;
    const categoryCount = dominantCategoryResult?.count || 0;

    // 2. Extract common tags (appear in >40% of files)
    const commonTags = this._getCommonTags(members, 0.4);

    // 3. If we have strong metadata signals, use them directly (no LLM needed)
    if (dominantCategory && commonTags.length > 0) {
      const tagPart = commonTags.slice(0, 2).join(' ');
      return {
        label: `${tagPart} ${dominantCategory}`.trim(),
        confidence: 'high',
        reason: `${categoryCount}/${members.length} files share category`,
        dominantCategory,
        commonTags
      };
    }

    // 4. If only dominant category, use it
    if (dominantCategory && categoryCount >= members.length * 0.5) {
      return {
        label: dominantCategory,
        confidence: 'medium',
        reason: 'Based on dominant category',
        dominantCategory,
        commonTags
      };
    }

    // 5. If only common tags, use them
    if (commonTags.length >= 2) {
      return {
        label: commonTags.slice(0, 3).join(', '),
        confidence: 'medium',
        reason: 'Based on common tags',
        dominantCategory,
        commonTags
      };
    }

    // 6. Fallback to LLM with enriched context (if available)
    if (this.ollama) {
      try {
        const fileNames = members
          .slice(0, 5)
          .map((f) => f.metadata?.name || f.id)
          .filter(Boolean)
          .join(', ');

        const subjects = members
          .slice(0, 3)
          .map((f) => f.metadata?.subject)
          .filter(Boolean)
          .join('; ');

        const prompt = `Generate a 2-4 word category label for these files:

Files: ${fileNames}
${subjects ? `Subjects: ${subjects}` : ''}
${dominantCategory ? `Possible category: ${dominantCategory}` : ''}
${commonTags.length > 0 ? `Related tags: ${commonTags.join(', ')}` : ''}

Respond with ONLY the label, nothing else. Examples: "Financial Documents", "Project Proposals", "Meeting Notes"`;

        const response = await this.ollama.analyzeText(prompt, {
          model: getOllamaModel() || 'qwen3:0.6b',
          maxTokens: 20
        });

        const label = (response?.response || response || '').trim().replace(/["']/g, '');
        if (label && label.length > 0 && label.length < 50) {
          return {
            label,
            confidence: 'medium',
            reason: 'LLM generated',
            dominantCategory,
            commonTags
          };
        }
      } catch (llmError) {
        logger.warn('[ClusteringService] LLM label generation failed for cluster', cluster.id);
      }
    }

    // 7. Final fallback - use any available metadata
    if (dominantCategory) {
      return { label: dominantCategory, confidence: 'low', dominantCategory, commonTags };
    }
    if (commonTags.length > 0) {
      return { label: commonTags[0], confidence: 'low', dominantCategory, commonTags };
    }

    return {
      label: `Cluster ${cluster.id + 1}`,
      confidence: 'low',
      dominantCategory: null,
      commonTags: []
    };
  }

  /**
   * Generate labels for clusters using metadata-first approach
   * Falls back to LLM only when metadata is insufficient
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
    return this.clusters.map((c) => ({
      id: `cluster:${c.id}`,
      clusterId: c.id,
      label: c.label || this.clusterLabels.get(c.id) || `Cluster ${c.id + 1}`,
      memberCount: c.members.length,
      memberIds: c.members.map((m) => m.id),
      // Rich metadata for meaningful display
      confidence: c.labelConfidence || 'low',
      reason: c.labelReason || '',
      dominantCategory: c.dominantCategory || null,
      commonTags: c.commonTags || []
    }));
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
   * Find cross-cluster edges based on centroid similarity
   *
   * @param {number} threshold - Similarity threshold (0-1)
   * @returns {Array} Cross-cluster edges
   */
  findCrossClusterEdges(threshold = 0.6) {
    const edges = [];

    for (let i = 0; i < this.centroids.length; i++) {
      for (let j = i + 1; j < this.centroids.length; j++) {
        const similarity = cosineSimilarity(this.centroids[i], this.centroids[j]);

        if (similarity >= threshold) {
          edges.push({
            source: `cluster:${i}`,
            target: `cluster:${j}`,
            similarity,
            type: 'cross_cluster'
          });
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
