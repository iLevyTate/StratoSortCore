/**
 * Organization Suggestion Service Core
 *
 * Slim coordinator class that composes the extracted modules.
 * Maintains full backward compatibility with the original API.
 *
 * @module services/organization/OrganizationSuggestionServiceCore
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { app } = require('electron');
const { logger } = require('../../../shared/logger');
const { SUPPORTED_IMAGE_EXTENSIONS } = require('../../../shared/constants');
const { LIMITS } = require('../../../shared/performanceConstants');
const { globalBatchProcessor } = require('../../utils/llmOptimization');
const { cosineSimilarity } = require('../../../shared/vectorMath');

// Extracted modules
const {
  strategies,
  getFileTypeCategory,
  getStrategyBasedSuggestions,
  getApplicableStrategies,
  selectBestStrategy,
  getFallbackSuggestion
} = require('./strategies');

const { PatternMatcher } = require('./patternMatcher');

const { rankSuggestions, calculateConfidence, generateExplanation } = require('./suggestionRanker');

const {
  calculateFolderFitScore,
  suggestFolderImprovement,
  suggestNewSmartFolder,
  analyzeFolderStructure,
  identifyMissingCategories,
  findOverlappingFolders
} = require('./folderAnalyzer');

const { getLLMAlternativeSuggestions } = require('./llmSuggester');

const { PatternPersistence } = require('./persistence');

const {
  analyzeFilePatterns,
  generateBatchRecommendations,
  generateFileSummary
} = require('./filePatternAnalyzer');

logger.setContext('OrganizationSuggestionService');

function getSemanticFileId(filePath) {
  const safePath = typeof filePath === 'string' ? filePath : '';
  const ext = (path.extname(safePath) || '').toLowerCase();
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
  return `${isImage ? 'image' : 'file'}:${safePath}`;
}

function stripSemanticPrefix(fileId) {
  return typeof fileId === 'string' ? fileId.replace(/^(file|image):/, '') : '';
}

/**
 * Calculate optimal concurrency based on CPU cores
 */
function calculateOptimalConcurrency() {
  const cpuCores = os.cpus().length;
  return Math.min(Math.max(2, Math.floor(cpuCores * 0.75)), 8);
}

/**
 * OrganizationSuggestionService - AI-powered file organization suggestions
 */
class OrganizationSuggestionServiceCore {
  /**
   * @param {Object} dependencies - Service dependencies
   * @param {Object} dependencies.chromaDbService - ChromaDB service
   * @param {Object} dependencies.folderMatchingService - Folder matching service
   * @param {Object} dependencies.settingsService - Settings service
   * @param {Object} [dependencies.clusteringService] - Clustering service (optional, for backward compat)
   * @param {Function} [dependencies.getClusteringService] - Lazy getter for clustering service (preferred)
   * @param {Object} dependencies.config - Configuration options
   */
  constructor({
    chromaDbService,
    folderMatchingService,
    settingsService,
    clusteringService,
    getClusteringService,
    config = {}
  } = {}) {
    // Validate required dependencies
    if (!chromaDbService) {
      throw new Error('OrganizationSuggestionServiceCore requires chromaDbService dependency');
    }
    if (!folderMatchingService) {
      throw new Error(
        'OrganizationSuggestionServiceCore requires folderMatchingService dependency'
      );
    }
    if (!settingsService) {
      throw new Error('OrganizationSuggestionServiceCore requires settingsService dependency');
    }

    this.chromaDb = chromaDbService;
    this.folderMatcher = folderMatchingService;
    this.settings = settingsService;

    // FIX: Support both direct injection and lazy getter to break circular dependencies
    // Lazy getter is preferred as it allows ClusteringService to be resolved when first needed
    this._clusteringService = clusteringService || null;
    this._getClusteringService = getClusteringService || null;

    // Configuration
    this.config = {
      semanticMatchThreshold: config.semanticMatchThreshold || 0.4,
      strategyMatchThreshold: config.strategyMatchThreshold || 0.3,
      patternSimilarityThreshold: config.patternSimilarityThreshold || 0.5,
      topKSemanticMatches: config.topKSemanticMatches || 8,
      maxFeedbackHistory: config.maxFeedbackHistory || 1000,
      llmTemperature: config.llmTemperature || 0.7,
      llmMaxTokens: config.llmMaxTokens || 500,
      // Cluster-based organization settings
      useClusterSuggestions: config.useClusterSuggestions !== false, // Enabled by default
      clusterBoostFactor: config.clusterBoostFactor || 1.3, // Boost for cluster-consistent suggestions
      minClusterConfidence: config.minClusterConfidence || 0.5,
      outlierThreshold: config.outlierThreshold || 0.3, // Below this = outlier
      ...config
    };

    // Strategy definitions (from extracted module)
    this.strategies = strategies;

    // Initialize pattern matcher
    this.patternMatcher = new PatternMatcher({
      maxUserPatterns: config.maxUserPatterns || 5000,
      maxMemoryMB: config.maxMemoryMB || 50,
      patternSimilarityThreshold: this.config.patternSimilarityThreshold,
      maxFeedbackHistory: this.config.maxFeedbackHistory
    });

    // Initialize persistence
    this.persistence = new PatternPersistence({
      filename: 'user-patterns.json',
      saveThrottleMs: 5000
    });

    // FIX: CRITICAL - Track loading promise to prevent race condition
    // Previously, this was fire-and-forget which could cause:
    // 1. Suggestions generated without historical patterns
    // 2. recordFeedback overwriting patterns before they're loaded
    this._loadingPatterns = this._loadPatternsAsync();
  }

