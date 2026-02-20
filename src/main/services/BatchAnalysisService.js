const { globalBatchProcessor } = require('../utils/llmOptimization');
const { createLogger } = require('../../shared/logger');
const { Semaphore, delay } = require('../../shared/promiseUtils');

const logger = createLogger('BatchAnalysisService');
const { analyzeDocumentFile } = require('../analysis/documentAnalysis');
const { analyzeImageFile } = require('../analysis/imageAnalysis');
const { getInstance: getParallelEmbeddingService } = require('./ParallelEmbeddingService');
const { analysisQueue } = require('../analysis/embeddingQueue/stageQueues');
const embeddingQueueManager = require('../analysis/embeddingQueue/queueManager');
const path = require('path');
const os = require('os');
const { get: getConfig } = require('../../shared/config/index');
const { getInstance: getLlamaService } = require('./LlamaService');
const { getRecommendedConcurrency } = require('./PerformanceService');
const { getInstance: getModelAccessCoordinator } = require('./ModelAccessCoordinator');

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

    // Store the initial config but always access the live singleton via getter
    // to avoid holding a stale reference if the service is reset/recreated.
    this._embeddingServiceConfig = {
      concurrencyLimit: Math.min(this.concurrency, 5),
      maxRetries: configRetryAttempts
    };
    // Ensure singleton is created with initial config
    getParallelEmbeddingService(this._embeddingServiceConfig);

    // Ensures only one worker checks the queue capacity at a time, preventing "check-then-act" races
    this.backpressureLock = new Semaphore(1);

    this._embeddingProgressUnsubscribe = null;
    this._backpressureWaitPromise = null;
    this._adaptiveRecommendation = null;
    this._adaptiveRecommendationAt = 0;
    this._adaptiveRecommendationTtlMs = 30000;

    logger.info('[BATCH-ANALYSIS] Service initialized', {
      concurrency: this.concurrency,
      embeddingConcurrency: this._embeddingServiceConfig.concurrencyLimit,
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

    // Cap at global AI semaphore limit (3) to avoid holding memory while waiting for slots
    concurrency = Math.min(concurrency, 3);

    logger.debug('[BATCH-ANALYSIS] Calculated optimal concurrency', {
      cpuCores,
      memUsage: `${(memUsage * 100).toFixed(1)}%`,
      concurrency
    });

    return concurrency;
  }

  /**
   * Deterministically partition files into document and image sections.
   * Preserves input order inside each modality lane.
   * @param {string[]} filePaths
   * @returns {{ documents: string[], images: string[] }}
   */
  partitionFilesByModality(filePaths) {
    const documents = [];
    const images = [];

    for (const filePath of filePaths) {
      const extension = path.extname(filePath).toLowerCase();
      if (this.isImageFile(extension)) {
        images.push(filePath);
      } else {
        documents.push(filePath);
      }
    }

    return { documents, images };
  }

  _resolveSectionOrder(option) {
    if (option === 'images-first') {
      return ['images', 'documents'];
    }
    return ['documents', 'images'];
  }

  _safeCoordinatorQueueStats() {
    try {
      return getModelAccessCoordinator()?.getQueueStats?.() || null;
    } catch (error) {
      logger.debug('[BATCH-ANALYSIS] Failed to read coordinator queue stats', {
        error: error?.message
      });
      return null;
    }
  }

  async _getAdaptiveConcurrency(requestedConcurrency) {
    let capped = requestedConcurrency;
    let perfRecommendation = null;

    try {
      const now = Date.now();
      if (
        this._adaptiveRecommendation &&
        now - this._adaptiveRecommendationAt < this._adaptiveRecommendationTtlMs
      ) {
        perfRecommendation = this._adaptiveRecommendation;
      } else {
        perfRecommendation = await getRecommendedConcurrency();
        this._adaptiveRecommendation = perfRecommendation;
        this._adaptiveRecommendationAt = now;
      }

      if (
        Number.isFinite(perfRecommendation?.maxConcurrent) &&
        perfRecommendation.maxConcurrent > 0
      ) {
        capped = Math.min(capped, perfRecommendation.maxConcurrent);
      }
    } catch (error) {
      logger.debug('[BATCH-ANALYSIS] Performance-based concurrency recommendation unavailable', {
        error: error?.message
      });
    }

    const queueStats = this._safeCoordinatorQueueStats();
    if (queueStats) {
      const modelTypes = Object.keys(queueStats);
      const totalQueued = modelTypes.reduce(
        (sum, type) => sum + (Number(queueStats[type]?.queued) || 0),
        0
      );
      const totalPending = modelTypes.reduce(
        (sum, type) => sum + (Number(queueStats[type]?.pending) || 0),
        0
      );
      const visionPressure =
        (Number(queueStats.vision?.queued) || 0) + (Number(queueStats.vision?.pending) || 0);

      if (visionPressure > 0) {
        capped = Math.min(capped, 1);
      } else if (totalQueued + totalPending >= 4) {
        capped = Math.min(capped, 2);
      }
    }

    const adaptiveConcurrency = Math.max(1, Math.min(Number(capped) || 1, 8));

    logger.debug('[BATCH-ANALYSIS] Adaptive concurrency resolved', {
      requestedConcurrency,
      adaptiveConcurrency,
      perfMaxConcurrent: perfRecommendation?.maxConcurrent ?? null
    });

    return adaptiveConcurrency;
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
      concurrency: rawConcurrency = this.concurrency,
      sectionOrder = 'documents-first',
      documentAnalyzer = null,
      imageAnalyzer = null,
      onFileComplete = null,
      disableAdaptiveConcurrency = false
    } = options;

    const requestedConcurrency = Math.max(
      1,
      Math.min(Number.isFinite(rawConcurrency) ? rawConcurrency : this.concurrency, 8)
    );
    const concurrency = disableAdaptiveConcurrency
      ? requestedConcurrency
      : await this._getAdaptiveConcurrency(requestedConcurrency);

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return {
        success: true,
        results: [],
        errors: [],
        total: 0
      };
    }

    const partitioned = this.partitionFilesByModality(filePaths);
    const orderedSections = this._resolveSectionOrder(sectionOrder).filter(
      (section) => partitioned[section]?.length > 0
    );

    logger.info('[BATCH-ANALYSIS] Starting batch file analysis', {
      fileCount: filePaths.length,
      requestedConcurrency,
      concurrency,
      sectionOrder: orderedSections,
      documentCount: partitioned.documents.length,
      imageCount: partitioned.images.length,
      smartFolders: smartFolders.length
    });

    const startTime = Date.now();
    const progressState = {
      total: filePaths.length,
      completed: 0,
      documentsTotal: partitioned.documents.length,
      imagesTotal: partitioned.images.length,
      documentsCompleted: 0,
      imagesCompleted: 0,
      docInFlight: 0,
      imageInFlight: 0
    };
    const sectionStats = {
      documents: { total: partitioned.documents.length, durationMs: 0, successful: 0, failed: 0 },
      images: { total: partitioned.images.length, durationMs: 0, successful: 0, failed: 0 }
    };
    const embeddingStats = {
      startQueueSize: analysisQueue.getStats().queueLength,
      embeddings: 0
    };

    let embeddingProgressUnsubscribe = null;
    if (onEmbeddingProgress) {
      embeddingProgressUnsubscribe = analysisQueue.onProgress(onEmbeddingProgress);
    }

    try {
      if (onProgress) {
        onProgress({
          ...this._buildProgressSnapshot(progressState, 'partitioned'),
          message: `Partitioned ${partitioned.documents.length} documents and ${partitioned.images.length} images`,
          sectionOrder: orderedSections
        });
      }

      const sectionResults = [];
      for (const section of orderedSections) {
        const sectionFiles = partitioned[section];
        const sectionIsImage = section === 'images';
        const sectionConcurrency = Math.max(1, Math.min(concurrency, sectionFiles.length || 1));
        const sectionStart = Date.now();
        const visionBatchModeEnabled =
          options.enableVisionBatchMode ?? process.env.NODE_ENV !== 'test';
        const shouldUseVisionBatchMode =
          sectionIsImage && visionBatchModeEnabled && sectionFiles.length > 1;
        let visionBatchModeEntered = false;

        if (shouldUseVisionBatchMode) {
          try {
            await getLlamaService().enterVisionBatchMode();
            visionBatchModeEntered = true;
            logger.info('[BATCH-ANALYSIS] Entered vision batch mode for image section', {
              imageCount: sectionFiles.length
            });
          } catch (error) {
            logger.warn('[BATCH-ANALYSIS] Failed to enter vision batch mode, continuing', {
              error: error?.message
            });
          }
        }

        try {
          const sectionResult = await this._analyzeSection(sectionFiles, smartFolders, {
            section,
            sectionConcurrency,
            stopOnError,
            onProgress,
            onFileComplete,
            progressState,
            embeddingStats,
            analyzers: {
              document: documentAnalyzer,
              image: imageAnalyzer
            }
          });

          sectionResults.push(sectionResult);
          sectionStats[section].durationMs = Date.now() - sectionStart;
          sectionStats[section].successful = sectionResult.successful;
          sectionStats[section].failed = sectionResult.errors.length;

          if (stopOnError && sectionResult.errors.length > 0) {
            logger.warn('[BATCH-ANALYSIS] Stopping early after section error', {
              section,
              failed: sectionResult.errors.length
            });
            break;
          }
        } finally {
          if (visionBatchModeEntered) {
            try {
              await getLlamaService().exitVisionBatchMode();
              logger.info('[BATCH-ANALYSIS] Exited vision batch mode after image section');
            } catch (error) {
              logger.warn('[BATCH-ANALYSIS] Failed to exit vision batch mode', {
                error: error?.message
              });
            }
          }
        }
      }

      const combinedResults = sectionResults.flatMap((result) => result.results || []);
      const combinedErrors = sectionResults.flatMap((result) => result.errors || []);
      const resultByPath = new Map();
      for (const result of combinedResults) {
        if (result?.filePath) {
          resultByPath.set(result.filePath, result);
        }
      }
      const orderedResults = filePaths
        .map((filePath) => resultByPath.get(filePath))
        .filter(Boolean);
      const successful = orderedResults.filter((result) => result.success).length;

      return await this._finalizeBatch({
        filePaths,
        startTime,
        onProgress,
        embeddingStats,
        orderedResults,
        combinedErrors,
        successful,
        concurrency,
        requestedConcurrency,
        sectionStats
      });
    } finally {
      if (embeddingProgressUnsubscribe) {
        embeddingProgressUnsubscribe();
      }
    }
  }

  async _analyzeSection(filePaths, smartFolders, options) {
    const {
      section,
      sectionConcurrency,
      stopOnError,
      onProgress,
      onFileComplete,
      progressState,
      embeddingStats,
      analyzers
    } = options;
    const isImageSection = section === 'images';

    const analyzer =
      (isImageSection ? analyzers?.image : analyzers?.document) ||
      (isImageSection ? analyzeImageFile : analyzeDocumentFile);

    const BACKPRESSURE_TIMEOUT_MS = 60000;
    const BACKPRESSURE_INITIAL_DELAY_MS = 500;
    const BACKPRESSURE_MAX_DELAY_MS = 5000;

    const checkBackpressure = async () => {
      let shouldWait = false;
      await this.backpressureLock.acquire();
      try {
        const stats = analysisQueue.getStats();
        if (stats.capacityPercent >= 75) {
          shouldWait = true;
          logger.warn('[BATCH-ANALYSIS] Backpressure: embedding queue at capacity', {
            capacityPercent: stats.capacityPercent,
            queueLength: stats.queueLength
          });
        }
      } finally {
        this.backpressureLock.release();
      }

      if (!shouldWait) {
        return;
      }

      if (!this._backpressureWaitPromise) {
        this._backpressureWaitPromise = (async () => {
          const backpressureStart = Date.now();
          let backpressureDelay = BACKPRESSURE_INITIAL_DELAY_MS;
          let iterations = 0;
          let lastQueueLength = -1;
          let stalledChecks = 0;

          while (true) {
            const elapsed = Date.now() - backpressureStart;
            if (elapsed >= BACKPRESSURE_TIMEOUT_MS) {
              logger.warn('[BATCH-ANALYSIS] Backpressure timeout reached, continuing anyway', {
                elapsed
              });
              break;
            }

            await delay(backpressureDelay);
            backpressureDelay = Math.min(backpressureDelay * 1.5, BACKPRESSURE_MAX_DELAY_MS);
            iterations++;

            let stillFull = false;
            await this.backpressureLock.acquire();
            try {
              const currentStats = analysisQueue.getStats();

              // Check if queue is actually draining
              // If queue length hasn't decreased (and we are waiting), it might be stalled
              if (lastQueueLength !== -1 && currentStats.queueLength >= lastQueueLength) {
                stalledChecks++;
              } else {
                stalledChecks = 0;
              }
              lastQueueLength = currentStats.queueLength;

              // If queue hasn't moved for 5 consecutive checks, assume consumer is dead/stuck and proceed
              // This prevents the batch from hanging for 60s per file
              if (stalledChecks >= 5) {
                logger.warn(
                  '[BATCH-ANALYSIS] Embedding queue appears stalled (not draining), bypassing backpressure',
                  {
                    queueLength: currentStats.queueLength,
                    stalledChecks
                  }
                );
                break;
              }

              if (currentStats.capacityPercent > 50) {
                stillFull = true;
                if (iterations % 10 === 0) {
                  logger.debug('[BATCH-ANALYSIS] Waiting for embedding queue to drain', {
                    elapsed,
                    capacityPercent: currentStats.capacityPercent,
                    iterations
                  });
                }
              }
            } finally {
              this.backpressureLock.release();
            }

            if (!stillFull) {
              logger.info('[BATCH-ANALYSIS] Embedding queue drained, resuming analysis', {
                waitTime: Date.now() - backpressureStart
              });
              break;
            }
          }
        })().finally(() => {
          this._backpressureWaitPromise = null;
        });
      }

      await this._backpressureWaitPromise;
    };

    const processFile = async (filePath, index) => {
      const inFlightKey = isImageSection ? 'imageInFlight' : 'docInFlight';
      const completedKey = isImageSection ? 'imagesCompleted' : 'documentsCompleted';

      progressState[inFlightKey] += 1;
      this._emitProgressUpdate(onProgress, progressState, 'analysis', {
        section,
        currentFile: filePath,
        sectionCurrent: index + 1,
        sectionTotal: filePaths.length
      });

      try {
        await checkBackpressure();
        const result = await analyzer(filePath, smartFolders);
        embeddingStats.embeddings += 1;

        const normalized = {
          filePath,
          success: true,
          result,
          type: isImageSection ? 'image' : 'document'
        };

        if (typeof onFileComplete === 'function') {
          onFileComplete(normalized);
        }

        return normalized;
      } catch (error) {
        const normalized = {
          filePath,
          success: false,
          error: error?.message || 'Unknown error',
          result: null,
          type: isImageSection ? 'image' : 'document'
        };

        logger.error('[BATCH-ANALYSIS] File analysis failed', {
          index,
          path: filePath,
          section,
          error: normalized.error
        });

        if (typeof onFileComplete === 'function') {
          onFileComplete(normalized);
        }

        return normalized;
      } finally {
        progressState[inFlightKey] = Math.max(0, progressState[inFlightKey] - 1);
        progressState[completedKey] += 1;
        progressState.completed += 1;
        this._emitProgressUpdate(onProgress, progressState, 'analysis', {
          section,
          currentFile: filePath,
          sectionCurrent: Math.min(progressState[completedKey], filePaths.length),
          sectionTotal: filePaths.length
        });
      }
    };

    const batchResult = await this.batchProcessor.processBatch(filePaths, processFile, {
      concurrency: sectionConcurrency,
      stopOnError
    });

    const failedResults = (batchResult.results || []).filter((result) => result?.success === false);
    const normalizedErrors = [
      ...(batchResult.errors || []),
      ...failedResults.map((result) => ({
        filePath: result.filePath,
        error: result.error
      }))
    ];
    const successful = (batchResult.results || []).filter((result) => result?.success).length;

    return {
      ...batchResult,
      successful,
      errors: normalizedErrors
    };
  }

  _buildProgressSnapshot(progressState, phase) {
    const queueStats = analysisQueue.getStats();
    const percent =
      progressState.total > 0
        ? Math.round((progressState.completed / progressState.total) * 100)
        : 0;

    return {
      phase,
      completed: progressState.completed,
      total: progressState.total,
      percent,
      percentage: percent,
      docCompleted: progressState.documentsCompleted,
      imageCompleted: progressState.imagesCompleted,
      documentsTotal: progressState.documentsTotal,
      imagesTotal: progressState.imagesTotal,
      docInFlight: progressState.docInFlight,
      imageInFlight: progressState.imageInFlight,
      embeddingQueueSize: queueStats.queueLength,
      embeddingQueueCapacity: queueStats.capacityPercent
    };
  }

  _emitProgressUpdate(onProgress, progressState, phase, extra = {}) {
    if (!onProgress) return;
    onProgress({
      ...this._buildProgressSnapshot(progressState, phase),
      ...extra
    });
  }

  async _flushEmbeddings() {
    const flushStartTime = Date.now();
    try {
      const {
        flushAllEmbeddings: flushDocumentEmbeddings
      } = require('../analysis/documentAnalysis');
      const { flushAllEmbeddings: flushImageEmbeddings } = require('../analysis/imageAnalysis');

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
      logger.warn('[BATCH-ANALYSIS] Error flushing embedding queues', {
        error: error.message
      });
    }
    return Date.now() - flushStartTime;
  }

  async _finalizeBatch({
    filePaths,
    startTime,
    onProgress,
    embeddingStats,
    orderedResults,
    combinedErrors,
    successful,
    concurrency,
    requestedConcurrency,
    sectionStats
  }) {
    const analysisDuration = Date.now() - startTime;

    if (onProgress) {
      onProgress({
        phase: 'flushing_embeddings',
        completed: filePaths.length,
        total: filePaths.length,
        percent: 100,
        percentage: 100,
        message: 'Flushing embeddings to database...'
      });
    }

    const flushDuration = await this._flushEmbeddings();
    const totalDuration = Date.now() - startTime;
    const avgTime = filePaths.length > 0 ? totalDuration / filePaths.length : 0;
    const finalQueueStats = analysisQueue.getStats();
    const embeddingServiceStats = getParallelEmbeddingService().getStats();

    const errorDetails = orderedResults
      .filter((result) => !result?.success || result?.error)
      .map((result) => ({
        file: result?.filePath || result?.path || result?.name,
        error: result?.error?.message || result?.error || 'Unknown error',
        code: result?.error?.code
      }));

    if (errorDetails.length > 0) {
      logger.warn(`[BATCH-ANALYSIS] ${errorDetails.length} files failed analysis`, {
        failedCount: errorDetails.length,
        errors: errorDetails.slice(0, 10)
      });
    }

    logger.info('[BATCH-ANALYSIS] Batch analysis complete', {
      total: filePaths.length,
      successful,
      failed: combinedErrors.length,
      requestedConcurrency,
      effectiveConcurrency: concurrency,
      analysisDuration: `${analysisDuration}ms`,
      flushDuration: `${flushDuration}ms`,
      totalDuration: `${totalDuration}ms`,
      avgPerFile: `${Math.round(avgTime)}ms`,
      throughput:
        totalDuration > 0
          ? `${(filePaths.length / (totalDuration / 1000)).toFixed(2)} files/sec`
          : 'instant',
      sectionStats,
      embeddingStats: {
        queueProcessed: embeddingStats.startQueueSize - finalQueueStats.queueLength,
        remainingInQueue: finalQueueStats.queueLength,
        failedItems: finalQueueStats.failedItemsCount
      }
    });

    return {
      success: combinedErrors.length === 0,
      results: orderedResults,
      errors: combinedErrors,
      total: filePaths.length,
      successful,
      hasErrors: combinedErrors.length > 0,
      errorSummary: errorDetails,
      stats: {
        requestedConcurrency,
        effectiveConcurrency: concurrency,
        totalDuration,
        analysisDuration,
        flushDuration,
        avgPerFile: avgTime,
        filesPerSecond: totalDuration > 0 ? filePaths.length / (totalDuration / 1000) : Infinity,
        modalities: sectionStats,
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
    const groupEntries = Object.entries(groups);
    const rawGroupConcurrency = Number.isFinite(options.groupConcurrency)
      ? options.groupConcurrency
      : 1;
    const groupConcurrency = Math.max(
      1,
      Math.min(Math.floor(rawGroupConcurrency), groupEntries.length || 1)
    );

    logger.info('[BATCH-ANALYSIS] Analyzing files in groups', {
      totalFiles: filePaths.length,
      groups: Object.keys(groups).length,
      groupConcurrency
    });

    const allResults = {
      results: [],
      errors: [],
      successful: 0,
      total: filePaths.length
    };

    for (let i = 0; i < groupEntries.length; i += groupConcurrency) {
      const groupSlice = groupEntries.slice(i, i + groupConcurrency);
      const groupResults = await Promise.allSettled(
        groupSlice.map(([type, files]) => {
          logger.info(`[BATCH-ANALYSIS] Processing ${type} group`, { count: files.length });
          return this.analyzeFiles(files, smartFolders, options);
        })
      );

      // Merge results from this bounded-concurrency slice
      for (const result of groupResults) {
        if (result.status === 'fulfilled') {
          allResults.results.push(...result.value.results);
          allResults.errors.push(...result.value.errors);
          allResults.successful += result.value.successful;
        } else {
          logger.error('[BATCH-ANALYSIS] Group processing failed', {
            error: result.reason?.message
          });
        }
      }
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
    const queueStats = analysisQueue.getStats();
    const embeddingServiceStats = getParallelEmbeddingService().getStats();

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
    return analysisQueue.getStats();
  }

  /**
   * Get parallel embedding service statistics
   * @returns {Object} Service statistics
   */
  getEmbeddingServiceStats() {
    return getParallelEmbeddingService().getStats();
  }

  /**
   * Set embedding concurrency limit
   * @param {number} limit - New concurrency limit (1-10)
   */
  setEmbeddingConcurrency(limit) {
    getParallelEmbeddingService().setConcurrencyLimit(limit);
    logger.info('[BATCH-ANALYSIS] Embedding concurrency updated', {
      embeddingConcurrency: getParallelEmbeddingService().concurrencyLimit
    });
  }

  /**
   * Force flush the embedding queue
   * Useful for ensuring all embeddings are persisted before shutdown
   * @returns {Promise<void>}
   */
  async flushEmbeddings() {
    logger.info('[BATCH-ANALYSIS] Force flushing embedding queue');
    await embeddingQueueManager.forceFlush();
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
    await embeddingQueueManager.shutdown();

    logger.info('[BATCH-ANALYSIS] Shutdown complete');
  }
}

module.exports = BatchAnalysisService;
