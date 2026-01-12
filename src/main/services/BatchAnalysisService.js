const { globalBatchProcessor } = require('../utils/llmOptimization');
const { logger } = require('../../shared/logger');

logger.setContext('BatchAnalysisService');
const { analyzeDocumentFile } = require('../analysis/ollamaDocumentAnalysis');
const { analyzeImageFile } = require('../analysis/ollamaImageAnalysis');
const { getInstance: getParallelEmbeddingService } = require('./ParallelEmbeddingService');
const embeddingQueue = require('../analysis/embeddingQueue');
const path = require('path');
const os = require('os');
const { get: getConfig } = require('../../shared/config/index');

const { getFileTypeCategory } = require('./autoOrganize/fileTypeUtils');

/**
 * BatchAnalysisService
 * Processes multiple files in parallel with intelligent concurrency control
 * Reduces total processing time by analyzing files concurrently
 *
 * FIX: Now integrates with ParallelEmbeddingService for improved embedding throughput
 */
class BatchAnalysisService {
  constructor(options = {}) {
    // Get max concurrency from unified config
    const configMaxConcurrency = getConfig('ANALYSIS.maxConcurrency', 3);
    const configRetryAttempts = getConfig('ANALYSIS.retryAttempts', 3);

    // Calculate optimal concurrency based on CPU cores if not specified
    this.concurrency =
      options.concurrency || Math.min(this.calculateOptimalConcurrency(), configMaxConcurrency);
    this.batchProcessor = globalBatchProcessor;
    this.batchProcessor.concurrencyLimit = this.concurrency;

    // FIX: Initialize parallel embedding service for batch embedding operations
    this.parallelEmbeddingService = getParallelEmbeddingService({
      concurrencyLimit: Math.min(this.concurrency, 5), // Embedding concurrency capped at 5
      maxRetries: configRetryAttempts
    });

    // FIX: Track embedding progress for comprehensive reporting
    this._embeddingProgressUnsubscribe = null;

    logger.info('[BATCH-ANALYSIS] Service initialized', {
      concurrency: this.concurrency,
      embeddingConcurrency: this.parallelEmbeddingService.concurrencyLimit,
      cpuCores: os.cpus().length
    });
  }

  /**
   * Calculate optimal concurrency based on system resources
   * @returns {number} Optimal concurrency level
   */
  calculateOptimalConcurrency() {
    const cpuCores = os.cpus().length;
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    // FIX: Prevent division by zero and clamp to valid range (VMs/containers may report freeMem > totalMem)
    const memUsage = totalMem > 0 ? Math.max(0, Math.min(1, 1 - freeMem / totalMem)) : 0.5;

    // Base concurrency on CPU cores (75% utilization to leave headroom)
    let concurrency = Math.max(2, Math.floor(cpuCores * 0.75));

    // Reduce if memory pressure is high (>85% usage)
    if (memUsage > 0.85) {
      concurrency = Math.max(2, Math.floor(concurrency * 0.5));
      logger.warn('[BATCH-ANALYSIS] High memory usage detected, reducing concurrency', {
        memUsage: `${(memUsage * 100).toFixed(1)}%`,
        reducedConcurrency: concurrency
      });
    }

    // Cap at reasonable maximum to avoid overwhelming Ollama
    concurrency = Math.min(concurrency, 8);

    logger.debug('[BATCH-ANALYSIS] Calculated optimal concurrency', {
      cpuCores,
      memUsage: `${(memUsage * 100).toFixed(1)}%`,
      concurrency
    });

    return concurrency;
  }

  /**
   * Analyze multiple files in parallel
   * FIX: Enhanced with improved progress tracking and embedding statistics
   * @param {Array} filePaths - Array of file paths to analyze
   * @param {Array} smartFolders - Smart folders for categorization
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Results with success/error details
   */
  async analyzeFiles(filePaths, smartFolders = [], options = {}) {
    const {
      onProgress = null,
      onEmbeddingProgress = null,
      stopOnError = false,
      concurrency: rawConcurrency = this.concurrency
    } = options;

    // FIX: Validate concurrency to prevent invalid values (0, negative, NaN)
    const concurrency = Math.max(
      1,
      Math.min(
        Number.isFinite(rawConcurrency) ? rawConcurrency : this.concurrency,
        8 // Cap at 8 to prevent overwhelming system
      )
    );

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return {
        success: true,
        results: [],
        errors: [],
        total: 0
      };
    }

    logger.info('[BATCH-ANALYSIS] Starting batch file analysis', {
      fileCount: filePaths.length,
      concurrency,
      smartFolders: smartFolders.length
    });

    const startTime = Date.now();

    // FIX: Subscribe to embedding queue progress if callback provided
    if (onEmbeddingProgress) {
      this._embeddingProgressUnsubscribe = embeddingQueue.onProgress(onEmbeddingProgress);
    }

    // FIX: Track embedding statistics for this batch
    const embeddingStats = {
      startQueueSize: embeddingQueue.getStats().queueLength,
      embeddings: 0
    };