  /**
   * FIX: Ensure patterns are loaded before accessing them
   * Must be called by any method that reads or writes patterns
   * @private
   * @returns {Promise<void>}
   */
  async _ensurePatternsLoaded() {
    if (this._loadingPatterns) {
      await this._loadingPatterns;
      this._loadingPatterns = null;
    }
  }

  /**
   * FIX: Lazy getter for clustering service
   * Resolves the clustering service on first access to break circular dependencies
   * @returns {Object|null} ClusteringService instance or null if not available
   */
  get clustering() {
    // Return cached instance if available
    if (this._clusteringService) {
      return this._clusteringService;
    }

    // Try lazy resolution if getter is provided
    if (this._getClusteringService && typeof this._getClusteringService === 'function') {
      try {
        this._clusteringService = this._getClusteringService();
        return this._clusteringService;
      } catch (error) {
        logger.warn(
          '[OrganizationSuggestionService] Failed to resolve ClusteringService:',
          error.message
        );
        return null;
      }
    }

    return null;
  }

  /**
   * Load patterns asynchronously
   * @private
   */
  async _loadPatternsAsync() {
    try {
      const stored = await this.persistence.load();
      if (stored) {
        this.patternMatcher.loadPatterns(stored);
      }
    } catch (error) {
      logger.warn('Failed to load user patterns', { error: error.message });
    }
  }

  /**
   * Save patterns to storage
   * @private
   */
  async _savePatterns() {
    try {
      const data = this.patternMatcher.exportPatterns();
      await this.persistence.save(data);
    } catch (error) {
      logger.error('Failed to save patterns:', error);
    }
  }

  // Legacy compatibility methods
  async loadUserPatterns() {
    return this._loadPatternsAsync();
  }

  async saveUserPatterns() {
    return this._savePatterns();
  }

