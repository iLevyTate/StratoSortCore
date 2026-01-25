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
const { analysisResultSchema, validateSchema } = require('../../../shared/normalization/schemas');
const { LIMITS } = require('../../../shared/performanceConstants');
const { CircuitBreaker } = require('../../utils/CircuitBreaker');
const { traceHistoryUpdate } = require('../../../shared/pathTraceLogger');

// Import decomposed modules
const {
  createCacheStore,
  getCacheTTLs,
  invalidateCachesOnAdd,
  updateIncrementalStatsOnAdd,
  updateIncrementalStatsOnRemove,
  invalidateCachesOnRemove,
  clearCaches: clearCachesHelper,
  warmCache: warmCacheHelper,
  subscribeToInvalidationBus
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

const {
  createEmptyIndex,
  generateFileHash,
  updateIndexes,
  removeFromIndexes,
  updatePathIndexForMove
} = require('./indexManager');

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

    // FIX: Callback for cascade orphan marking when entries are removed
    // Set via setOnEntriesRemovedCallback from ServiceIntegration
    this._onEntriesRemovedCallback = null;

    // Fix 9: Write Queue Batching
    this._pendingWrites = [];
    this._writeBufferTimer = null;
    this.WRITE_BUFFER_MS = 100;

    // Circuit Breaker for file system operations
    this.circuitBreaker = new CircuitBreaker('AnalysisHistoryService', {
      failureThreshold: 3,
      timeout: 5000,
      resetTimeout: 10000
    });

    // Cache invalidation bus subscription handle for cleanup
    this._busUnsubscribe = null;
  }

  /**
   * Set callback for cascade orphan marking when entries are removed during maintenance
   * Called from ServiceIntegration after ChromaDB service is initialized
   * @param {Function} callback - Async function receiving array of {id, fileHash, originalPath, actualPath?}
   */
  setOnEntriesRemovedCallback(callback) {
    if (typeof callback === 'function') {
      this._onEntriesRemovedCallback = callback;
      logger.debug('[AnalysisHistoryService] Set onEntriesRemoved callback for orphan marking');
    }
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

      // Subscribe to cache invalidation bus for cross-service cache coordination
      this._busUnsubscribe = subscribeToInvalidationBus(this._cache, this);

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
    await this.circuitBreaker.execute(() =>
      saveHistoryFile(this.historyPath, this.analysisHistory)
    );
  }

  async saveIndex() {
    await this.circuitBreaker.execute(() => saveIndexFile(this.indexPath, this.analysisIndex));
  }

  async recordAnalysis(fileInfo, analysisResults) {
    // Fix 9: Buffer writes to reduce lock contention
    return new Promise((resolve, reject) => {
      this._pendingWrites.push({ fileInfo, analysisResults, resolve, reject });
      this._scheduleFlush();
    });
  }

  _scheduleFlush() {
    if (!this._writeBufferTimer) {
      this._writeBufferTimer = setTimeout(() => this._flushWrites(), this.WRITE_BUFFER_MS);
    }
    // Force flush if queue gets too large
    if (this._pendingWrites.length >= 50) {
      if (this._writeBufferTimer) clearTimeout(this._writeBufferTimer);
      this._flushWrites();
    }
  }

  async _flushWrites() {
    this._writeBufferTimer = null;
    if (this._pendingWrites.length === 0) return;

    const batch = this._pendingWrites.splice(0, this._pendingWrites.length);

    await this.initialize();

    // Acquire write lock
    while (this._writeLock) {
      await this._writeLock;
    }

    let releaseLock;
    this._writeLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      const timestamp = new Date().toISOString();
      let hasChanges = false;

      for (const { fileInfo, analysisResults, resolve, reject } of batch) {
        try {
          const fileHash = generateFileHash(fileInfo.path, fileInfo.size, fileInfo.lastModified);
          const analysisValidation = validateSchema(analysisResultSchema, analysisResults || {});
          if (!analysisValidation.valid) {
            logger.warn('[AnalysisHistoryService] Invalid analysis result shape', {
              filePath: fileInfo.path,
              error: analysisValidation.error?.message
            });
          }
          const safeResults = analysisValidation.data || analysisResults || {};

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

            // Analysis results - comprehensive data for document/image conversations
            analysis: {
              subject: safeResults.subject || null,
              category: safeResults.category || null,
              tags: safeResults.tags || [],
              confidence: safeResults.confidence || 0,
              summary: safeResults.summary || null,
              extractedText: safeResults.extractedText || null,
              // Document/image metadata for richer context
              documentType: safeResults.documentType || null,
              entity: safeResults.entity || null,
              project: safeResults.project || null,
              purpose: safeResults.purpose || null,
              reasoning: safeResults.reasoning || null,
              documentDate: safeResults.documentDate || null,
              extractionMethod: safeResults.extractionMethod || null,
              // Structured data for queries
              keyEntities: safeResults.keyEntities || [],
              dates: safeResults.dates || [],
              amounts: safeResults.amounts || [],
              language: safeResults.language || null,
              sentiment: safeResults.sentiment || null,
              // Image-specific fields
              content_type: safeResults.content_type || null,
              has_text: safeResults.has_text ?? null,
              colors: safeResults.colors || null
            },

            // Processing metadata
            processing: {
              model: safeResults.model || 'unknown',
              processingTimeMs: safeResults.processingTime || 0,
              version: this.SCHEMA_VERSION,
              errorCount: safeResults.errorCount || 0,
              warnings: safeResults.warnings || []
            },

            // Organization results (if file was moved/renamed)
            organization: {
              suggested: safeResults.suggestedPath || null,
              actual: safeResults.actualPath || null,
              renamed: safeResults.renamed || false,
              newName: safeResults.newName || null,
              smartFolder: safeResults.smartFolder || null
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
          this.analysisHistory.metadata.totalEntries++;

          // Update indexes
          updateIndexes(this.analysisIndex, analysisEntry);

          // Update incremental stats (avoids full recalculation)
          updateIncrementalStatsOnAdd(this._cache, analysisEntry);

          resolve(analysisEntry.id);
          hasChanges = true;
        } catch (err) {
          logger.error('[AnalysisHistoryService] Error processing batched item:', err);
          reject(err);
        }
      }

      if (hasChanges) {
        this.analysisHistory.updatedAt = timestamp;

        // Invalidate relevant caches (surgical invalidation, not full)
        invalidateCachesOnAdd(this._cache);

        // Save to disk
        const saveResults = await Promise.allSettled([this.saveHistory(), this.saveIndex()]);
        saveResults.forEach((result, index) => {
          if (result.status === 'rejected') {
            logger.warn(
              `[ANALYSIS-HISTORY] Save operation ${index} failed:`,
              result.reason?.message
            );
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
          () => this.saveIndex(),
          { onEntriesRemoved: this._onEntriesRemovedCallback }
        );
      }
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

  /**
   * Shutdown the service and release resources
   * Should be called during app exit to cleanly unsubscribe from the cache invalidation bus
   */
  shutdown() {
    if (this._busUnsubscribe) {
      this._busUnsubscribe();
      this._busUnsubscribe = null;
      logger.debug('[AnalysisHistoryService] Unsubscribed from cache invalidation bus');
    }
    this.clearCaches();
  }

  /**
   * Update entry paths after files have been moved/organized.
   * This updates the organization.actual field so that search results
   * show the current file location, not the original path.
   *
   * @param {Array<{oldPath: string, newPath: string, newName?: string}>} pathUpdates - Path update mappings
   * @returns {Promise<{updated: number, notFound: number}>} Update results
   */
  async updateEntryPaths(pathUpdates) {
    await this.initialize();

    if (!pathUpdates || !Array.isArray(pathUpdates) || pathUpdates.length === 0) {
      return { updated: 0, notFound: 0 };
    }

    // Acquire write lock
    while (this._writeLock) {
      await this._writeLock;
    }

    let releaseLock;
    this._writeLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      let updated = 0;
      let notFound = 0;

      // Build a map of oldPath -> update info for faster lookup
      const updateMap = new Map();
      for (const update of pathUpdates) {
        if (update.oldPath && update.newPath) {
          updateMap.set(update.oldPath, update);
        }
      }

      // Scan through entries and update matching ones
      const entries = this.analysisHistory?.entries || {};
      for (const entry of Object.values(entries)) {
        // Check if this entry's original path matches any update
        const update = updateMap.get(entry.originalPath);
        if (update) {
          // Track old actual path for index update
          const oldActualPath = entry.organization?.actual || null;

          // Update the organization fields
          if (!entry.organization) {
            entry.organization = {};
          }
          entry.organization.actual = update.newPath;
          if (update.newName) {
            entry.organization.newName = update.newName;
            entry.organization.renamed = true;
            // Also update the base fileName field for BM25 index consistency
            // This ensures searches find the file by its new name immediately
            entry.fileName = update.newName;
          }

          // FIX: Update the path index for fast lookups by new path
          if (this.analysisIndex) {
            updatePathIndexForMove(this.analysisIndex, entry, oldActualPath, update.newPath);
          }

          // PATH-TRACE: Log history entry path update
          traceHistoryUpdate(update.oldPath, update.newPath, entry.id, true);

          updated++;
          updateMap.delete(entry.originalPath); // Remove to track not found
        }
      }

      notFound = updateMap.size;

      if (updated > 0) {
        this.analysisHistory.updatedAt = new Date().toISOString();

        // Invalidate caches since paths have changed
        clearCachesHelper(this._cache, this);

        // Save to disk (both history and index since we updated path indexes)
        await this.saveHistory();
        await this.saveIndex();

        logger.info(
          `[AnalysisHistoryService] Updated ${updated} entry paths, ${notFound} not found`
        );
      }

      return { updated, notFound };
    } finally {
      this._writeLock = null;
      releaseLock();
    }
  }

  /**
   * Remove analysis history entries associated with a path.
   * Used to keep BM25/analysis-history-backed search in sync after deletes.
   *
   * Matches either the original path or the organization.actual path.
   *
   * @param {string} filePath
   * @returns {Promise<{removed: number}>}
   */
  async removeEntriesByPath(filePath) {
    await this.initialize();

    const target = typeof filePath === 'string' ? filePath : '';
    if (!target) return { removed: 0 };

    // Acquire write lock
    while (this._writeLock) {
      await this._writeLock;
    }
    let releaseLock;
    this._writeLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    const removedEntries = [];
    try {
      const entries = this.analysisHistory?.entries || {};
      for (const [id, entry] of Object.entries(entries)) {
        const original = entry?.originalPath;
        const actual = entry?.organization?.actual;
        if (original === target || actual === target) {
          removedEntries.push({
            id,
            fileHash: entry.fileHash,
            originalPath: entry.originalPath,
            actualPath: entry.organization?.actual || null
          });

          delete entries[id];
          updateIncrementalStatsOnRemove(this._cache, entry);
          removeFromIndexes(this.analysisIndex, entry);
        }
      }

      if (removedEntries.length > 0) {
        invalidateCachesOnRemove(this._cache, this);
        this.analysisHistory.updatedAt = new Date().toISOString();
        await this.saveHistory();
      }

      // Notify about removals so Chroma can mark any remaining embeddings/chunks orphaned.
      // (For app-driven deletes we also delete embeddings directly, but this keeps behavior consistent.)
      if (this._onEntriesRemovedCallback && removedEntries.length > 0) {
        try {
          await this._onEntriesRemovedCallback(removedEntries);
        } catch (e) {
          logger.warn('[AnalysisHistoryService] onEntriesRemoved callback failed', {
            error: e.message,
            count: removedEntries.length
          });
        }
      }

      return { removed: removedEntries.length };
    } finally {
      this._writeLock = null;
      releaseLock();
    }
  }

  /**
   * Clone an analysis history entry for a copied file.
   * This creates a new entry for the destination with the same analysis data.
   *
   * @param {string} sourcePath - Original file path
   * @param {string} destPath - Copied file path
   * @returns {Promise<{success: boolean, cloned?: boolean, error?: string}>}
   */
  async cloneEntryForCopy(sourcePath, destPath) {
    await this.initialize();

    if (!sourcePath || !destPath) {
      return { success: false, error: 'Source and destination paths required' };
    }

    // Find the source entry
    const sourceEntry = await this.getAnalysisByPath(sourcePath);
    if (!sourceEntry) {
      // No analysis history for source file - not an error, just nothing to clone
      return { success: true, cloned: false };
    }

    // Acquire write lock
    while (this._writeLock) {
      await this._writeLock;
    }
    let releaseLock;
    this._writeLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    try {
      // Generate new ID and file hash for the copy
      const newId = crypto.randomUUID();
      const destStats = await require('fs')
        .promises.stat(destPath)
        .catch(() => null);
      const newFileHash = generateFileHash(
        destPath,
        destStats?.size || sourceEntry.fileSize,
        destStats?.mtimeMs || Date.now()
      );

      // Clone the entry with new path information
      const clonedEntry = {
        ...sourceEntry,
        id: newId,
        fileHash: newFileHash,
        originalPath: destPath,
        fileName: path.basename(destPath),
        timestamp: new Date().toISOString(),
        lastModified: destStats?.mtimeMs || Date.now(),
        fileSize: destStats?.size || sourceEntry.fileSize,
        // Reset organization since this is a new file
        organization: {
          suggested: sourceEntry.organization?.suggested || null,
          actual: destPath,
          renamed: false,
          newName: null,
          smartFolder: sourceEntry.organization?.smartFolder || null
        },
        // Mark as cloned for audit purposes
        processing: {
          ...sourceEntry.processing,
          clonedFrom: sourcePath,
          clonedAt: new Date().toISOString()
        }
      };

      // Add to entries
      this.analysisHistory.entries[newId] = clonedEntry;

      // Update indexes
      updateIndexes(this.analysisIndex, clonedEntry);
      updateIncrementalStatsOnAdd(this._cache, clonedEntry);
      invalidateCachesOnAdd(this._cache, this);

      // Save to disk
      this.analysisHistory.updatedAt = new Date().toISOString();
      await this.saveHistory();
      await this.saveIndex();

      logger.info('[AnalysisHistoryService] Cloned entry for copied file', {
        source: sourcePath,
        dest: destPath,
        newId
      });

      return { success: true, cloned: true, newId };
    } catch (error) {
      logger.error('[AnalysisHistoryService] Failed to clone entry for copy', {
        error: error.message,
        source: sourcePath,
        dest: destPath
      });
      return { success: false, error: error.message };
    } finally {
      this._writeLock = null;
      releaseLock();
    }
  }
}

module.exports = AnalysisHistoryServiceCore;
