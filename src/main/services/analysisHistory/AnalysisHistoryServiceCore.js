/**
 * Analysis History Service Core
 *
 * Slim coordinator class that composes all analysis history modules.
 * Extracted from the original 1,238-line AnalysisHistoryService.js.
 *
 * @module analysisHistory/AnalysisHistoryServiceCore
 */

const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { logger } = require('../../../shared/logger');
const { LIMITS } = require('../../../shared/performanceConstants');

// Import decomposed modules
const {
  createCacheStore,
  getCacheTTLs,
  invalidateCachesOnAdd,
  updateIncrementalStatsOnAdd,
  clearCaches: clearCachesHelper,
  warmCache: warmCacheHelper
} = require('./cacheManager');

const {
  loadConfig: loadConfigFile,
  saveConfig: saveConfigFile,
  loadHistory: loadHistoryFile,
  saveHistory: saveHistoryFile,
  loadIndex: loadIndexFile,
  saveIndex: saveIndexFile,
  createDefaultStructures: createDefaultStructuresFiles
} = require('./persistence');

const { createEmptyIndex, generateFileHash, updateIndexes } = require('./indexManager');

const { searchAnalysis: searchAnalysisHelper } = require('./search');

const {
  getStatistics: getStatisticsHelper,
  getQuickStats: getQuickStatsHelper
} = require('./statistics');

const {
  getAnalysisByPath: getAnalysisByPathHelper,
  getAnalysisByHash: getAnalysisByHashHelper,
  getAnalysisByCategory: getAnalysisByCategoryHelper,
  getAnalysisByTag: getAnalysisByTagHelper,
  getRecentAnalysis: getRecentAnalysisHelper,
  getAnalysisByDateRange: getAnalysisByDateRangeHelper,
  getCategories: getCategoriesHelper,
  getTags: getTagsHelper
} = require('./queries');

const { performMaintenanceIfNeeded, migrateHistory } = require('./maintenance');

logger.setContext('AnalysisHistoryService');

class AnalysisHistoryServiceCore {
  constructor() {
    this.userDataPath = app.getPath('userData');
    this.historyPath = path.join(this.userDataPath, 'analysis-history.json');
    this.indexPath = path.join(this.userDataPath, 'analysis-index.json');
    this.configPath = path.join(this.userDataPath, 'analysis-config.json');

    this.analysisHistory = null;
    this.analysisIndex = null;
    this.config = null;
    this.initialized = false;

    // Schema version for future migration support
    this.SCHEMA_VERSION = '1.0.0';
    this.MAX_HISTORY_ENTRIES = LIMITS.MAX_HISTORY_ENTRIES;

    // Get cache TTLs from config
    const ttls = getCacheTTLs();
    this.CACHE_TTL_MS = ttls.CACHE_TTL_MS;
    this.STATS_CACHE_TTL_MS = ttls.STATS_CACHE_TTL_MS;
    this.SEARCH_CACHE_TTL_MS = ttls.SEARCH_CACHE_TTL_MS;

    // Initialize cache store
    this._cache = createCacheStore();

    // Performance: Track if full recalculation is needed
    this._statsNeedFullRecalc = true;

    // Write lock to prevent concurrent modifications
    this._writeLock = null;
  }

  _normalizeResults(result) {
    if (Array.isArray(result)) {
      return result;
    }

    if (result && Array.isArray(result.results)) {
      const normalized = result.results.slice();
      normalized.total = typeof result.total === 'number' ? result.total : normalized.length;
      normalized.hasMore = typeof result.hasMore === 'boolean' ? result.hasMore : false;
      if (typeof result.fromCache === 'boolean') {
        normalized.fromCache = result.fromCache;
      }
      return normalized;
    }

    return [];
  }