  /**
   * Get organization suggestions for a single file
   */
  async getSuggestionsForFile(file, smartFolders = [], options = {}) {
    // FIX: Ensure patterns are loaded before generating suggestions
    await this._ensurePatternsLoaded();

    const { includeStructureAnalysis = true, includeAlternatives = true } = options;

    // Validate inputs
    if (!file || typeof file !== 'object') {
      throw new Error('Invalid file object: file must be an object');
    }
    if (!file.name || typeof file.name !== 'string') {
      throw new Error('Invalid file object: file.name is required');
    }
    if (!file.extension || typeof file.extension !== 'string') {
      throw new Error('Invalid file object: file.extension is required');
    }
    if (!Array.isArray(smartFolders)) {
      throw new Error('smartFolders must be an array');
    }
    if (file.name.length > LIMITS.MAX_FILENAME_LENGTH) {
      throw new Error('Invalid file object: file.name exceeds maximum length');
    }
    if (file.extension.length > 50) {
      throw new Error('Invalid file object: file.extension exceeds maximum length');
    }
    if (!file.path || typeof file.path !== 'string') {
      throw new Error('Invalid file object: file.path is required');
    }

    try {
      // Ensure smart folders have embeddings
      if (smartFolders && smartFolders.length > 0) {
        await this.ensureSmartFolderEmbeddings(smartFolders);
      }

      // Get suggestions from all sources
      const semanticMatches = await this.getSemanticFolderMatches(file, smartFolders);
      const strategyMatches = getStrategyBasedSuggestions(
        file,
        smartFolders,
        this.config.strategyMatchThreshold
      );
      const patternMatches = this.patternMatcher.getPatternBasedSuggestions(file);
      const llmSuggestions = await getLLMAlternativeSuggestions(file, smartFolders, this.config);
      const improvementSuggestions = await this.getImprovementSuggestions(file, smartFolders);

      // Get cluster-based suggestions (if clustering is available)
      const clusterSuggestions = await this.getClusterBasedSuggestions(file, smartFolders);

      // Combine and tag suggestions
      const allSuggestions = [];
      for (const match of semanticMatches) {
        match.source = 'semantic';
        allSuggestions.push(match);
      }
      for (const match of strategyMatches) {
        match.source = 'strategy';
        allSuggestions.push(match);
      }
      for (const match of patternMatches) {
        match.source = 'pattern';
        allSuggestions.push(match);
      }
      for (const suggestion of llmSuggestions) {
        suggestion.source = 'llm';
        allSuggestions.push(suggestion);
      }
      for (const suggestion of improvementSuggestions) {
        suggestion.source = 'improvement';
        allSuggestions.push(suggestion);
      }
      for (const suggestion of clusterSuggestions) {
        suggestion.source = 'cluster';
        allSuggestions.push(suggestion);
      }

      // Rank suggestions (cluster-consistent ones get boosted)
      let rankedSuggestions = rankSuggestions(allSuggestions);

      // Apply additional cluster boost to top suggestions
      rankedSuggestions = await this.boostClusterConsistentSuggestions(file, rankedSuggestions);

      // Ensure files always get a folder
      if (rankedSuggestions.length === 0) {
        const defaultSuggestion = await this._getDefaultFolderSuggestion(file, smartFolders);
        if (defaultSuggestion) {
          rankedSuggestions.push(defaultSuggestion);
        }
      }

      // Get folder improvements
      let folderImprovements = [];
      if (includeStructureAnalysis) {
        folderImprovements = analyzeFolderStructure(
          smartFolders,
          [file],
          this.patternMatcher.folderUsageStats
        );
      }

      return {
        success: true,
        primary: rankedSuggestions[0] || null,
        alternatives: includeAlternatives ? rankedSuggestions.slice(1, 5) : [],
        strategies: getApplicableStrategies(file),
        confidence: calculateConfidence(rankedSuggestions[0]),
        explanation: generateExplanation(rankedSuggestions[0], file),
        folderImprovements
      };
    } catch (error) {
      logger.error('[OrganizationSuggestionService] Failed to get suggestions:', error);
      return {
        success: false,
        error: error.message,
        fallback: getFallbackSuggestion(file, smartFolders)
      };
    }
  }

  /**
   * Get default folder suggestion when no matches found
   * @private
   */
  async _getDefaultFolderSuggestion(file, smartFolders) {
    let defaultFolder = smartFolders.find(
      (f) => f.isDefault || f.name.toLowerCase() === 'uncategorized'
    );

    if (!defaultFolder) {
      logger.warn('[OrganizationSuggestionService] No default folder, creating fallback');
      try {
        const documentsDir = app.getPath('documents');
        const defaultFolderPath = path.join(documentsDir, 'StratoSort', 'Uncategorized');
        await fs.mkdir(defaultFolderPath, { recursive: true });

        defaultFolder = {
          id: `emergency-default-${Date.now()}`,
          name: 'Uncategorized',
          path: defaultFolderPath,
          description: 'Emergency fallback folder',
          keywords: [],
          isDefault: true,
          createdAt: new Date().toISOString()
        };
        smartFolders.push(defaultFolder);
      } catch (error) {
        logger.error('[OrganizationSuggestionService] Failed to create default folder:', error);
        const documentsDir = app.getPath('documents');
        defaultFolder = {
          name: 'Uncategorized',
          path: path.join(documentsDir, 'StratoSort', 'Uncategorized'),
          description: 'Default folder for unmatched files',
          isDefault: true
        };
      }
    }

    return {
      folder: defaultFolder.name,
      path: defaultFolder.path,
      score: 0.1,
      confidence: 0.1,
      method: 'default_fallback',
      description: defaultFolder.description || 'Default folder for unmatched files',
      source: 'default',
      isSmartFolder: true
    };
  }