    // Process each file
    const processFile = async (filePath, index) => {
      try {
        const extension = path.extname(filePath).toLowerCase();
        const isImage = this.isImageFile(extension);

        logger.debug('[BATCH-ANALYSIS] Processing file', {
          index,
          path: filePath,
          type: isImage ? 'image' : 'document'
        });

        let result;
        if (isImage) {
          result = await analyzeImageFile(filePath, smartFolders);
        } else {
          result = await analyzeDocumentFile(filePath, smartFolders);
        }

        // Track embedding count
        embeddingStats.embeddings++;

        return {
          filePath,
          success: true,
          result,
          type: isImage ? 'image' : 'document'
        };
      } catch (error) {
        logger.error('[BATCH-ANALYSIS] File analysis failed', {
          index,
          path: filePath,
          error: error.message
        });

        return {
          filePath,
          success: false,
          error: error.message,
          result: null
        };
      }
    };

    // Use batch processor for parallel processing
    const batchResult = await this.batchProcessor.processBatch(filePaths, processFile, {
      concurrency,
      onProgress: onProgress
        ? (progress) => {
            // FIX: Enhanced progress with embedding info
            const queueStats = embeddingQueue.getStats();
            onProgress({
              ...progress,
              phase: 'analysis',
              embeddingQueueSize: queueStats.queueLength,
              embeddingQueueCapacity: queueStats.capacityPercent
            });
          }
        : null,
      stopOnError
    });

    const analysisDuration = Date.now() - startTime;

    // FIX: Report analysis phase complete
    if (onProgress) {
      onProgress({
        phase: 'flushing_embeddings',
        completed: filePaths.length,
        total: filePaths.length,
        percent: 100,
        message: 'Flushing embeddings to database...'
      });
    }

    // CRITICAL FIX: Flush any remaining embeddings in queue after batch analysis completes
    // This ensures all embeddings are persisted even if batch size wasn't reached
    const flushStartTime = Date.now();
    try {
      const {
        flushAllEmbeddings: flushDocumentEmbeddings
      } = require('../analysis/ollamaDocumentAnalysis');
      const {
        flushAllEmbeddings: flushImageEmbeddings
      } = require('../analysis/ollamaImageAnalysis');

      // Flush both queues to ensure all embeddings are persisted
      await Promise.allSettled([
        flushDocumentEmbeddings().catch((error) => {
          logger.warn('[BATCH-ANALYSIS] Failed to flush document embeddings', {
            error: error.message
          });
        }),
        flushImageEmbeddings().catch((error) => {
          logger.warn('[BATCH-ANALYSIS] Failed to flush image embeddings', {
            error: error.message
          });
        })
      ]);
    } catch (error) {
      // Non-fatal - log but don't fail batch
      logger.warn('[BATCH-ANALYSIS] Error flushing embedding queues', {
        error: error.message
      });
    }
    const flushDuration = Date.now() - flushStartTime;

    // FIX: Unsubscribe from embedding progress
    if (this._embeddingProgressUnsubscribe) {
      this._embeddingProgressUnsubscribe();
      this._embeddingProgressUnsubscribe = null;
    }

    const totalDuration = Date.now() - startTime;
    const avgTime = totalDuration / filePaths.length;

    // FIX: Get final embedding stats
    const finalQueueStats = embeddingQueue.getStats();
    const embeddingServiceStats = this.parallelEmbeddingService.getStats();

    // Aggregate error details for better debugging
    const errorDetails = batchResult.results
      .filter((r) => !r.success || r.error)
      .map((r) => ({
        file: r.filePath || r.path || r.name,
        error: r.error?.message || r.error || 'Unknown error',
        code: r.error?.code
      }));

    if (errorDetails.length > 0) {
      logger.warn(`[BATCH-ANALYSIS] ${errorDetails.length} files failed analysis`, {
        failedCount: errorDetails.length,
        errors: errorDetails.slice(0, 10) // Log first 10 for brevity
      });
    }

    logger.info('[BATCH-ANALYSIS] Batch analysis complete', {
      total: filePaths.length,
      successful: batchResult.successful,
      failed: batchResult.errors.length,
      analysisDuration: `${analysisDuration}ms`,
      flushDuration: `${flushDuration}ms`,
      totalDuration: `${totalDuration}ms`,
      avgPerFile: `${Math.round(avgTime)}ms`,
      // FIX H-3: Guard against division by zero when processing is instant
      throughput:
        totalDuration > 0
          ? `${(filePaths.length / (totalDuration / 1000)).toFixed(2)} files/sec`
          : 'instant',
      embeddingStats: {
        queueProcessed: embeddingStats.startQueueSize - finalQueueStats.queueLength,
        remainingInQueue: finalQueueStats.queueLength,
        failedItems: finalQueueStats.failedItemsCount
      }
    });

