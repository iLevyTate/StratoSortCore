/**
 * ClusteringService - Semantic Clustering with K-means
 *
 * Computes clusters of semantically similar files using K-means clustering
 * on embedding vectors. Generates LLM-based labels for cluster interpretation.
 *
 * @module services/ClusteringService
 */

const { logger } = require('../../shared/logger');
const { cosineSimilarity, squaredEuclideanDistance } = require('../../shared/vectorMath');

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
    this.chromaDb = chromaDbService;
    this.ollama = ollamaService;

    // Cached cluster data
    this.clusters = [];
    this.centroids = [];
    this.clusterLabels = new Map();
    this.lastComputedAt = null;

    // Staleness threshold (30 minutes)
    this.STALE_MS = 30 * 60 * 1000;
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

      const result = await this.chromaDb.fileCollection.get({
        include: ['embeddings', 'metadatas']
      });

      const files = [];
      const ids = result.ids || [];
      const embeddings = result.embeddings || [];
      const metadatas = result.metadatas || [];

      for (let i = 0; i < ids.length; i++) {
        if (embeddings[i] && embeddings[i].length > 0) {
          files.push({
            id: ids[i],
            embedding: embeddings[i],
            metadata: metadatas[i] || {}
          });
        }
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
      for (let i = 0; i < files.length; i++) {
        if (used.has(i)) continue;
        threshold -= distances[i];
        if (threshold <= 0) {
          centroids.push([...files[i].embedding]);
          used.add(i);
          break;
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

    for (let c = 0; c < centroids.length; c++) {
      if (counts[c] > 0) {
        for (let d = 0; d < dim; d++) {
          centroids[c][d] = sums[c][d] / counts[c];
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

      // Determine number of clusters
      const numClusters =
        k === 'auto' ? this.estimateOptimalK(files) : Math.max(2, Math.min(k, files.length));

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
   * Generate labels for clusters using LLM
   * Uses parallel processing for better performance with rate limiting
   *
   * @param {Object} options - Label generation options
   * @param {number} [options.concurrency=3] - Max concurrent LLM calls
   * @returns {Promise<{success: boolean, labels: Map}>}
   */
  async generateClusterLabels(options = {}) {
    if (this.clusters.length === 0) {
      return { success: false, error: 'No clusters computed yet' };
    }

    if (!this.ollama) {
      return { success: false, error: 'Ollama service not available' };
    }

    const { concurrency = 3 } = options;

    try {
      const labels = new Map();

      // Prepare label generation tasks
      const labelTasks = this.clusters.map((cluster) => ({
        cluster,
        fileNames: cluster.members
          .slice(0, 5)
          .map((f) => f.metadata?.name || f.id)
          .filter(Boolean)
          .join(', ')
      }));

      // Process in batches for controlled parallelism
      for (let i = 0; i < labelTasks.length; i += concurrency) {
        const batch = labelTasks.slice(i, i + concurrency);

        const batchResults = await Promise.allSettled(
          batch.map(async ({ cluster, fileNames }) => {
            if (!fileNames) {
              return { clusterId: cluster.id, label: `Cluster ${cluster.id + 1}` };
            }

            const prompt = `Based on these file names, generate a 2-4 word category label that describes what type of files these are:

Files: ${fileNames}

Respond with ONLY the label, nothing else. Examples: "Financial Documents", "Project Proposals", "Meeting Notes"`;

            try {
              const response = await this.ollama.analyzeText(prompt, {
                model: 'llama3.2:latest',
                maxTokens: 20
              });

              const label = (response?.response || response || '').trim().replace(/["']/g, '');
              return { clusterId: cluster.id, label: label || `Cluster ${cluster.id + 1}` };
            } catch (llmError) {
              logger.warn(
                '[ClusteringService] LLM label generation failed for cluster',
                cluster.id
              );
              return { clusterId: cluster.id, label: `Cluster ${cluster.id + 1}` };
            }
          })
        );

        // Process batch results
        batchResults.forEach((result) => {
          if (result.status === 'fulfilled') {
            const { clusterId, label } = result.value;
            labels.set(clusterId, label);

            // Update cluster object
            const cluster = this.clusters.find((c) => c.id === clusterId);
            if (cluster) cluster.label = label;
          }
        });
      }

      this.clusterLabels = labels;

      logger.info('[ClusteringService] Generated labels for clusters', {
        count: labels.size
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
   * @returns {Array} Clusters with labels and member info
   */
  getClustersForGraph() {
    return this.clusters.map((c) => ({
      id: `cluster:${c.id}`,
      clusterId: c.id,
      label: c.label || this.clusterLabels.get(c.id) || `Cluster ${c.id + 1}`,
      memberCount: c.members.length,
      memberIds: c.members.map((m) => m.id)
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
}

module.exports = { ClusteringService };