  getDefaultConfig() {
    return {
      schemaVersion: this.SCHEMA_VERSION,
      maxHistoryEntries: this.MAX_HISTORY_ENTRIES,
      retentionDays: 365, // Keep analysis for 1 year
      enableRAG: true,
      enableFullTextSearch: true,
      compressionEnabled: false, // For future use
      backupEnabled: true,
      backupFrequencyDays: 7,
      lastBackup: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  createEmptyHistory() {
    return {
      schemaVersion: this.SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalAnalyzed: 0,
      totalSize: 0,
      entries: {},
      metadata: {
        lastCleanup: null,
        totalEntries: 0,
        averageAnalysisTime: 0
      }
    };
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await this.loadConfig();
      await this.loadHistory();
      await this.loadIndex();
      this.initialized = true;
      logger.info('[AnalysisHistoryService] Initialized successfully');
    } catch (error) {
      logger.error('[AnalysisHistoryService] Failed to initialize', {
        error: error.message
      });
      await this.createDefaultStructures({ resetConfig: true });
    }
  }

  async loadConfig() {
    this.config = await loadConfigFile(
      this.configPath,
      () => this.getDefaultConfig(),
      async (cfg) => saveConfigFile(this.configPath, cfg)
    );
  }

  async loadHistory() {
    this.analysisHistory = await loadHistoryFile(
      this.historyPath,
      this.SCHEMA_VERSION,
      () => this.createEmptyHistory(),
      async (hist) => saveHistoryFile(this.historyPath, hist),
      migrateHistory
    );
  }

  async loadIndex() {
    this.analysisIndex = await loadIndexFile(
      this.indexPath,
      () => createEmptyIndex(this.SCHEMA_VERSION),
      async (idx) => saveIndexFile(this.indexPath, idx)
    );
  }

  async createDefaultStructures(options = {}) {
    const { resetConfig = false } = options;

    // Preserve existing configuration when requested to avoid wiping user prefs
    if (!this.config && !resetConfig) {
      try {
        await this.loadConfig();
      } catch (error) {
        logger.warn('[AnalysisHistoryService] Falling back to default config during reset', {
          error: error.message
        });
      }
    }

    const result = await createDefaultStructuresFiles(
      {
        configPath: this.configPath,
        historyPath: this.historyPath,
        indexPath: this.indexPath
      },
      resetConfig
        ? () => this.getDefaultConfig()
        : () => ({
            ...(this.config || this.getDefaultConfig()),
            updatedAt: new Date().toISOString()
          }),
      () => this.createEmptyHistory(),
      () => createEmptyIndex(this.SCHEMA_VERSION)
    );

    this.config = result.config;
    this.analysisHistory = result.history;
    this.analysisIndex = result.index;

    // Reset caches/stat tracking so subsequent reads reflect the cleared state
    this._cache = createCacheStore();
    this._statsNeedFullRecalc = true;
    this.initialized = true;

    return result;
  }

  async saveConfig() {
    await saveConfigFile(this.configPath, this.config);
  }

  async saveHistory() {
    await saveHistoryFile(this.historyPath, this.analysisHistory);
  }

  async saveIndex() {
    await saveIndexFile(this.indexPath, this.analysisIndex);
  }

  async recordAnalysis(fileInfo, analysisResults) {
    await this.initialize();

    // Acquire write lock to prevent concurrent modifications
    while (this._writeLock) {
      await this._writeLock;
    }

    let releaseLock;
    this._writeLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      const timestamp = new Date().toISOString();
      const fileHash = generateFileHash(fileInfo.path, fileInfo.size, fileInfo.lastModified);

      const analysisEntry = {
        id: crypto.randomUUID(),
        fileHash,
        timestamp,

        // File information
        originalPath: fileInfo.path,
        fileName: path.basename(fileInfo.path),
        fileExtension: path.extname(fileInfo.path).toLowerCase(),
        fileSize: fileInfo.size,
        lastModified: fileInfo.lastModified,
        mimeType: fileInfo.mimeType || null,

        // Analysis results
        analysis: {
          subject: analysisResults.subject || null,
          category: analysisResults.category || null,
          tags: analysisResults.tags || [],
          confidence: analysisResults.confidence || 0,
          summary: analysisResults.summary || null,
          extractedText: analysisResults.extractedText || null,
          keyEntities: analysisResults.keyEntities || [],
          dates: analysisResults.dates || [],
          amounts: analysisResults.amounts || [],
          language: analysisResults.language || null,
          sentiment: analysisResults.sentiment || null
        },

        // Processing metadata
        processing: {
          model: analysisResults.model || 'unknown',
          processingTimeMs: analysisResults.processingTime || 0,
          version: this.SCHEMA_VERSION,
          errorCount: analysisResults.errorCount || 0,
          warnings: analysisResults.warnings || []
        },

        // Organization results (if file was moved/renamed)
        organization: {
          suggested: analysisResults.suggestedPath || null,
          actual: analysisResults.actualPath || null,
          renamed: analysisResults.renamed || false,
          newName: analysisResults.newName || null,
          smartFolder: analysisResults.smartFolder || null
        },

        // Future expansion fields
        embedding: null, // For RAG functionality
        relations: [], // Related files
        userFeedback: null, // User corrections/ratings
        exportHistory: [], // Export/share history
        accessCount: 0,
        lastAccessed: timestamp
      };

      // Store the entry
      this.analysisHistory.entries[analysisEntry.id] = analysisEntry;
      this.analysisHistory.totalAnalyzed++;
      this.analysisHistory.totalSize += fileInfo.size;
      this.analysisHistory.updatedAt = timestamp;
      this.analysisHistory.metadata.totalEntries++;

      // Update indexes
      updateIndexes(this.analysisIndex, analysisEntry);

      // Update incremental stats (avoids full recalculation)
      updateIncrementalStatsOnAdd(this._cache, analysisEntry);

      // Invalidate relevant caches (surgical invalidation, not full)
      invalidateCachesOnAdd(this._cache);

      // Save to disk
      const saveResults = await Promise.allSettled([this.saveHistory(), this.saveIndex()]);
      saveResults.forEach((result, index) => {
        if (result.status === 'rejected') {
          logger.warn(`[ANALYSIS-HISTORY] Save operation ${index} failed:`, result.reason?.message);
        }
      });

      // Cleanup if needed
      await performMaintenanceIfNeeded(
        this.analysisHistory,
        this.analysisIndex,
        this._cache,
        this,
        this.config,
        () => this.saveHistory(),
        () => this.saveIndex()
      );

      return analysisEntry.id;
    } finally {
      // Release write lock
      this._writeLock = null;
      releaseLock();
    }
  }