  /**
   * Get suggestions for batch organization
   */
  async getBatchSuggestions(files, smartFolders = [], options = {}) {
    // FIX: Ensure patterns are loaded before generating suggestions
    await this._ensurePatternsLoaded();

    try {
      const patterns = analyzeFilePatterns(files);
      const groups = new Map();

      const optimalConcurrency = calculateOptimalConcurrency();
      logger.info('[OrganizationSuggestionService] Processing batch', {
        fileCount: files.length,
        concurrency: optimalConcurrency
      });

      const batchResult = await globalBatchProcessor.processBatch(
        files,
        async (file) => {
          const suggestion = await this.getSuggestionsForFile(file, smartFolders, options);
          return { file, suggestion };
        },
        { concurrency: optimalConcurrency, stopOnError: false }
      );

      // Group results
      for (const result of batchResult.results) {
        if (result.error) {
          logger.warn('[OrganizationSuggestionService] File failed', {
            file: result.file?.name,
            error: result.error
          });
          continue;
        }

        const { file, suggestion } = result;
        if (!suggestion?.success || !suggestion.primary) {
          logger.warn('[OrganizationSuggestionService] Skipping file with no primary suggestion', {
            file: file?.name
          });
          continue;
        }

        const key = suggestion.primary?.folder || 'Uncategorized';

        if (!groups.has(key)) {
          groups.set(key, {
            folder: suggestion.primary?.folder || key,
            path: suggestion.primary?.path, // Include path for destination building
            files: [],
            confidence: 0,
            strategy: suggestion.primary?.strategy
          });
        }

        const group = groups.get(key);
        group.files.push({
          ...file,
          suggestion: suggestion.primary,
          alternatives: suggestion.alternatives
        });

        // Update average confidence (guard against division by zero)
        const fileCount = group.files.length;
        if (fileCount > 0) {
          const currentTotal = group.confidence * (fileCount - 1);
          const newTotal = currentTotal + (suggestion.confidence || 0);
          group.confidence = newTotal / fileCount;
        }
      }

      const recommendations = generateBatchRecommendations(groups, patterns);

      return {
        success: true,
        groups: Array.from(groups.values()),
        patterns,
        recommendations,
        suggestedStrategy: selectBestStrategy(patterns, files)
      };
    } catch (error) {
      logger.error('[OrganizationSuggestionService] Batch failed:', error);
      return {
        success: false,
        error: error.message,
        groups: []
      };
    }
  }

  /**
   * Ensure smart folders have embeddings
   */
  async ensureSmartFolderEmbeddings(smartFolders) {
    try {
      if (!smartFolders || smartFolders.length === 0) {
        return 0;
      }

      const embeddingPromises = smartFolders.map(async (folder) => {
        try {
          const folderText = [folder.name, folder.description].filter(Boolean).join(' - ');
          const { vector, model } = await this.folderMatcher.embedText(folderText);
          const folderId = folder.id || this.folderMatcher.generateFolderId(folder);

          return {
            id: folderId,
            name: folder.name,
            description: folder.description || '',
            path: folder.path || '',
            vector,
            model,
            updatedAt: new Date().toISOString()
          };
        } catch (error) {
          logger.warn('[OrganizationSuggestionService] Failed to embed folder:', folder.name);
          return null;
        }
      });

      const folderPayloads = (await Promise.allSettled(embeddingPromises))
        .filter((r) => r.status === 'fulfilled' && r.value !== null)
        .map((r) => r.value);

      if (folderPayloads.length === 0) {
        return 0;
      }

      const successful = await this.chromaDb.batchUpsertFolders(folderPayloads);
      logger.debug(`[OrganizationSuggestionService] Upserted ${successful} folder embeddings`);
      return successful;
    } catch (error) {
      logger.warn('[OrganizationSuggestionService] Failed to ensure embeddings:', error);
      return 0;
    }
  }

