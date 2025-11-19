const { logger } = require('../../shared/logger');
logger.setContext('AutoOrganizeService');
const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');

// LOW PRIORITY FIX (LOW-8): Make batch size configurable via constant
const DEFAULT_BATCH_SIZE = 10; // Default number of files to process per batch

/**
 * AutoOrganizeService - Handles automatic file organization
 * Uses the suggestion system behind the scenes for better accuracy
 * Only requires user intervention for low-confidence matches
 */
class AutoOrganizeService {
  constructor({
    suggestionService,
    settingsService,
    folderMatchingService,
    undoRedoService,
  }) {
    this.suggestionService = suggestionService;
    this.settings = settingsService;
    this.folderMatcher = folderMatchingService;
    this.undoRedo = undoRedoService;

    // Confidence thresholds for automatic organization
    this.thresholds = {
      autoApprove: 0.8, // Automatically approve >= 80% confidence
      requireReview: 0.5, // Require review for 50-79% confidence
      reject: 0.3, // Reject below 30% confidence
    };
  }

  /**
   * Automatically organize files based on their analysis
   * Uses batched suggestions for improved performance
   */
  async organizeFiles(files, smartFolders, options = {}) {
    const {
      confidenceThreshold = this.thresholds.autoApprove,
      defaultLocation = 'Documents',
      preserveNames = false,
      batchSize = DEFAULT_BATCH_SIZE, // LOW PRIORITY FIX (LOW-8): Use configurable constant
    } = options;

    logger.info('[AutoOrganize] Starting automatic organization', {
      fileCount: files.length,
      smartFolderCount: smartFolders.length,
      confidenceThreshold,
      batchSize,
    });

    const results = {
      organized: [],
      needsReview: [],
      failed: [],
      operations: [],
    };

    // Separate files with and without analysis
    const filesWithAnalysis = [];
    const filesWithoutAnalysis = [];

    for (const file of files) {
      if (!file.analysis) {
        filesWithoutAnalysis.push(file);
      } else {
        filesWithAnalysis.push(file);
      }
    }

    // Process files without analysis first (they use the default folder)
    if (filesWithoutAnalysis.length > 0) {
      await this._processFilesWithoutAnalysis(
        filesWithoutAnalysis,
        smartFolders,
        defaultLocation,
        results,
      );
    }

    // Process files with analysis in batches
    if (filesWithAnalysis.length > 0) {
      // Split into batches for efficient processing
      const batches = [];
      for (let i = 0; i < filesWithAnalysis.length; i += batchSize) {
        batches.push(filesWithAnalysis.slice(i, i + batchSize));
      }

      logger.info('[AutoOrganize] Processing files in batches', {
        totalFiles: filesWithAnalysis.length,
        batchCount: batches.length,
        batchSize,
      });

      // Process each batch
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        logger.debug('[AutoOrganize] Processing batch', {
          batchIndex: batchIndex + 1,
          totalBatches: batches.length,
          filesInBatch: batch.length,
        });

        try {
          // Get batch suggestions - this is the key optimization
          const batchSuggestions =
            await this.suggestionService.getBatchSuggestions(
              batch,
              smartFolders,
            );

          if (
            !batchSuggestions.success ||
            !batchSuggestions.groups ||
            batchSuggestions.groups.length === 0
          ) {
            // Fallback to individual processing if batch fails
            logger.warn(
              '[AutoOrganize] Batch suggestions failed or empty, falling back to individual processing',
            );
            await this._processFilesIndividually(
              batch,
              smartFolders,
              {
                confidenceThreshold,
                defaultLocation,
                preserveNames,
              },
              results,
            );
            continue;
          }

          // Process batch results
          await this._processBatchResults(
            batchSuggestions,
            batch,
            {
              confidenceThreshold,
              defaultLocation,
              preserveNames,
            },
            results,
          );

          // Check if any files from the batch weren't processed
          // This can happen if batch results don't include all files
          const processedFileNames = new Set();
          for (const group of batchSuggestions.groups) {
            for (const fileWithSuggestion of group.files) {
              processedFileNames.add(fileWithSuggestion.name);
            }
          }

          // Process any unprocessed files individually as fallback
          const unprocessedFiles = batch.filter(
            (f) => !processedFileNames.has(f.name),
          );
          if (unprocessedFiles.length > 0) {
            logger.debug(
              '[AutoOrganize] Some files not in batch results, processing individually',
              { count: unprocessedFiles.length },
            );
            await this._processFilesIndividually(
              unprocessedFiles,
              smartFolders,
              {
                confidenceThreshold,
                defaultLocation,
                preserveNames,
              },
              results,
            );
          }
        } catch (error) {
          logger.error('[AutoOrganize] Batch processing failed', {
            batchIndex: batchIndex + 1,
            error: error.message,
          });

          // Fallback to individual processing for this batch
          await this._processFilesIndividually(
            batch,
            smartFolders,
            {
              confidenceThreshold,
              defaultLocation,
              preserveNames,
            },
            results,
          );
        }
      }
    }

