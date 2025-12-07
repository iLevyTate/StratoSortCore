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
const { globalBatchProcessor } = require('../../utils/llmOptimization');

// Extracted modules
const {
  strategies,
  getFileTypeCategory,
  getStrategyBasedSuggestions,
  getApplicableStrategies,
  selectBestStrategy,
  getFallbackSuggestion,
} = require('./strategies');

const { PatternMatcher } = require('./patternMatcher');

const {
  rankSuggestions,
  calculateConfidence,
  generateExplanation,
} = require('./suggestionRanker');

const {
  calculateFolderFitScore,
  suggestFolderImprovement,
  suggestNewSmartFolder,
  analyzeFolderStructure,
  identifyMissingCategories,
  findOverlappingFolders,
} = require('./folderAnalyzer');

const { getLLMAlternativeSuggestions } = require('./llmSuggester');

const { PatternPersistence } = require('./persistence');

const {
  analyzeFilePatterns,
  generateBatchRecommendations,
  generateFileSummary,
} = require('./filePatternAnalyzer');

logger.setContext('OrganizationSuggestionService');

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
   * @param {Object} dependencies.config - Configuration options
   */
  constructor({
    chromaDbService,
    folderMatchingService,
    settingsService,
    config = {},
  }) {
    this.chromaDb = chromaDbService;
    this.folderMatcher = folderMatchingService;
    this.settings = settingsService;

    // Configuration
    this.config = {
      semanticMatchThreshold: config.semanticMatchThreshold || 0.4,
      strategyMatchThreshold: config.strategyMatchThreshold || 0.3,
      patternSimilarityThreshold: config.patternSimilarityThreshold || 0.5,
      topKSemanticMatches: config.topKSemanticMatches || 8,
      maxFeedbackHistory: config.maxFeedbackHistory || 1000,
      llmTemperature: config.llmTemperature || 0.7,
      llmMaxTokens: config.llmMaxTokens || 500,
      ...config,
    };

    // Strategy definitions (from extracted module)
    this.strategies = strategies;

    // Initialize pattern matcher
    this.patternMatcher = new PatternMatcher({
      maxUserPatterns: config.maxUserPatterns || 5000,
      maxMemoryMB: config.maxMemoryMB || 50,
      patternSimilarityThreshold: this.config.patternSimilarityThreshold,
      maxFeedbackHistory: this.config.maxFeedbackHistory,
    });

    // Initialize persistence
    this.persistence = new PatternPersistence({
      filename: 'user-patterns.json',
      saveThrottleMs: 5000,
    });

    // Load patterns on initialization
    this._loadPatternsAsync();
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
    const { includeStructureAnalysis = true, includeAlternatives = true } =
      options;

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
    if (file.name.length > 255) {
      throw new Error('Invalid file object: file.name exceeds maximum length');
    }
    if (file.extension.length > 50) {
      throw new Error(
        'Invalid file object: file.extension exceeds maximum length',
      );
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
      const semanticMatches = await this.getSemanticFolderMatches(
        file,
        smartFolders,
      );
      const strategyMatches = getStrategyBasedSuggestions(
        file,
        smartFolders,
        this.config.strategyMatchThreshold,
      );
      const patternMatches =
        this.patternMatcher.getPatternBasedSuggestions(file);
      const llmSuggestions = await getLLMAlternativeSuggestions(
        file,
        smartFolders,
        this.config,
      );
      const improvementSuggestions = await this.getImprovementSuggestions(
        file,
        smartFolders,
      );

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

      // Rank suggestions
      const rankedSuggestions = rankSuggestions(allSuggestions);

      // Ensure files always get a folder
      if (rankedSuggestions.length === 0) {
        const defaultSuggestion = await this._getDefaultFolderSuggestion(
          file,
          smartFolders,
        );
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
          this.patternMatcher.folderUsageStats,
        );
      }

      return {
        success: true,
        primary: rankedSuggestions[0] || null,
        alternatives: includeAlternatives ? rankedSuggestions.slice(1, 5) : [],
        strategies: getApplicableStrategies(file),
        confidence: calculateConfidence(rankedSuggestions[0]),
        explanation: generateExplanation(rankedSuggestions[0], file),
        folderImprovements,
      };
    } catch (error) {
      logger.error(
        '[OrganizationSuggestionService] Failed to get suggestions:',
        error,
      );
      return {
        success: false,
        error: error.message,
        fallback: getFallbackSuggestion(file, smartFolders),
      };
    }
  }

  /**
   * Get default folder suggestion when no matches found
   * @private
   */
  async _getDefaultFolderSuggestion(file, smartFolders) {
    let defaultFolder = smartFolders.find(
      (f) => f.isDefault || f.name.toLowerCase() === 'uncategorized',
    );

    if (!defaultFolder) {
      logger.warn(
        '[OrganizationSuggestionService] No default folder, creating fallback',
      );
      try {
        const documentsDir = app.getPath('documents');
        const defaultFolderPath = path.join(
          documentsDir,
          'StratoSort',
          'Uncategorized',
        );
        await fs.mkdir(defaultFolderPath, { recursive: true });

        defaultFolder = {
          id: `emergency-default-${Date.now()}`,
          name: 'Uncategorized',
          path: defaultFolderPath,
          description: 'Emergency fallback folder',
          keywords: [],
          isDefault: true,
          createdAt: new Date().toISOString(),
        };
        smartFolders.push(defaultFolder);
      } catch (error) {
        logger.error(
          '[OrganizationSuggestionService] Failed to create default folder:',
          error,
        );
        const documentsDir = app.getPath('documents');
        defaultFolder = {
          name: 'Uncategorized',
          path: path.join(documentsDir, 'StratoSort', 'Uncategorized'),
          description: 'Default folder for unmatched files',
          isDefault: true,
        };
      }
    }

    return {
      folder: defaultFolder.name,
      path: defaultFolder.path,
      score: 0.1,
      confidence: 0.1,
      method: 'default_fallback',
      description:
        defaultFolder.description || 'Default folder for unmatched files',
      source: 'default',
      isSmartFolder: true,
    };
  }

  /**
   * Get suggestions for batch organization
   */
  async getBatchSuggestions(files, smartFolders = [], options = {}) {
    try {
      const patterns = analyzeFilePatterns(files);
      const groups = new Map();

      const optimalConcurrency = calculateOptimalConcurrency();
      logger.info('[OrganizationSuggestionService] Processing batch', {
        fileCount: files.length,
        concurrency: optimalConcurrency,
      });

      const batchResult = await globalBatchProcessor.processBatch(
        files,
        async (file) => {
          const suggestion = await this.getSuggestionsForFile(
            file,
            smartFolders,
            options,
          );
          return { file, suggestion };
        },
        { concurrency: optimalConcurrency, stopOnError: false },
      );

      // Group results
      for (const result of batchResult.results) {
        if (result.error) {
          logger.warn('[OrganizationSuggestionService] File failed', {
            file: result.file?.name,
            error: result.error,
          });
          continue;
        }

        const { file, suggestion } = result;
        if (!suggestion?.success || !suggestion.primary) {
          logger.warn(
            '[OrganizationSuggestionService] Skipping file with no primary suggestion',
            { file: file?.name },
          );
          continue;
        }

        const key = suggestion.primary?.folder || 'Uncategorized';

        if (!groups.has(key)) {
          groups.set(key, {
            folder: suggestion.primary?.folder || key,
            path: suggestion.primary?.path, // Include path for destination building
            files: [],
            confidence: 0,
            strategy: suggestion.primary?.strategy,
          });
        }

        const group = groups.get(key);
        group.files.push({
          ...file,
          suggestion: suggestion.primary,
          alternatives: suggestion.alternatives,
        });

        const currentTotal = group.confidence * (group.files.length - 1);
        const newTotal = currentTotal + (suggestion.confidence || 0);
        group.confidence = newTotal / group.files.length;
      }

      const recommendations = generateBatchRecommendations(groups, patterns);

      return {
        success: true,
        groups: Array.from(groups.values()),
        patterns,
        recommendations,
        suggestedStrategy: selectBestStrategy(patterns, files),
      };
    } catch (error) {
      logger.error('[OrganizationSuggestionService] Batch failed:', error);
      return {
        success: false,
        error: error.message,
        groups: [],
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
          const folderText = [folder.name, folder.description]
            .filter(Boolean)
            .join(' - ');
          const { vector, model } =
            await this.folderMatcher.embedText(folderText);
          const folderId =
            folder.id || this.folderMatcher.generateFolderId(folder);

          return {
            id: folderId,
            name: folder.name,
            description: folder.description || '',
            path: folder.path || '',
            vector,
            model,
            updatedAt: new Date().toISOString(),
          };
        } catch (error) {
          logger.warn(
            '[OrganizationSuggestionService] Failed to embed folder:',
            folder.name,
          );
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
      logger.debug(
        `[OrganizationSuggestionService] Upserted ${successful} folder embeddings`,
      );
      return successful;
    } catch (error) {
      logger.warn(
        '[OrganizationSuggestionService] Failed to ensure embeddings:',
        error,
      );
      return 0;
    }
  }

  /**
   * Get semantic folder matches using embeddings
   */
  async getSemanticFolderMatches(file, smartFolders) {
    try {
      const fileId = `file:${file.path}`;
      const summary = generateFileSummary(file);

      await this.folderMatcher.upsertFileEmbedding(fileId, summary, {
        path: file.path,
        name: file.name,
        analysis: file.analysis,
      });

      const matches = await this.folderMatcher.matchFileToFolders(
        fileId,
        this.config.topKSemanticMatches,
      );

      const suggestions = [];
      for (const match of matches) {
        const smartFolder = smartFolders.find(
          (f) =>
            f.id === match.folderId ||
            f.name === match.name ||
            f.path === match.path,
        );

        if (smartFolder || match.score > this.config.semanticMatchThreshold) {
          suggestions.push({
            folder: smartFolder?.name || match.name,
            path: smartFolder?.path || match.path,
            score: match.score,
            confidence: match.score,
            description: smartFolder?.description || match.description,
            method: 'semantic_embedding',
            isSmartFolder: !!smartFolder,
          });
        }
      }

      return suggestions;
    } catch (error) {
      logger.warn(
        '[OrganizationSuggestionService] Semantic matching failed:',
        error,
      );
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
          method: 'folder_improvement',
        });
      }
    }

    if (suggestions.length === 0) {
      const newFolderSuggestion = suggestNewSmartFolder(
        file,
        smartFolders,
        getFileTypeCategory,
      );
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
    this.patternMatcher.recordFeedback(file, suggestion, accepted);
    return this._savePatterns();
  }

  /**
   * Analyze folder structure
   */
  async analyzeFolderStructure(smartFolders, files = []) {
    return analyzeFolderStructure(
      smartFolders,
      files,
      this.patternMatcher.folderUsageStats,
    );
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