  /**
   * Get semantic folder matches using embeddings
   */
  async getSemanticFolderMatches(file, smartFolders) {
    try {
      const fileId = getSemanticFileId(file.path);
      const summary = generateFileSummary(file);

      await this.folderMatcher.upsertFileEmbedding(fileId, summary, {
        path: file.path,
        name: file.name,
        analysis: file.analysis
      });

      const matches = await this.folderMatcher.matchFileToFolders(
        fileId,
        this.config.topKSemanticMatches
      );

      const suggestions = [];
      for (const match of matches) {
        const smartFolder = smartFolders.find(
          (f) => f.id === match.folderId || f.name === match.name || f.path === match.path
        );

        if (smartFolder || match.score > this.config.semanticMatchThreshold) {
          suggestions.push({
            folder: smartFolder?.name || match.name,
            path: smartFolder?.path || match.path,
            score: match.score,
            confidence: match.score,
            description: smartFolder?.description || match.description,
            method: 'semantic_embedding',
            isSmartFolder: !!smartFolder
          });
        }
      }

      return suggestions;
    } catch (error) {
      logger.warn('[OrganizationSuggestionService] Semantic matching failed:', error);
      return [];
    }
  }

  /**
   * Get improvement suggestions for existing folders
   */
  async getImprovementSuggestions(file, smartFolders) {
    const suggestions = [];

    for (const folder of smartFolders) {
      const fitScore = calculateFolderFitScore(file, folder);

      if (fitScore > 0.3 && fitScore < 0.7) {
        suggestions.push({
          folder: folder.name,
          path: folder.path,
          score: fitScore + 0.2,
          confidence: fitScore,
          description: folder.description,
          improvement: suggestFolderImprovement(file, folder),
          method: 'folder_improvement'
        });
      }
    }

    if (suggestions.length === 0) {
      const newFolderSuggestion = suggestNewSmartFolder(file, smartFolders, getFileTypeCategory);
      if (newFolderSuggestion) {
        suggestions.push(newFolderSuggestion);
      }
    }

    return suggestions;
  }

  /**
   * Record user feedback
   * @returns {Promise<void>}
   */
  async recordFeedback(file, suggestion, accepted) {
    // FIX: Ensure patterns are loaded before modifying them
    // This prevents overwriting patterns that haven't been loaded yet
    await this._ensurePatternsLoaded();

    this.patternMatcher.recordFeedback(file, suggestion, accepted);
    return this._savePatterns();
  }

  /**
   * Analyze folder structure
   */
  async analyzeFolderStructure(smartFolders, files = []) {
    return analyzeFolderStructure(smartFolders, files, this.patternMatcher.folderUsageStats);
  }

  /**
   * Extract pattern from file and suggestion
   * @param {Object} file - File object
   * @param {Object} suggestion - Suggestion object
   * @returns {Object|null} Extracted pattern
   */
  extractPattern(file, suggestion = null) {
    return this.patternMatcher.extractPattern(file, suggestion);
  }

  /**
   * Identify missing categories based on files
   * @param {Array} smartFolders - Smart folders
   * @param {Array} files - Files to analyze
   * @returns {Array} Missing categories
   */
  identifyMissingCategories(smartFolders, files) {
    return identifyMissingCategories(smartFolders, files);
  }

  /**
   * Find overlapping folders
   * @param {Array} smartFolders - Smart folders to analyze
   * @returns {Array} Overlapping folder pairs
   */
  findOverlappingFolders(smartFolders) {
    return findOverlappingFolders(smartFolders);
  }

  // ============================================================================
  // Cluster-Based Organization Methods
  // ============================================================================