    // Log summary
    logger.info('[AutoOrganize] Organization complete', {
      organized: results.organized.length,
      needsReview: results.needsReview.length,
      failed: results.failed.length,
    });

    return results;
  }

  /**
   * Process batch suggestion results
   */
  async _processBatchResults(batchSuggestions, files, options, results) {
    const { confidenceThreshold, defaultLocation, preserveNames } = options;

    // Create a map of files by name for quick lookup
    const fileMap = new Map(files.map((f) => [f.name, f]));

    for (const group of batchSuggestions.groups) {
      for (const fileWithSuggestion of group.files) {
        const file = fileMap.get(fileWithSuggestion.name) || fileWithSuggestion;
        const suggestion = fileWithSuggestion.suggestion;
        const confidence = group.confidence || 0;

        if (!suggestion) {
          // Use fallback if no suggestion
          const fallbackDestination = this.getFallbackDestination(
            file,
            [],
            defaultLocation,
          );

          results.organized.push({
            file,
            destination: fallbackDestination,
            confidence: 0.3,
            method: 'batch-fallback',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination: fallbackDestination,
          });
          continue;
        }

        // Determine action based on confidence
        if (confidence >= confidenceThreshold) {
          // High confidence - organize automatically
          const destination = this.buildDestinationPath(
            file,
            suggestion,
            defaultLocation,
            preserveNames,
          );

          results.organized.push({
            file,
            suggestion,
            destination,
            confidence,
            method: 'batch-automatic',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination,
          });

          // CRITICAL FIX #3a: Record feedback with proper error handling
          // Record feedback for learning (non-blocking but with proper error handling)
          this.suggestionService
            .recordFeedback(file, suggestion, true)
            .catch((err) => {
              // Log error but don't fail the operation - batch processing continues
              logger.warn(
                '[AutoOrganize] Failed to record feedback (non-critical):',
                {
                  file: file.path,
                  error: err.message,
                },
              );
            });
        } else if (confidence >= this.thresholds.requireReview) {
          // Medium confidence - needs review
          results.needsReview.push({
            file,
            suggestion,
            alternatives: fileWithSuggestion.alternatives,
            confidence,
            explanation: `Batch suggestion with ${Math.round(confidence * 100)}% confidence`,
          });
        } else {
          // Low confidence - use fallback
          const fallbackDestination = this.getFallbackDestination(
            file,
            [],
            defaultLocation,
          );

          results.organized.push({
            file,
            destination: fallbackDestination,
            confidence,
            method: 'batch-low-confidence-fallback',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination: fallbackDestination,
          });
        }
      }
    }
  }

  /**
   * Process files individually as fallback
   */
  async _processFilesIndividually(files, smartFolders, options, results) {
    const { confidenceThreshold, defaultLocation, preserveNames } = options;

    for (const file of files) {
      try {
        // Get suggestion for the file
        let suggestion;
        try {
          suggestion = await this.suggestionService.getSuggestionsForFile(
            file,
            smartFolders,
            { includeAlternatives: false },
          );
        } catch (suggestionError) {
          logger.error('[AutoOrganize] Failed to get suggestion for file:', {
            file: file.name,
            error: suggestionError.message,
          });

          // Use fallback logic on suggestion failure
          const fallbackDestination = this.getFallbackDestination(
            file,
            smartFolders,
            defaultLocation,
          );

          results.organized.push({
            file,
            destination: fallbackDestination,
            confidence: 0.2,
            method: 'suggestion-error-fallback',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination: fallbackDestination,
          });
          continue;
        }

        if (!suggestion || !suggestion.success || !suggestion.primary) {
          // Use fallback logic from original system
          const fallbackDestination = this.getFallbackDestination(
            file,
            smartFolders,
            defaultLocation,
          );

          results.organized.push({
            file,
            destination: fallbackDestination,
            confidence: 0.3,
            method: 'fallback',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination: fallbackDestination,
          });
          continue;
        }

        const { primary } = suggestion;
        const confidence = suggestion.confidence || 0;

        // Determine action based on confidence
        if (confidence >= confidenceThreshold) {
          // High confidence - organize automatically
          const destination = this.buildDestinationPath(
            file,
            primary,
            defaultLocation,
            preserveNames,
          );

          results.organized.push({
            file,
            suggestion: primary,
            destination,
            confidence,
            method: 'automatic',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination,
          });

          // CRITICAL FIX #3b: Wrap recordFeedback in try-catch to prevent batch failure
          // Record feedback for learning with proper error handling
          try {
            await this.suggestionService.recordFeedback(file, primary, true);
          } catch (feedbackError) {
            // Log error but continue processing - feedback recording is non-critical
            logger.warn(
              '[AutoOrganize] Failed to record feedback (non-critical):',
              {
                file: file.path,
                error: feedbackError.message,
              },
            );
          }
        } else if (confidence >= this.thresholds.requireReview) {
          // Medium confidence - needs review
          results.needsReview.push({
            file,
            suggestion: primary,
            alternatives: suggestion.alternatives,
            confidence,
            explanation: suggestion.explanation,
          });
        } else {
          // Low confidence - use fallback
          const fallbackDestination = this.getFallbackDestination(
            file,
            smartFolders,
            defaultLocation,
          );

          results.organized.push({
            file,
            destination: fallbackDestination,
            confidence,
            method: 'low-confidence-fallback',
          });

          results.operations.push({
            type: 'move',
            source: file.path,
            destination: fallbackDestination,
          });
        }
      } catch (error) {
        // Bug #33: Include file path, batch ID, timestamp in error messages
        const fileErrorDetails = {
          fileName: file.name,
          filePath: file.path,
          fileSize: file.size,
          batchId: `organize-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          error: error.message,
          errorStack: error.stack,
        };

        logger.error(
          '[AutoOrganize] Failed to process file:',
          fileErrorDetails,
        );

        results.failed.push({
          file,
          reason: error.message,
          filePath: file.path,
          timestamp: fileErrorDetails.timestamp,
          batchId: fileErrorDetails.batchId,
        });
      }
    }
  }

  /**
   * Process files without analysis (use default folder)
   */
  async _processFilesWithoutAnalysis(
    files,
    smartFolders,
    defaultLocation,
    results,
  ) {
    logger.info('[AutoOrganize] Processing files without analysis', {
      count: files.length,
    });

    // Find or create default folder once for all files
    let defaultFolder = smartFolders.find(
      (f) => f.isDefault || f.name.toLowerCase() === 'uncategorized',
    );

    if (!defaultFolder) {
      defaultFolder = await this._createDefaultFolder(smartFolders);

      if (!defaultFolder) {
        // Could not create default folder, mark all files as failed
        for (const file of files) {
          results.failed.push({
            file,
            reason: 'No analysis available and failed to create default folder',
          });
        }
        return;
      }
    }

    // Process all files without analysis in batch
    for (const file of files) {
      const destination = path.join(
        defaultFolder.path || `${defaultLocation}/${defaultFolder.name}`,
        file.name,
      );

      results.organized.push({
        file,
        destination,
        confidence: 0.1,
        method: 'no-analysis-default',
      });

      results.operations.push({
        type: 'move',
        source: file.path,
        destination,
      });
    }
  }

  /**
   * Create default folder for unanalyzed files
   */
  async _createDefaultFolder(smartFolders) {
    logger.warn(
      '[AutoOrganize] No default folder found, creating emergency fallback',
    );

    try {
      // CRITICAL FIX: Validate documentsDir exists and is accessible
      const documentsDir = app.getPath('documents');

      if (!documentsDir || typeof documentsDir !== 'string') {
        throw new Error('Invalid documents directory path from Electron');
      }

      // CRITICAL FIX (BUG #4): Enhanced path validation with UNC path detection
      // Prevent path traversal attacks including UNC paths on Windows (\\server\share)

      // Step 1: Check for UNC paths which can bypass security checks on Windows
      // UNC paths start with \\ or // followed by server name
      const isUNCPath = (p) => {
        if (!p || typeof p !== 'string') return false;
        return p.startsWith('\\\\') || p.startsWith('//');
      };

      if (isUNCPath(documentsDir)) {
        throw new Error(
          `Security violation: UNC paths not allowed in documents directory. ` +
            `Detected UNC path: ${documentsDir}`,
        );
      }

      // Step 2: Sanitize folder path components to prevent directory traversal
      const sanitizedBaseName = 'StratoSort'.replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedFolderName = 'Uncategorized'.replace(
        /[^a-zA-Z0-9_-]/g,
        '_',
      );

      // Step 3: Use path.resolve to normalize path and prevent traversal
      const defaultFolderPath = path.resolve(
        documentsDir,
        sanitizedBaseName,
        sanitizedFolderName,
      );

      // Step 4: Additional UNC path check on resolved path
      if (isUNCPath(defaultFolderPath)) {
        throw new Error(
          `Security violation: UNC path detected after resolution. ` +
            `Path ${defaultFolderPath} is a UNC path which is not allowed`,
        );
      }

      // Step 5: Verify the resolved path is actually inside documents directory
      // This prevents path traversal even if path components contain ".."
      const resolvedDocumentsDir = path.resolve(documentsDir);

      // On Windows, normalize path separators for consistent comparison
      const normalizedDefaultPath = defaultFolderPath
        .replace(/\\/g, '/')
        .toLowerCase();
      const normalizedDocumentsDir = resolvedDocumentsDir
        .replace(/\\/g, '/')
        .toLowerCase();

      if (!normalizedDefaultPath.startsWith(normalizedDocumentsDir)) {
        throw new Error(
          `Security violation: Attempted path traversal detected. ` +
            `Path ${defaultFolderPath} is outside documents directory ${resolvedDocumentsDir}`,
        );
      }

      // Step 6: Additional validation - check for suspicious path patterns
      const suspiciousPatterns = [
        /\.\./, // Parent directory reference
        /\.\.[\\/]/, // Parent with separator
        /[\\/]\.\./, // Separator with parent
        /^[a-zA-Z]:/, // Different drive letter (if not expected)
        /\0/, // Null bytes
        /[<>:"|?*]/, // Invalid Windows filename chars in unexpected positions
      ];

      for (const pattern of suspiciousPatterns) {
        if (
          pattern.test(defaultFolderPath.substring(resolvedDocumentsDir.length))
        ) {
          throw new Error(
            `Security violation: Suspicious path pattern detected. ` +
              `Path contains potentially dangerous characters or sequences`,
          );
        }
      }

      logger.info(
        '[AutoOrganize] Path validation passed for emergency default folder',
        {
          documentsDir: resolvedDocumentsDir,
          defaultFolderPath,
          sanitized: true,
          uncPathCheck: 'passed',
          traversalCheck: 'passed',
        },
      );

      // HIGH PRIORITY FIX #6: Add fs.lstat check to detect and reject symbolic links
      // Check if directory already exists before creating
      // This prevents race conditions and permission errors
      let dirExists = false;
      let isSymbolicLink = false;
      try {
        // Use lstat instead of stat to detect symbolic links
        const stats = await fs.lstat(defaultFolderPath);
        dirExists = stats.isDirectory();
        isSymbolicLink = stats.isSymbolicLink();

        // HIGH PRIORITY FIX #6: Reject symbolic links for security
        if (isSymbolicLink) {
          throw new Error(
            `Security violation: Symbolic links are not allowed for safety reasons. ` +
              `Path ${defaultFolderPath} is a symbolic link.`,
          );
        }
      } catch (error) {
        // Directory doesn't exist, which is fine - we'll create it
        if (error.code !== 'ENOENT') {
          // Some other error (permission denied, symbolic link rejection, etc.)
          throw error;
        }
      }

      if (!dirExists) {
        // Ensure directory exists with proper error handling
        await fs.mkdir(defaultFolderPath, { recursive: true });
        logger.info(
          '[AutoOrganize] Created emergency default folder at:',
          defaultFolderPath,
        );
      } else {
        logger.info(
          '[AutoOrganize] Emergency default folder already exists at:',
          defaultFolderPath,
        );
      }

      // Create default folder object
      const defaultFolder = {
        id: 'emergency-default-' + Date.now(),
        name: 'Uncategorized',
        path: defaultFolderPath,
        description: 'Emergency fallback folder for files without analysis',
        keywords: [],
        isDefault: true,
        createdAt: new Date().toISOString(),
      };

      // Add to smartFolders array for this session
      smartFolders.push(defaultFolder);

      logger.info(
        '[AutoOrganize] Emergency default folder configured at:',
        defaultFolderPath,
      );

      return defaultFolder;
    } catch (error) {
      logger.error(
        '[AutoOrganize] Failed to create emergency default folder:',
        {
          error: error.message,
          stack: error.stack,
        },
      );

      return null;
    }
  }

  /**
   * Batch organize with automatic confidence-based filtering
   */
  async batchOrganize(files, smartFolders, options = {}) {
    const { autoApproveThreshold = this.thresholds.autoApprove } = options;

    logger.info('[AutoOrganize] Starting batch organization', {
      fileCount: files.length,
    });

    // Get batch suggestions
    const batchSuggestions = await this.suggestionService.getBatchSuggestions(
      files,
      smartFolders,
    );

    if (!batchSuggestions.success) {
      throw new Error('Failed to get batch suggestions');
    }

    const results = {
      operations: [],
      groups: [],
      skipped: [],
      failed: [], // Fixed: Track failed operations for resilient batch processing
    };

    // Fixed: Process groups with error handling to prevent one failure from stopping the batch
    for (const group of batchSuggestions.groups) {
      try {
        if (group.confidence >= autoApproveThreshold) {
          // Auto-approve high confidence groups
          const groupOperations = [];
          const groupFailures = [];

          for (const file of group.files) {
            try {
              const destination = this.buildDestinationPath(
                file,
                { folder: group.folder, path: group.path },
                options.defaultLocation || 'Documents',
                options.preserveNames,
              );

              groupOperations.push({
                type: 'move',
                source: file.path,
                destination,
              });

              // CRITICAL FIX: Await recordFeedback to prevent floating promises
              // This ensures feedback is recorded before continuing with batch operations
              // and allows proper error handling if feedback recording fails
              if (file.suggestion) {
                try {
                  await this.suggestionService.recordFeedback(
                    file,
                    file.suggestion,
                    true,
                  );
                } catch (feedbackError) {
                  // Log feedback errors but don't fail the operation
                  logger.warn(
                    '[AutoOrganize] Failed to record feedback for file:',
                    {
                      file: file.path,
                      error: feedbackError.message,
                    },
                  );
                  // Continue with file operation even if feedback fails
                }
              }
            } catch (fileError) {
              // Bug #33: Include file path, batch ID, timestamp in error messages
              const errorDetails = {
                filePath: file.path,
                fileName: file.name || path.basename(file.path),
                batchId: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp: new Date().toISOString(),
                error: fileError.message,
                errorStack: fileError.stack,
              };

              logger.error(
                '[AutoOrganize] Failed to process file in batch:',
                errorDetails,
              );

              groupFailures.push({
                file,
                error: fileError.message,
                filePath: file.path,
                timestamp: errorDetails.timestamp,
              });
            }
          }

          // Add successful operations
          results.operations.push(...groupOperations);

          // Track failed files
          if (groupFailures.length > 0) {
            results.failed.push(...groupFailures);
          }

          // Only add group if at least some files succeeded
          if (groupOperations.length > 0) {
            results.groups.push({
              folder: group.folder,
              files: group.files.filter(
                (f) => !groupFailures.find((failure) => failure.file === f),
              ),
              confidence: group.confidence,
              autoApproved: true,
              partialSuccess: groupFailures.length > 0,
            });
          }
        } else {
          // Skip low confidence groups for manual review
          results.skipped.push({
            folder: group.folder,
            files: group.files,
            confidence: group.confidence,
            reason: 'Low confidence',
          });
        }
      } catch (groupError) {
        // Bug #33: Include batch ID, timestamp, and detailed context in error messages
        const groupErrorDetails = {
          folder: group.folder,
          folderPath: group.path,
          fileCount: group.files ? group.files.length : 0,
          batchId: `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date().toISOString(),
          error: groupError.message,
          errorStack: groupError.stack,
        };

        logger.error(
          '[AutoOrganize] Failed to process group in batch:',
          groupErrorDetails,
        );

        results.failed.push({
          group: group.folder,
          files: group.files,
          error: groupError.message,
          timestamp: groupErrorDetails.timestamp,
          batchId: groupErrorDetails.batchId,
        });
      }
    }

    logger.info('[AutoOrganize] Batch organization complete', {
      operationCount: results.operations.length,
      groupCount: results.groups.length,
      skippedCount: results.skipped.length,
    });

    return results;
  }

  /**
   * Get fallback destination for files with no good match
   */
  getFallbackDestination(file, smartFolders, defaultLocation) {
    // Try to match based on file type
    const fileType = this.getFileTypeCategory(file.extension);

    // Look for a smart folder that matches the file type
    const typeFolder = smartFolders.find((f) =>
      f.name.toLowerCase().includes(fileType.toLowerCase()),
    );

    if (typeFolder) {
      return path.join(
        typeFolder.path || `${defaultLocation}/${typeFolder.name}`,
        file.name,
      );
    }

    // Use category from analysis if available
    if (file.analysis?.category) {
      const categoryFolder = smartFolders.find(
        (f) => f.name.toLowerCase() === file.analysis.category.toLowerCase(),
      );

      if (categoryFolder) {
        return path.join(
          categoryFolder.path || `${defaultLocation}/${categoryFolder.name}`,
          file.name,
        );
      }

      // Create new folder based on category
      return path.join(defaultLocation, file.analysis.category, file.name);
    }

    // Ultimate fallback - organize by file type
    return path.join(defaultLocation, fileType, file.name);
  }

  /**
   * Build destination path for a file
   */
  buildDestinationPath(file, suggestion, defaultLocation, preserveNames) {
    const folderPath =
      suggestion.path || path.join(defaultLocation, suggestion.folder);

    const fileName = preserveNames
      ? file.name
      : file.analysis?.suggestedName || file.name;

    return path.join(folderPath, fileName);
  }

  /**
   * Get file type category
   */
  getFileTypeCategory(extension) {
    const categories = {
      documents: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt'],
      spreadsheets: ['xls', 'xlsx', 'csv', 'ods'],
      presentations: ['ppt', 'pptx', 'odp'],
      images: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp'],
      videos: ['mp4', 'avi', 'mov', 'wmv', 'flv'],
      audio: ['mp3', 'wav', 'flac', 'aac', 'm4a'],
      code: ['js', 'py', 'java', 'cpp', 'html', 'css'],
      archives: ['zip', 'rar', '7z', 'tar', 'gz'],
    };

    const ext = extension.toLowerCase().replace('.', '');

    for (const [category, extensions] of Object.entries(categories)) {
      if (extensions.includes(ext)) {
        return category.charAt(0).toUpperCase() + category.slice(1);
      }
    }

    return 'Files';
  }

  /**
   * Monitor and auto-organize new files (for Downloads folder watching)
   */
  async processNewFile(filePath, smartFolders, options = {}) {
    const {
      autoOrganizeEnabled = false,
      confidenceThreshold = 0.9, // Higher threshold for automatic processing
    } = options;

    if (!autoOrganizeEnabled) {
      logger.info(
        '[AutoOrganize] Auto-organize disabled, skipping file:',
        filePath,
      );
      return null;
    }

    try {
      // Analyze the file first
      const {
        analyzeDocumentFile,
        analyzeImageFile,
      } = require('../analysis/ollamaDocumentAnalysis');
      const extension = path.extname(filePath).toLowerCase();

      let analysis;
      if (['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(extension)) {
        analysis = await analyzeImageFile(filePath, smartFolders);
      } else {
        analysis = await analyzeDocumentFile(filePath, smartFolders);
      }

      if (!analysis || analysis.error) {
        logger.warn('[AutoOrganize] Could not analyze file:', filePath);
        return null;
      }

      // Create file object
      const file = {
        name: path.basename(filePath),
        path: filePath,
        extension,
        analysis,
      };

      // Get suggestion
      const suggestion = await this.suggestionService.getSuggestionsForFile(
        file,
        smartFolders,
        { includeAlternatives: false },
      );

      // Only auto-organize if confidence is very high
      if (
        suggestion.success &&
        suggestion.primary &&
        suggestion.confidence >= confidenceThreshold
      ) {
        const destination = this.buildDestinationPath(
          file,
          suggestion.primary,
          options.defaultLocation || 'Documents',
          false,
        );

        logger.info('[AutoOrganize] Auto-organizing new file', {
          file: filePath,
          destination,
          confidence: suggestion.confidence,
        });

        // Record the action for undo
        const action = {
          type: 'FILE_MOVE',
          data: {
            originalPath: filePath,
            newPath: destination,
          },
          timestamp: Date.now(),
          description: `Auto-organized ${file.name}`,
        };

        if (this.undoRedo) {
          await this.undoRedo.recordAction(action);
        }

        return {
          source: filePath,
          destination,
          confidence: suggestion.confidence,
          suggestion: suggestion.primary,
        };
      }

      logger.info(
        '[AutoOrganize] File confidence too low for auto-organization',
        {
          file: filePath,
          confidence: suggestion.confidence || 0,
          threshold: confidenceThreshold,
        },
      );

      return null;
    } catch (error) {
      logger.error('[AutoOrganize] Error processing new file:', {
        file: filePath,
        error: error.message,
      });
      return null;
    }
  }

  /**
   * Get organization statistics
   */
  async getStatistics() {
    return {
      userPatterns: this.suggestionService.userPatterns.size,
      feedbackHistory: this.suggestionService.feedbackHistory.length,
      folderUsageStats: Array.from(
        this.suggestionService.folderUsageStats.entries(),
      ),
      thresholds: this.thresholds,
    };
  }

  /**
   * Update confidence thresholds
   */
  updateThresholds(newThresholds) {
    this.thresholds = {
      ...this.thresholds,
      ...newThresholds,
    };
    logger.info('[AutoOrganize] Updated thresholds:', this.thresholds);
  }
}

module.exports = AutoOrganizeService;