  async searchAnalysis(query, options = {}) {
    await this.initialize();
    const result = await searchAnalysisHelper(
      this.analysisHistory,
      this._cache,
      this.SEARCH_CACHE_TTL_MS,
      query,
      options
    );
    return this._normalizeResults(result);
  }

  async getAnalysisByPath(filePath) {
    await this.initialize();
    return getAnalysisByPathHelper(this.analysisHistory, this.analysisIndex, filePath);
  }

  async getAnalysisByHash(fileHash) {
    await this.initialize();
    return getAnalysisByHashHelper(this.analysisHistory, this.analysisIndex, fileHash);
  }

  async getAnalysisByCategory(category, options = {}) {
    await this.initialize();
    const result = await getAnalysisByCategoryHelper(
      this.analysisHistory,
      this.analysisIndex,
      this._cache,
      this.CACHE_TTL_MS,
      category,
      options
    );
    return this._normalizeResults(result);
  }

  async getAnalysisByTag(tag, options = {}) {
    await this.initialize();
    const result = await getAnalysisByTagHelper(
      this.analysisHistory,
      this.analysisIndex,
      this._cache,
      this.CACHE_TTL_MS,
      tag,
      options
    );
    return this._normalizeResults(result);
  }

  async getRecentAnalysis(limit = 50, offset = 0) {
    await this.initialize();
    const result = await getRecentAnalysisHelper(
      this.analysisHistory,
      this._cache,
      this.CACHE_TTL_MS,
      limit,
      offset
    );
    return this._normalizeResults(result);
  }

  async getStatistics() {
    await this.initialize();
    return getStatisticsHelper(
      this.analysisHistory,
      this.analysisIndex,
      this._cache,
      this,
      this.STATS_CACHE_TTL_MS
    );
  }

  async getQuickStats() {
    await this.initialize();
    return getQuickStatsHelper(this.analysisHistory, this.analysisIndex);
  }

  async getAnalysisByDateRange(startDate, endDate, options = {}) {
    await this.initialize();
    const result = await getAnalysisByDateRangeHelper(
      this.analysisHistory,
      this.analysisIndex,
      startDate,
      endDate,
      options
    );
    return this._normalizeResults(result);
  }

  async getCategories() {
    await this.initialize();
    return getCategoriesHelper(this.analysisIndex);
  }

  async getTags() {
    await this.initialize();
    return getTagsHelper(this.analysisIndex);
  }

  async warmCache() {
    await this.initialize();
    await warmCacheHelper(
      this._cache,
      (limit) => this.getRecentAnalysis(limit),
      this.analysisHistory,
      this
    );
  }

  clearCaches() {
    clearCachesHelper(this._cache, this);
  }
}

module.exports = AnalysisHistoryServiceCore;