  /**
   * Get cluster-based suggestions for a file
   * Uses cluster membership to suggest organizing files with their cluster peers
   *
   * @param {Object} file - File to get suggestions for
   * @param {Array} smartFolders - Available smart folders
   * @returns {Promise<Array>} Cluster-based suggestions
   */
  async getClusterBasedSuggestions(file, smartFolders) {
    if (!this.clustering || !this.config.useClusterSuggestions) {
      return [];
    }

    try {
      const fileId = getSemanticFileId(file.path);

      // Ensure clusters are computed (use cached if fresh)
      if (this.clustering.isClustersStale()) {
        await this.clustering.computeClusters('auto');
      }

      // Find which cluster this file belongs to
      const clusters = this.clustering.clusters || [];
      let fileCluster = null;
      let fileClusterScore = 0;

      for (const cluster of clusters) {
        const member = cluster.members?.find((m) => m.id === fileId);
        if (member) {
          // Calculate how central this file is to the cluster
          const centroid = this.clustering.centroids[cluster.id];
          if (centroid && member.embedding) {
            fileClusterScore = cosineSimilarity(member.embedding, centroid);
          } else {
            fileClusterScore = 0.7; // Default if no embedding available
          }
          fileCluster = cluster;
          break;
        }
      }

      if (!fileCluster || fileClusterScore < this.config.minClusterConfidence) {
        return [];
      }

      // Get the most common folder assignments for cluster members
      const folderVotes = new Map();

      for (const member of fileCluster.members) {
        if (member.id === fileId) continue;

        const memberPath = member.metadata?.path || stripSemanticPrefix(member.id);
        // Check if this cluster member has been organized to a smart folder
        for (const folder of smartFolders) {
          if (memberPath.startsWith(folder.path)) {
            const current = folderVotes.get(folder.path) || { folder, count: 0, totalScore: 0 };
            current.count++;
            current.totalScore += member.score || 0.5;
            folderVotes.set(folder.path, current);
          }
        }
      }

      // Convert votes to suggestions
      const suggestions = [];
      for (const [, vote] of folderVotes) {
        const avgScore = vote.count > 0 ? vote.totalScore / vote.count : 0;
        const clusterConsistency = vote.count / fileCluster.members.length;

        suggestions.push({
          folder: vote.folder.name,
          path: vote.folder.path,
          score: avgScore * clusterConsistency * this.config.clusterBoostFactor,
          confidence: clusterConsistency,
          description: vote.folder.description,
          method: 'cluster_membership',
          clusterLabel: fileCluster.label || `Cluster ${fileCluster.id}`,
          clusterSize: fileCluster.members.length,
          clusterPeersInFolder: vote.count,
          isSmartFolder: true
        });
      }

      // If no cluster members are in folders yet, suggest based on cluster label
      if (suggestions.length === 0 && fileCluster.label) {
        const labelLower = fileCluster.label.toLowerCase();
        for (const folder of smartFolders) {
          const folderNameLower = folder.name.toLowerCase();
          const folderDescLower = (folder.description || '').toLowerCase();

          // Check if folder name/description matches cluster label
          if (
            folderNameLower.includes(labelLower) ||
            labelLower.includes(folderNameLower) ||
            folderDescLower.includes(labelLower)
          ) {
            suggestions.push({
              folder: folder.name,
              path: folder.path,
              score: 0.6 * this.config.clusterBoostFactor,
              confidence: 0.6,
              description: folder.description,
              method: 'cluster_label_match',
              clusterLabel: fileCluster.label,
              clusterSize: fileCluster.members.length,
              isSmartFolder: true
            });
          }
        }
      }

      return suggestions.sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.warn('[OrganizationSuggestionService] Cluster suggestions failed:', error);
      return [];
    }
  }

