const { globalBatchProcessor } = require('../utils/llmOptimization');
const { logger } = require('../../shared/logger');
const { analyzeDocumentFile } = require('../analysis/ollamaDocumentAnalysis');
const { analyzeImageFile } = require('../analysis/ollamaImageAnalysis');
const path = require('path');
const os = require('os');

/**
 * BatchAnalysisService
 * Processes multiple files in parallel with intelligent concurrency control
 * Reduces total processing time by analyzing files concurrently
 */
class BatchAnalysisService {
  constructor(options = {}) {
    // Calculate optimal concurrency based on CPU cores if not specified
    this.concurrency =
      options.concurrency || this.calculateOptimalConcurrency();
    this.batchProcessor = globalBatchProcessor;
    this.batchProcessor.concurrencyLimit = this.concurrency;

    logger.info('[BATCH-ANALYSIS] Service initialized', {
      concurrency: this.concurrency,
      cpuCores: os.cpus().length,
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
    const memUsage = 1 - freeMem / totalMem;

    // Base concurrency on CPU cores (75% utilization to leave headroom)
    let concurrency = Math.max(2, Math.floor(cpuCores * 0.75));

    // Reduce if memory pressure is high (>85% usage)
    if (memUsage > 0.85) {
      concurrency = Math.max(2, Math.floor(concurrency * 0.5));
      logger.warn(
        '[BATCH-ANALYSIS] High memory usage detected, reducing concurrency',
        {
          memUsage: `${(memUsage * 100).toFixed(1)}%`,
          reducedConcurrency: concurrency,
        },
      );
    }

    // Cap at reasonable maximum to avoid overwhelming Ollama
    concurrency = Math.min(concurrency, 8);

    logger.debug('[BATCH-ANALYSIS] Calculated optimal concurrency', {
      cpuCores,
      memUsage: `${(memUsage * 100).toFixed(1)}%`,
      concurrency,
    });

    return concurrency;
  }

  /**
   * Analyze multiple files in parallel
   * @param {Array} filePaths - Array of file paths to analyze
   * @param {Array} smartFolders - Smart folders for categorization
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Results with success/error details
   */
  async analyzeFiles(filePaths, smartFolders = [], options = {}) {
    const {
      onProgress = null,
      stopOnError = false,
      concurrency = this.concurrency,
    } = options;

    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return {
        success: true,
        results: [],
        errors: [],
        total: 0,
      };
    }

    logger.info('[BATCH-ANALYSIS] Starting batch file analysis', {
      fileCount: filePaths.length,
      concurrency,
      smartFolders: smartFolders.length,
    });

    const startTime = Date.now();

    // Process each file
    const processFile = async (filePath, index) => {
      try {
        const extension = path.extname(filePath).toLowerCase();
        const isImage = this.isImageFile(extension);

        logger.debug('[BATCH-ANALYSIS] Processing file', {
          index,
          path: filePath,
          type: isImage ? 'image' : 'document',
        });

        let result;
        if (isImage) {
          result = await analyzeImageFile(filePath, smartFolders);
        } else {
          result = await analyzeDocumentFile(filePath, smartFolders);
        }

        return {
          filePath,
          success: true,
          result,
          type: isImage ? 'image' : 'document',
        };
      } catch (error) {
        logger.error('[BATCH-ANALYSIS] File analysis failed', {
          index,
          path: filePath,
          error: error.message,
        });

        return {
          filePath,
          success: false,
          error: error.message,
          result: null,
        };
      }
    };

    // Use batch processor for parallel processing
    const batchResult = await this.batchProcessor.processBatch(
      filePaths,
      processFile,
      {
        concurrency,
        onProgress,
        stopOnError,
      },
    );

    const duration = Date.now() - startTime;
    const avgTime = duration / filePaths.length;

    logger.info('[BATCH-ANALYSIS] Batch analysis complete', {
      total: filePaths.length,
      successful: batchResult.successful,
      failed: batchResult.errors.length,
      duration: `${duration}ms`,
      avgPerFile: `${Math.round(avgTime)}ms`,
      speedup: `${Math.round(filePaths.length / (duration / 1000))} files/sec`,
    });

    return {
      success: batchResult.errors.length === 0,
      results: batchResult.results,
      errors: batchResult.errors,
      total: filePaths.length,
      successful: batchResult.successful,
      stats: {
        totalDuration: duration,
        avgPerFile: avgTime,
        filesPerSecond: filePaths.length / (duration / 1000),
      },
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
      groups: Object.keys(groups).length,
    });

    const allResults = {
      results: [],
      errors: [],
      successful: 0,
      total: filePaths.length,
    };

    // Process each group
    for (const [type, files] of Object.entries(groups)) {
      logger.info(`[BATCH-ANALYSIS] Processing ${type} group`, {
        count: files.length,
      });

      const groupResult = await this.analyzeFiles(files, smartFolders, options);

      // Merge results
      allResults.results.push(...groupResult.results);
      allResults.errors.push(...groupResult.errors);
      allResults.successful += groupResult.successful;
    }

    return {
      success: allResults.errors.length === 0,
      ...allResults,
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
    const imageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.svg',
      '.tiff',
      '.tif',
    ];
    const documentExtensions = ['.pdf', '.doc', '.docx', '.txt', '.rtf'];
    const spreadsheetExtensions = ['.xlsx', '.xls', '.csv'];
    const presentationExtensions = ['.pptx', '.ppt'];

    if (imageExtensions.includes(extension)) return 'image';
    if (documentExtensions.includes(extension)) return 'document';
    if (spreadsheetExtensions.includes(extension)) return 'spreadsheet';
    if (presentationExtensions.includes(extension)) return 'presentation';

    return 'other';
  }

  /**
   * Check if file is an image
   */
  isImageFile(extension) {
    const imageExtensions = [
      '.jpg',
      '.jpeg',
      '.png',
      '.gif',
      '.bmp',
      '.webp',
      '.svg',
      '.tiff',
      '.tif',
    ];
    return imageExtensions.includes(extension.toLowerCase());
  }

  /**
   * Set concurrency level
   */
  setConcurrency(concurrency) {
    this.concurrency = Math.max(1, Math.min(concurrency, 10)); // Limit 1-10
    this.batchProcessor.concurrencyLimit = this.concurrency;
    logger.info('[BATCH-ANALYSIS] Concurrency updated', {
      concurrency: this.concurrency,
    });
  }

  /**
   * Get current processing statistics
   */
  getStats() {
    return {
      concurrency: this.concurrency,
      ...this.batchProcessor.getStats(),
    };
  }
}

module.exports = BatchAnalysisService;