    return {
      success: batchResult.errors.length === 0,
      results: batchResult.results,
      errors: batchResult.errors,
      total: filePaths.length,
      successful: batchResult.successful,
      hasErrors: batchResult.errors.length > 0,
      errorSummary: errorDetails,
      stats: {
        totalDuration,
        analysisDuration,
        flushDuration,
        avgPerFile: avgTime,
        // FIX H-3: Guard against division by zero
        filesPerSecond: totalDuration > 0 ? filePaths.length / (totalDuration / 1000) : Infinity,
        embedding: {
          queueSize: finalQueueStats.queueLength,
          failedItems: finalQueueStats.failedItemsCount,
          deadLetterItems: finalQueueStats.deadLetterCount,
          serviceStats: embeddingServiceStats
        }
      }
    };
  }

  /**
   * Analyze files grouped by type for better caching
   * Groups similar files together to maximize cache hits
   */
  async analyzeFilesGrouped(filePaths, smartFolders = [], options = {}) {
    // Group files by extension for better caching
    const groups = this.groupFilesByType(filePaths);

    logger.info('[BATCH-ANALYSIS] Analyzing files in groups', {
      totalFiles: filePaths.length,
      groups: Object.keys(groups).length
    });

    const allResults = {
      results: [],
      errors: [],
      successful: 0,
      total: filePaths.length
    };

    // Process each group
    for (const [type, files] of Object.entries(groups)) {
      logger.info(`[BATCH-ANALYSIS] Processing ${type} group`, {
        count: files.length
      });

      const groupResult = await this.analyzeFiles(files, smartFolders, options);

      // Merge results
      allResults.results.push(...groupResult.results);
      allResults.errors.push(...groupResult.errors);
      allResults.successful += groupResult.successful;
    }

    return {
      success: allResults.errors.length === 0,
      ...allResults
    };
  }

  /**
   * Group files by extension type
   */
  groupFilesByType(filePaths) {
    const groups = {};

    filePaths.forEach((filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      const type = this.getFileType(ext);

      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(filePath);
    });

    return groups;
  }

  /**
   * Get file type category
   */
  getFileType(extension) {
    const category = getFileTypeCategory(extension);
    // Map new centralized categories (Capitalized Plural) to legacy service format (lowercase singular)
    const mapping = {
      Images: 'image',
      Documents: 'document',
      Spreadsheets: 'spreadsheet',
      Presentations: 'presentation'
    };
    return mapping[category] || 'other';
  }

  /**
   * Check if file is an image
   */
  isImageFile(extension) {
    return getFileTypeCategory(extension) === 'Images';
  }

  /**
   * Set concurrency level
   */
  setConcurrency(concurrency) {
    this.concurrency = Math.max(1, Math.min(concurrency, 10)); // Limit 1-10
    this.batchProcessor.concurrencyLimit = this.concurrency;
    logger.info('[BATCH-ANALYSIS] Concurrency updated', {
      concurrency: this.concurrency
    });
  }

  /**
   * Get current processing statistics
   * FIX: Enhanced with embedding service and queue statistics
   */
  getStats() {
    const queueStats = embeddingQueue.getStats();
    const embeddingServiceStats = this.parallelEmbeddingService.getStats();

    return {
      concurrency: this.concurrency,
      ...this.batchProcessor.getStats(),
      embedding: {
        queue: queueStats,
        service: embeddingServiceStats
      }
    };
  }

  /**
   * Get embedding queue statistics
   * @returns {Object} Queue statistics
   */
  getEmbeddingQueueStats() {
    return embeddingQueue.getStats();
  }

  /**
   * Get parallel embedding service statistics
   * @returns {Object} Service statistics
   */
  getEmbeddingServiceStats() {
    return this.parallelEmbeddingService.getStats();
  }

  /**
   * Set embedding concurrency limit
   * @param {number} limit - New concurrency limit (1-10)
   */
  setEmbeddingConcurrency(limit) {
    this.parallelEmbeddingService.setConcurrencyLimit(limit);
    logger.info('[BATCH-ANALYSIS] Embedding concurrency updated', {
      embeddingConcurrency: this.parallelEmbeddingService.concurrencyLimit
    });
  }

  /**
   * Force flush the embedding queue
   * Useful for ensuring all embeddings are persisted before shutdown
   * @returns {Promise<void>}
   */
  async flushEmbeddings() {
    logger.info('[BATCH-ANALYSIS] Force flushing embedding queue');
    await embeddingQueue.forceFlush();
  }

  /**
   * Graceful shutdown - flush embeddings and cleanup
   * @returns {Promise<void>}
   */
  async shutdown() {
    logger.info('[BATCH-ANALYSIS] Shutting down...');

    // Unsubscribe from progress events
    if (this._embeddingProgressUnsubscribe) {
      this._embeddingProgressUnsubscribe();
      this._embeddingProgressUnsubscribe = null;
    }

    // Flush embeddings
    await embeddingQueue.shutdown();

    logger.info('[BATCH-ANALYSIS] Shutdown complete');
  }
}

module.exports = BatchAnalysisService;