  /**
   * Get batch suggestions organized by clusters
   * Groups files by their cluster and suggests organizing each cluster together
   *
   * @param {Array} files - Files to organize
   * @param {Array} smartFolders - Available smart folders
   * @returns {Promise<Object>} Cluster-based batch suggestions
   */
  async getClusterBatchSuggestions(files, smartFolders = []) {
    if (!this.clustering) {
      return { success: false, error: 'Clustering service not available', groups: [] };
    }

    try {
      // Ensure clusters are fresh
      const computeResult = await this.clustering.computeClusters('auto');
      if (!computeResult.success) {
        return { success: false, error: computeResult.error, groups: [] };
      }

      // Generate labels if not done
      if (this.clustering.clusterLabels.size === 0) {
        await this.clustering.generateClusterLabels();
      }

      const clusters = this.clustering.clusters || [];
      const fileIdSet = new Set(files.map((f) => getSemanticFileId(f.path)));
      const groups = [];
      const outliers = [];

      // Group files by cluster
      for (const cluster of clusters) {
        const clusterFiles = [];

        for (const member of cluster.members) {
          if (fileIdSet.has(member.id)) {
            const file = files.find((f) => getSemanticFileId(f.path) === member.id);
            if (file) {
              clusterFiles.push({
                ...file,
                clusterScore: member.score || 0.7
              });
            }
          }
        }

        if (clusterFiles.length > 0) {
          // Find best folder for this cluster
          const clusterSuggestion = await this._suggestFolderForCluster(cluster, smartFolders);

          groups.push({
            clusterId: cluster.id,
            clusterLabel: cluster.label || `Cluster ${cluster.id + 1}`,
            files: clusterFiles,
            fileCount: clusterFiles.length,
            suggestedFolder: clusterSuggestion,
            confidence: clusterSuggestion?.confidence || 0.5,
            method: 'cluster_batch'
          });
        }
      }

      // Find files not in any cluster (outliers)
      const clusteredFileIds = new Set();
      for (const cluster of clusters) {
        for (const member of cluster.members) {
          clusteredFileIds.add(member.id);
        }
      }

      for (const file of files) {
        const fileId = getSemanticFileId(file.path);
        if (!clusteredFileIds.has(fileId)) {
          outliers.push({
            ...file,
            reason: 'not_in_cluster'
          });
        }
      }

      return {
        success: true,
        groups: groups.sort((a, b) => b.fileCount - a.fileCount),
        outliers,
        totalClustered: groups.reduce((sum, g) => sum + g.fileCount, 0),
        totalOutliers: outliers.length,
        clusterCount: groups.length
      };
    } catch (error) {
      logger.error('[OrganizationSuggestionService] Cluster batch suggestions failed:', error);
      return { success: false, error: error.message, groups: [] };
    }
  }

  /**
   * Suggest the best folder for a cluster
   * @private
   */
  async _suggestFolderForCluster(cluster, smartFolders) {
    if (!smartFolders || smartFolders.length === 0) {
      return null;
    }

    // Try to match cluster label to folder
    const labelLower = (cluster.label || '').toLowerCase();

    // First pass: exact or close match on folder name
    for (const folder of smartFolders) {
      const folderNameLower = folder.name.toLowerCase();
      if (folderNameLower === labelLower || folderNameLower.includes(labelLower)) {
        return {
          folder: folder.name,
          path: folder.path,
          confidence: 0.85,
          method: 'cluster_label_match'
        };
      }
    }

    // Second pass: keyword overlap
    const labelWords = labelLower.split(/\s+/);
    let bestMatch = null;
    let bestScore = 0;

    for (const folder of smartFolders) {
      const folderWords = [
        folder.name.toLowerCase(),
        ...(folder.description || '').toLowerCase().split(/\s+/),
        ...(folder.keywords || []).map((k) => k.toLowerCase())
      ];

      const overlap = labelWords.filter((w) => folderWords.some((fw) => fw.includes(w))).length;
      const score = overlap / labelWords.length;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = folder;
      }
    }

    if (bestMatch && bestScore > 0.3) {
      return {
        folder: bestMatch.name,
        path: bestMatch.path,
        confidence: bestScore * 0.8,
        method: 'cluster_keyword_match'
      };
    }

    // Fallback: suggest creating a new folder based on cluster label
    if (cluster.label && cluster.label !== `Cluster ${cluster.id + 1}`) {
      return {
        folder: cluster.label,
        path: null, // Will need to be created
        confidence: 0.6,
        method: 'cluster_new_folder',
        isNewFolder: true
      };
    }

    return null;
  }

  /**
   * Identify outlier files that don't fit well into any cluster
   *
   * @param {Array} files - Files to analyze
   * @returns {Promise<Object>} Outlier analysis results
   */
  async identifyOutliers(files) {
    if (!this.clustering) {
      return { success: false, error: 'Clustering service not available', outliers: [] };
    }

    try {
      // Ensure clusters are computed
      if (this.clustering.isClustersStale()) {
        await this.clustering.computeClusters('auto');
      }

      const clusters = this.clustering.clusters || [];
      const centroids = this.clustering.centroids || [];
      const outliers = [];
      const wellClustered = [];

      for (const file of files) {
        const fileId = getSemanticFileId(file.path);

        // Find this file's cluster membership
        let bestClusterScore = 0;
        let belongsToCluster = null;

        for (const cluster of clusters) {
          const member = cluster.members?.find((m) => m.id === fileId);
          if (member) {
            const centroid = centroids[cluster.id];
            if (centroid && member.embedding) {
              const score = cosineSimilarity(member.embedding, centroid);
              if (score > bestClusterScore) {
                bestClusterScore = score;
                belongsToCluster = cluster;
              }
            }
          }
        }

        if (bestClusterScore < this.config.outlierThreshold || !belongsToCluster) {
          outliers.push({
            file,
            clusterScore: bestClusterScore,
            reason: bestClusterScore === 0 ? 'not_in_cluster' : 'weak_cluster_fit',
            suggestedAction: 'review_manually'
          });
        } else {
          wellClustered.push({
            file,
            clusterId: belongsToCluster.id,
            clusterLabel: belongsToCluster.label,
            clusterScore: bestClusterScore
          });
        }
      }

      return {
        success: true,
        outliers,
        wellClustered,
        outlierCount: outliers.length,
        clusteredCount: wellClustered.length,
        outlierRatio: files.length > 0 ? outliers.length / files.length : 0
      };
    } catch (error) {
      logger.error('[OrganizationSuggestionService] Outlier detection failed:', error);
      return { success: false, error: error.message, outliers: [] };
    }
  }

  /**
   * Boost suggestions that are consistent with cluster membership
   * Called internally to enhance ranking
   *
   * @param {Object} file - File being organized
   * @param {Array} suggestions - Current suggestions
   * @returns {Promise<Array>} Boosted suggestions
   */
  async boostClusterConsistentSuggestions(file, suggestions) {
    if (!this.clustering || !this.config.useClusterSuggestions || suggestions.length === 0) {
      return suggestions;
    }

    try {
      const clusterSuggestions = await this.getClusterBasedSuggestions(file, []);

      if (clusterSuggestions.length === 0) {
        return suggestions;
      }

      // Create a set of folders recommended by cluster analysis
      const clusterRecommendedFolders = new Set(clusterSuggestions.map((s) => s.path));

      // Boost matching suggestions
      return suggestions.map((s) => {
        if (clusterRecommendedFolders.has(s.path)) {
          return {
            ...s,
            score: s.score * this.config.clusterBoostFactor,
            clusterBoosted: true
          };
        }
        return s;
      });
    } catch (error) {
      logger.warn('[OrganizationSuggestionService] Cluster boost failed:', error);
      return suggestions;
    }
  }

  /**
   * Generate file summary for embedding
   * @param {Object} file - File object
   * @returns {string} File summary
   */
  generateFileSummary(file) {
    return generateFileSummary(file);
  }

  /**
   * Get file type category
   * @param {string} extension - File extension
   * @returns {string} Category name
   */
  getFileTypeCategory(extension) {
    return getFileTypeCategory(extension);
  }

  /**
   * Calculate pattern similarity
   * @param {Object} file - File object
   * @param {Object} pattern - Pattern object
   * @returns {number} Similarity score
   */
  calculatePatternSimilarity(file, pattern) {
    return this.patternMatcher.calculatePatternSimilarity(file, pattern);
  }

  // Legacy compatibility getters and setters
  get userPatterns() {
    return this.patternMatcher.userPatterns;
  }

  set userPatterns(value) {
    this.patternMatcher.userPatterns = value;
  }

  get feedbackHistory() {
    return this.patternMatcher.feedbackHistory;
  }

  set feedbackHistory(value) {
    this.patternMatcher.feedbackHistory = value;
  }

  get folderUsageStats() {
    return this.patternMatcher.folderUsageStats;
  }

  set folderUsageStats(value) {
    this.patternMatcher.folderUsageStats = value;
  }
}

module.exports = { OrganizationSuggestionServiceCore };
