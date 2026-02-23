const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { createLogger } = require('../../shared/logger');
const { buildPathUpdatePairs } = require('../utils/fileIdUtils');
const { RETRY } = require('../../shared/performanceConstants');
const { crossDeviceMove } = require('../../shared/atomicFileOperations');
const { validateFileOperationPath } = require('../../shared/pathSanitization');
const { getInstance: getFileOperationTracker } = require('../../shared/fileOperationTracker');

const logger = createLogger('UndoRedoService');

const { container, ServiceIds } = require('./ServiceContainer');

// Lazy-load vector DB to avoid circular dependencies
function getVectorDbService() {
  try {
    return container.tryResolve(ServiceIds.ORAMA_VECTOR);
  } catch {
    return null;
  }
}

// Use FilePathCoordinator when available for atomic updates
function getFilePathCoordinator() {
  try {
    if (container.has(ServiceIds.FILE_PATH_COORDINATOR)) {
      return container.resolve(ServiceIds.FILE_PATH_COORDINATOR);
    }
  } catch {
    return null;
  }
  return null;
}

// Helper to generate secure random IDs
const generateSecureId = () =>
  `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;

class UndoRedoService {
  constructor(options = {}) {
    this.userDataPath = app.getPath('userData');
    this.actionsPath = path.join(this.userDataPath, 'undo-actions.json');

    // Fixed: Configurable limits to prevent unbounded growth
    this.maxActions = options.maxActions || 50; // Reduced from 100 to 50
    this.maxMemoryMB = options.maxMemoryMB || 10; // 10MB max memory for undo history
    this.maxBatchSize = options.maxBatchSize || 1000; // Limit individual batch operation size

    this.actions = [];
    this.currentIndex = -1; // Points to the last executed action
    this.initialized = false;
    this.currentMemoryEstimate = 0; // Track estimated memory usage

    // Promise-based mutex to serialize undo/redo/recordAction operations
    this._mutex = Promise.resolve();

    // Coalesce frequent recordAction writes to reduce burst disk I/O.
    // Undo/redo/clear paths still force an immediate flush.
    this._saveDebounceMs =
      Number.isFinite(options.saveDebounceMs) && options.saveDebounceMs >= 0
        ? options.saveDebounceMs
        : 250;
    this._pendingSaveTimer = null;
    this._pendingSavePromise = null;
    this._pendingSaveResolve = null;
    this._pendingSaveReject = null;
  }

  async _validateActionPath(filePath, fieldName = 'path') {
    const candidate = typeof filePath === 'string' ? filePath.trim() : filePath;
    const validation = await validateFileOperationPath(candidate, {
      requireAbsolute: true,
      checkSymlinks: false,
      disallowUrlSchemes: true,
      allowFileUrl: false
    });
    if (!validation.valid) {
      throw new Error(
        `Unsafe action path blocked (${fieldName}): ${validation.error || 'Path validation failed'}`
      );
    }
    return validation.normalizedPath;
  }

  async ensureParentDirectory(filePath) {
    const normalizedPath = await this._validateActionPath(filePath, 'parent-target');
    const parentDirectory = await this._validateActionPath(
      path.dirname(normalizedPath),
      'parent-directory'
    );
    await fs.mkdir(parentDirectory, { recursive: true });
  }

  async safeMove(sourcePath, destinationPath) {
    const normalizedSource = await this._validateActionPath(sourcePath, 'move-source');
    const normalizedDestination = await this._validateActionPath(
      destinationPath,
      'move-destination'
    );
    await this.ensureParentDirectory(normalizedDestination);
    try {
      // Try rename first (atomic operation)
      await fs.rename(normalizedSource, normalizedDestination);
    } catch (error) {
      if (error && error.code === 'EXDEV') {
        // Cross-device move: use shared utility with verification
        await crossDeviceMove(normalizedSource, normalizedDestination, {
          verify: true
        });
      } else {
        throw error;
      }
    }

    try {
      const tracker = getFileOperationTracker();
      tracker.recordOperation(normalizedSource, 'move', 'undoRedo');
      tracker.recordOperation(normalizedDestination, 'move', 'undoRedo');
    } catch (trackerErr) {
      logger.warn('[UndoRedoService] Failed to record operation in tracker', {
        error: trackerErr.message
      });
    }
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await this.loadActions();
      this.initialized = true;
      logger.info('[UndoRedoService] Initialized successfully');

      this.cleanupOldBackups().catch((error) => {
        logger.warn('[UndoRedoService] Startup backup cleanup failed:', error.message);
      });
    } catch (error) {
      logger.error('[UndoRedoService] Failed to initialize', {
        error: error.message
      });
      this.actions = [];
      this.currentIndex = -1;
      this.initialized = true;
    }
  }

  async loadActions() {
    try {
      const actionsData = await fs.readFile(this.actionsPath, 'utf8');
      const data = JSON.parse(actionsData);
      this.actions = Array.isArray(data.actions) ? data.actions : [];
      const rawIndex = Number.isInteger(data.currentIndex) ? data.currentIndex : -1;
      // Clamp currentIndex to valid range to prevent out-of-bounds access on corrupted/truncated data
      this.currentIndex =
        this.actions.length === 0 ? -1 : Math.max(-1, Math.min(rawIndex, this.actions.length - 1));

      // Fixed: Recalculate memory estimate after loading
      this._recalculateMemoryEstimate();
    } catch {
      // File doesn't exist or is corrupted, start fresh
      this.actions = [];
      this.currentIndex = -1;
      this.currentMemoryEstimate = 0;
      await this.saveActions();
    }
  }

  /**
   * Estimate memory usage of an action in bytes
   * @private
   */
  _estimateActionSize(action) {
    // Rough estimate: JSON.stringify length * 2 (for UTF-16 encoding)
    // Actions may contain service references or error objects with cause chains.
    try {
      return JSON.stringify(action).length * 2;
    } catch {
      // Fallback: estimate based on the action's top-level keys
      // This is a rough heuristic but prevents crashes on circular data
      return 1024;
    }
  }

  /**
   * Recalculate total memory estimate for all actions
   * @private
   */
  _recalculateMemoryEstimate() {
    this.currentMemoryEstimate = this.actions.reduce((total, action) => {
      return total + this._estimateActionSize(action);
    }, 0);
  }

  async saveActions() {
    const data = {
      actions: this.actions,
      currentIndex: this.currentIndex,
      lastSaved: new Date().toISOString()
    };
    await this.ensureParentDirectory(this.actionsPath);
    const tempPath = `${this.actionsPath}.tmp.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
      // Retry rename on Windows EPERM errors (file handle race condition)
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await fs.rename(tempPath, this.actionsPath);
          lastError = null;
          break;
        } catch (renameError) {
          lastError = renameError;
          if (renameError.code === 'EPERM' && attempt < 2) {
            await new Promise((resolve) =>
              setTimeout(resolve, RETRY.ATOMIC_BACKOFF_STEP_MS * (attempt + 1))
            );
            continue;
          }
          throw renameError;
        }
      }
      if (lastError) throw lastError;
    } catch (error) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  _clearPendingSaveState() {
    this._pendingSaveTimer = null;
    this._pendingSavePromise = null;
    this._pendingSaveResolve = null;
    this._pendingSaveReject = null;
  }

  _cancelScheduledSave() {
    if (!this._pendingSaveTimer) {
      return false;
    }
    clearTimeout(this._pendingSaveTimer);
    const resolve = this._pendingSaveResolve;
    this._clearPendingSaveState();
    if (typeof resolve === 'function') {
      // Resolve any waiters since a caller is about to perform an immediate save.
      resolve();
    }
    return true;
  }

  _scheduleSaveActions() {
    if (this._saveDebounceMs <= 0) {
      return this.saveActions();
    }
    if (this._pendingSavePromise) {
      return this._pendingSavePromise;
    }

    this._pendingSavePromise = new Promise((resolve, reject) => {
      this._pendingSaveResolve = resolve;
      this._pendingSaveReject = reject;
    });

    this._pendingSaveTimer = setTimeout(async () => {
      const resolve = this._pendingSaveResolve;
      const reject = this._pendingSaveReject;
      this._pendingSaveTimer = null;
      try {
        await this.saveActions();
        if (typeof resolve === 'function') resolve();
      } catch (error) {
        if (typeof reject === 'function') reject(error);
      } finally {
        this._clearPendingSaveState();
      }
    }, this._saveDebounceMs);

    return this._pendingSavePromise;
  }

  async _saveActionsNow() {
    const canceledPendingTimer = this._cancelScheduledSave();
    if (!canceledPendingTimer && this._pendingSavePromise) {
      try {
        await this._pendingSavePromise;
      } catch (error) {
        logger.warn('[UndoRedoService] Pending scheduled save failed before forced flush', {
          error: error.message
        });
      }
    }
    await this.saveActions();
  }

  /**
   * Promise-based mutex to serialize async operations that modify shared state.
   * Prevents race conditions when undo/redo/recordAction are called concurrently.
   * @private
   */
  async _withMutex(fn) {
    const prev = this._mutex;
    let resolve;
    this._mutex = new Promise((r) => {
      resolve = r;
    });
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
    }
  }

  async recordAction(actionType, actionData) {
    return this._withMutex(() => this._doRecordAction(actionType, actionData));
  }

  async _doRecordAction(actionType, actionData) {
    await this.initialize();

    // Fixed: Limit batch operation sizes to prevent memory issues
    if (
      (actionType === 'BATCH_ORGANIZE' || actionType === 'BATCH_OPERATION') &&
      actionData.operations &&
      actionData.operations.length > this.maxBatchSize
    ) {
      logger.warn(
        `[UndoRedoService] Batch operation has ${actionData.operations.length} items, limiting to ${this.maxBatchSize}`
      );
      actionData = { ...actionData, operations: actionData.operations.slice(0, this.maxBatchSize) };
    }

    const action = {
      id: this.generateId(),
      type: actionType,
      timestamp: new Date().toISOString(),
      data: actionData,
      description: this.getActionDescription(actionType, actionData)
    };

    const actionSize = this._estimateActionSize(action);

    // Remove any actions after the current index (if we're not at the end)
    if (this.currentIndex < this.actions.length - 1) {
      const removedActions = this.actions.slice(this.currentIndex + 1);
      this.actions = this.actions.slice(0, this.currentIndex + 1);

      // Update memory estimate for removed actions
      removedActions.forEach((a) => {
        this.currentMemoryEstimate -= this._estimateActionSize(a);
      });
    }

    // Add the new action
    this.actions.push(action);
    this.currentIndex = this.actions.length - 1;
    this.currentMemoryEstimate += actionSize;

    // BUG FIX #7: Prevent infinite loop when single action exceeds memory limit
    // CRITICAL: If we only have 1 action and it's oversized, the while loop would run forever
    // We need to either truncate the single action OR accept it exceeds the limit
    const maxMemoryBytes = this.maxMemoryMB * 1024 * 1024;

    // Safety check: Prevent infinite loop by tracking iterations
    let pruneIterations = 0;
    const maxPruneIterations = this.maxActions + 10; // Safety margin

    while (
      this.actions.length > 1 && // Must have more than 1 to remove
      (this.actions.length > this.maxActions || this.currentMemoryEstimate > maxMemoryBytes) &&
      pruneIterations < maxPruneIterations // ESCAPE CONDITION
    ) {
      const removedAction = this.actions.shift();
      this.currentIndex--;
      this.currentMemoryEstimate -= this._estimateActionSize(removedAction);
      pruneIterations++;
    }

    // Check if we hit the iteration limit (should never happen, but log if it does)
    if (pruneIterations >= maxPruneIterations) {
      logger.error(
        `[UndoRedoService] Pruning loop hit safety limit at ${pruneIterations} iterations`,
        {
          actionsRemaining: this.actions.length,
          memoryEstimateMB: (this.currentMemoryEstimate / 1024 / 1024).toFixed(2),
          maxMemoryMB: this.maxMemoryMB
        }
      );
    }

    // BUG FIX #7: Handle single oversized action
    // If we only have 1 action left and it still exceeds the memory limit,
    // we have two options:
    // 1. Truncate the action data to fit within limits
    // 2. Clear the entire action history
    if (this.currentMemoryEstimate > maxMemoryBytes && this.actions.length === 1) {
      logger.warn(
        `[UndoRedoService] Single action exceeds memory limit (${(this.currentMemoryEstimate / 1024 / 1024).toFixed(2)}MB > ${this.maxMemoryMB}MB), truncating data`
      );

      // Truncate the action's data to prevent unbounded memory growth
      const largeAction = this.actions[0];
      const operationCount = largeAction.data?.operations?.length || 0;

      largeAction.data = {
        truncated: true,
        originalType: largeAction.type,
        originalOperationCount: operationCount,
        message: `Action data truncated due to size (${(this.currentMemoryEstimate / 1024 / 1024).toFixed(2)}MB)`,
        timestamp: largeAction.timestamp
      };

      // Recalculate memory estimate after truncation
      this._recalculateMemoryEstimate();

      // SAFETY CHECK: If still over limit after truncation, clear everything
      if (this.currentMemoryEstimate > maxMemoryBytes) {
        logger.error(
          `[UndoRedoService] Even after truncation, action exceeds memory limit. Clearing all undo history.`,
          {
            truncatedSizeMB: (this.currentMemoryEstimate / 1024 / 1024).toFixed(2),
            maxMemoryMB: this.maxMemoryMB
          }
        );
        this.actions = [];
        this.currentIndex = -1;
        this.currentMemoryEstimate = 0;
      }
    }

    // EDGE CASE: If we somehow have 0 actions but non-zero memory estimate, reset
    if (this.actions.length === 0 && this.currentMemoryEstimate !== 0) {
      logger.warn('[UndoRedoService] Memory estimate desync detected, resetting to 0');
      this.currentMemoryEstimate = 0;
    }

    if (this._saveDebounceMs <= 0) {
      await this.saveActions();
    } else {
      this._scheduleSaveActions().catch((error) => {
        logger.error('[UndoRedoService] Failed to persist scheduled undo/redo state', {
          error: error.message
        });
      });
    }
    return action.id;
  }

  async undo() {
    return this._withMutex(() => this._doUndo());
  }

  async _doUndo() {
    await this.initialize();

    if (!this.canUndo()) {
      throw new Error('No actions to undo');
    }

    const action = this.actions[this.currentIndex];

    try {
      // Clear any previous operation results
      delete action._operationResults;

      await this.executeReverseAction(action);
      const operationResults = action._operationResults;
      delete action._operationResults;
      this.currentIndex--;
      await this._saveActionsNow();

      // Build response with operation results for batch operations
      const response = {
        success: true,
        action: {
          id: action.id,
          type: action.type,
          description: action.description,
          timestamp: action.timestamp
        },
        message: `Undid: ${action.description}`
      };

      // Include operation results for batch operations (for UI state updates)
      if (operationResults) {
        response.results = operationResults;
        response.successCount = operationResults.filter((r) => r.success).length;
        response.failCount = operationResults.filter((r) => !r.success).length;
        // Include original operation data for state reconstruction
        response.operations = action.data?.operations || [];
      }

      return response;
    } catch (error) {
      logger.error('[UndoRedoService] Failed to undo action', {
        error: error.message
      });
      throw new Error(`Failed to undo action: ${error.message}`, { cause: error });
    }
  }

  async redo() {
    return this._withMutex(() => this._doRedo());
  }

  async _doRedo() {
    await this.initialize();

    if (!this.canRedo()) {
      throw new Error('No actions to redo');
    }

    const action = this.actions[this.currentIndex + 1];

    try {
      // Clear any previous operation results
      delete action._operationResults;

      await this.executeForwardAction(action);
      const operationResults = action._operationResults;
      delete action._operationResults;
      this.currentIndex++;
      await this._saveActionsNow();

      // Build response with operation results for batch operations
      const response = {
        success: true,
        action: {
          id: action.id,
          type: action.type,
          description: action.description,
          timestamp: action.timestamp
        },
        message: `Redid: ${action.description}`
      };

      // Include operation results for batch operations (for UI state updates)
      if (operationResults) {
        response.results = operationResults;
        response.successCount = operationResults.filter((r) => r.success).length;
        response.failCount = operationResults.filter((r) => !r.success).length;
        // Include original operation data for state reconstruction
        response.operations = action.data?.operations || [];
      }

      return response;
    } catch (error) {
      logger.error('[UndoRedoService] Failed to redo action', {
        error: error.message
      });
      throw new Error(`Failed to redo action: ${error.message}`, { cause: error });
    }
  }

  canUndo() {
    return this.currentIndex >= 0;
  }

  canRedo() {
    return this.currentIndex < this.actions.length - 1;
  }

  async executeReverseAction(action) {
    switch (action.type) {
      case 'FILE_MOVE':
        // Move file back to original location
        await this.safeMove(action.data.newPath, action.data.originalPath);
        // Update vector DB path
        await this.updateVectorDbPath(action.data.newPath, action.data.originalPath);
        break;

      case 'FILE_RENAME':
        // Rename file back to original name
        await this.safeMove(action.data.newPath, action.data.originalPath);
        // Update vector DB path
        await this.updateVectorDbPath(action.data.newPath, action.data.originalPath);
        break;

      case 'FILE_DELETE': {
        // Previous code didn't persist backup paths immediately, risking data loss on crashes
        // Now we check multiple backup locations and provide detailed error information
        if (!action.data.backupPath) {
          throw new Error(
            'Cannot restore deleted file - no backup path was recorded. ' +
              'File may have been permanently deleted without backup. ' +
              `Original path: ${action.data.originalPath}`
          );
        }

        const backupExists = await this.fileExists(action.data.backupPath);
        if (!backupExists) {
          // CRITICAL: Backup path was recorded but file doesn't exist
          // This indicates either: backup failed, backup was deleted, or path is incorrect
          logger.error('[UndoRedoService] Backup file not found at expected location', {
            backupPath: action.data.backupPath,
            originalPath: action.data.originalPath,
            actionId: action.id,
            timestamp: action.timestamp
          });

          throw new Error(
            `Cannot restore deleted file - backup not found at expected location.\n` +
              `Original file: ${action.data.originalPath}\n` +
              `Expected backup: ${action.data.backupPath}\n` +
              `This may indicate the backup was never created, was deleted, or the path is incorrect.\n` +
              `Action ID: ${action.id}, Timestamp: ${action.timestamp}`
          );
        }

        // Restore file from backup
        logger.info('[UndoRedoService] Restoring file from backup', {
          from: action.data.backupPath,
          to: action.data.originalPath
        });

        await this.safeMove(action.data.backupPath, action.data.originalPath);
        break;
      }

      case 'FOLDER_CREATE':
        // Remove the created folder (if empty)
        try {
          const folderPath = await this._validateActionPath(
            action.data.folderPath,
            'folder-create-path'
          );
          await fs.rmdir(folderPath);
        } catch (error) {
          // Folder might not be empty, try to restore to original state
          logger.warn(
            `[UndoRedoService] Could not remove folder, might contain files: ${error.message}`
          );
        }
        break;

      case 'BATCH_ORGANIZE':
      case 'BATCH_OPERATION': {
        // Backwards/forwards compatibility with shared ACTION_TYPES
        // Reverse each file operation in the batch with result tracking
        const operations = Array.isArray(action.data?.operations) ? action.data.operations : null;
        if (!operations) {
          const reason = action.data?.truncated
            ? 'Cannot undo truncated batch action data'
            : 'Cannot undo batch action with invalid operations data';
          throw new Error(reason);
        }
        const pathChanges = [];
        const operationResults = [];

        for (const operation of [...operations].reverse()) {
          try {
            const result = await this.reverseFileOperation(operation);
            operationResults.push({
              ...result,
              originalPath: operation.originalPath,
              newPath: operation.newPath,
              type: operation.type
            });
            // Collect path changes for batch vector DB update
            if (result.success && (operation.type === 'move' || operation.type === 'rename')) {
              pathChanges.push({
                oldPath: operation.newPath,
                newPath: operation.originalPath
              });
            }
          } catch (error) {
            logger.warn('[UndoRedoService] Operation failed during undo', {
              operation,
              error: error.message
            });
            operationResults.push({
              success: false,
              originalPath: operation.originalPath,
              newPath: operation.newPath,
              type: operation.type,
              error: error.message
            });
          }
        }
        // Batch update vector DB paths for successful operations
        await this.updateVectorDbPaths(pathChanges);
        // Store results for return
        action._operationResults = operationResults;
        break;
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  async executeForwardAction(action) {
    switch (action.type) {
      case 'FILE_MOVE':
        // Move file to new location
        await this.safeMove(action.data.originalPath, action.data.newPath);
        // Update vector DB path
        await this.updateVectorDbPath(action.data.originalPath, action.data.newPath);
        break;

      case 'FILE_RENAME':
        // Rename file to new name
        await this.safeMove(action.data.originalPath, action.data.newPath);
        // Update vector DB path
        await this.updateVectorDbPath(action.data.originalPath, action.data.newPath);
        break;

      case 'FILE_DELETE':
        // Delete file again (move to backup if configured)
        if (action.data.createBackup) {
          await this.safeMove(action.data.originalPath, action.data.backupPath);
        } else {
          const originalPath = await this._validateActionPath(
            action.data.originalPath,
            'file-delete-path'
          );
          await fs.unlink(originalPath);
        }
        break;

      case 'FOLDER_CREATE':
        // Create the folder again
        await fs.mkdir(
          await this._validateActionPath(action.data.folderPath, 'folder-create-path'),
          { recursive: true }
        );
        break;

      case 'BATCH_ORGANIZE':
      case 'BATCH_OPERATION': {
        // Backwards/forwards compatibility with shared ACTION_TYPES
        // Re-execute each file operation in the batch with result tracking
        const operations = Array.isArray(action.data?.operations) ? action.data.operations : null;
        if (!operations) {
          const reason = action.data?.truncated
            ? 'Cannot redo truncated batch action data'
            : 'Cannot redo batch action with invalid operations data';
          throw new Error(reason);
        }
        const pathChanges = [];
        const operationResults = [];

        for (const operation of operations) {
          try {
            await this.executeFileOperation(operation);
            operationResults.push({
              success: true,
              source: operation.originalPath,
              destination: operation.newPath,
              type: operation.type
            });
            // Collect path changes for batch vector DB update
            if (operation.type === 'move' || operation.type === 'rename') {
              pathChanges.push({
                oldPath: operation.originalPath,
                newPath: operation.newPath
              });
            }
          } catch (error) {
            logger.warn('[UndoRedoService] Operation failed during redo', {
              operation,
              error: error.message
            });
            operationResults.push({
              success: false,
              source: operation.originalPath,
              destination: operation.newPath,
              type: operation.type,
              error: error.message
            });
          }
        }
        // Batch update vector DB paths for successful operations
        await this.updateVectorDbPaths(pathChanges);
        // Store results for return
        action._operationResults = operationResults;
        break;
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  async reverseFileOperation(operation) {
    switch (operation.type) {
      case 'move':
        await this.safeMove(operation.newPath, operation.originalPath);
        return {
          success: true,
          source: operation.newPath,
          destination: operation.originalPath
        };
      case 'rename':
        await this.safeMove(operation.newPath, operation.originalPath);
        return {
          success: true,
          source: operation.newPath,
          destination: operation.originalPath
        };
      case 'delete':
        if (operation.backupPath && (await this.fileExists(operation.backupPath))) {
          await this.safeMove(operation.backupPath, operation.originalPath);
          return { success: true, restored: operation.originalPath };
        }
        return { success: false, error: 'Backup not found' };
      default:
        return {
          success: false,
          error: `Unknown operation type: ${operation.type}`
        };
    }
  }

  async executeFileOperation(operation) {
    switch (operation.type) {
      case 'move':
        await this.safeMove(operation.originalPath, operation.newPath);
        break;
      case 'rename':
        await this.safeMove(operation.originalPath, operation.newPath);
        break;
      case 'delete':
        if (operation.createBackup) {
          await this.safeMove(operation.originalPath, operation.backupPath);
        } else {
          const originalPath = await this._validateActionPath(
            operation.originalPath,
            'batch-delete-path'
          );
          await fs.unlink(originalPath);
        }
        break;
    }
  }

  async fileExists(filePath) {
    const normalizedPath = await this._validateActionPath(filePath, 'exists-check-path');
    try {
      await fs.access(normalizedPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Update vector DB path after file move
   * @param {string} oldPath - Original file path
   * @param {string} newPath - New file path
   */
  async updateVectorDbPath(oldPath, newPath) {
    try {
      const coordinator = getFilePathCoordinator();
      if (coordinator) {
        await coordinator.atomicPathUpdate(oldPath, newPath, {
          type: 'undo_redo',
          skipProcessingState: true
        });
        return;
      }

      const vectorDb = getVectorDbService();
      if (vectorDb) {
        const updates = buildPathUpdatePairs(oldPath, newPath);
        await vectorDb.updateFilePaths(updates);
      }

      // Keep pending embedding queue IDs consistent with undo/redo moves too.
      try {
        const embeddingQueue = require('../analysis/embeddingQueue/queueManager');
        embeddingQueue.updateByFilePath?.(oldPath, newPath);
      } catch {
        // Non-fatal
      }

      try {
        const searchService = container.tryResolve(ServiceIds.SEARCH_SERVICE);
        if (searchService?.invalidateAndRebuild) {
          searchService
            .invalidateAndRebuild({
              immediate: false,
              reason: 'undo-redo-move',
              oldPath,
              newPath
            })
            .catch((err) => {
              logger.debug('[UndoRedoService] Search index rebuild failed (non-fatal)', {
                error: err.message
              });
            });
        }
      } catch {
        // Non-fatal
      }
    } catch (error) {
      // Non-fatal - log but don't fail the undo/redo
      logger.warn('[UndoRedoService] Failed to update vector DB path', {
        oldPath,
        newPath,
        error: error.message
      });
    }
  }

  /**
   * Batch update vector DB paths
   * @param {Array<{oldPath: string, newPath: string}>} pathChanges
   */
  async updateVectorDbPaths(pathChanges) {
    if (!pathChanges || pathChanges.length === 0) return;

    try {
      const coordinator = getFilePathCoordinator();
      if (coordinator) {
        await coordinator.batchPathUpdate(pathChanges, { type: 'undo_redo' });
        return;
      }

      const vectorDb = getVectorDbService();
      if (vectorDb) {
        const updates = pathChanges.flatMap(({ oldPath, newPath }) =>
          buildPathUpdatePairs(oldPath, newPath)
        );
        await vectorDb.updateFilePaths(updates);
      }

      // Also update any pending embeddings in the queue (so they flush under the new IDs).
      try {
        const embeddingQueue = require('../analysis/embeddingQueue/queueManager');
        embeddingQueue.updateByFilePaths?.(pathChanges);
      } catch {
        // Non-fatal
      }

      try {
        const searchService = container.tryResolve(ServiceIds.SEARCH_SERVICE);
        if (searchService?.invalidateAndRebuild) {
          searchService
            .invalidateAndRebuild({
              immediate: false,
              reason: 'undo-redo-batch'
            })
            .catch((err) => {
              logger.debug('[UndoRedoService] Search index batch rebuild failed (non-fatal)', {
                error: err.message
              });
            });
        }
      } catch {
        // Non-fatal
      }
    } catch (error) {
      logger.warn('[UndoRedoService] Failed to batch update vector DB paths', {
        count: pathChanges.length,
        error: error.message
      });
    }
  }

  /**
   * CRITICAL FIX (BUG #2): Create backup for file deletion with immediate persistence
   * This ensures backups are created and tracked BEFORE the actual deletion occurs
   *
   * @param {string} filePath - Path to file to backup
   * @returns {Promise<string>} Path to backup file
   */
  async createBackup(filePath) {
    const normalizedPath = await this._validateActionPath(filePath, 'backup-source-path');
    const backupDir = await this._validateActionPath(
      path.join(this.userDataPath, 'undo-backups'),
      'backup-directory'
    );
    await this.ensureParentDirectory(path.join(backupDir, 'dummy'));

    // Create unique backup filename with timestamp and secure random component
    const originalName = path.basename(normalizedPath);
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(4).toString('hex');
    const backupName = `${timestamp}_${randomId}_${originalName}`;
    const backupPath = await this._validateActionPath(
      path.join(backupDir, backupName),
      'backup-target-path'
    );

    // Verify source file exists before attempting backup
    if (!(await this.fileExists(normalizedPath))) {
      throw new Error(`Cannot create backup - source file does not exist: ${filePath}`);
    }

    try {
      // Create backup using safeMove which includes verification
      await fs.copyFile(normalizedPath, backupPath);

      // Verify backup was created successfully
      const [sourceStats, backupStats] = await Promise.all([
        fs.stat(normalizedPath),
        fs.stat(backupPath)
      ]);

      if (sourceStats.size !== backupStats.size) {
        await fs.unlink(backupPath).catch((unlinkError) => {
          logger.warn('Failed to cleanup backup file after size mismatch', {
            backupPath,
            error: unlinkError.message
          });
        });
        throw new Error(
          `Backup verification failed - size mismatch (source: ${sourceStats.size}, backup: ${backupStats.size})`
        );
      }

      logger.info('[UndoRedoService] Created backup successfully', {
        original: normalizedPath,
        backup: backupPath,
        size: sourceStats.size
      });

      // CRITICAL: Immediately persist the backup path to disk BEFORE deleting the original
      // This ensures we can recover even if the process crashes
      await this._saveActionsNow();

      return backupPath;
    } catch (error) {
      // Clean up failed backup attempt
      await fs.unlink(backupPath).catch((unlinkError) => {
        logger.warn('Failed to cleanup backup file after backup creation error', {
          backupPath,
          error: unlinkError.message
        });
      });
      throw new Error(`Failed to create backup: ${error.message}`, { cause: error });
    }
  }

  /**
   * CRITICAL FIX (BUG #2): Clean up old backup files to prevent unbounded disk usage
   * Call this periodically to remove backups for actions that are no longer in history
   */
  async cleanupOldBackups() {
    const backupDir = path.join(this.userDataPath, 'undo-backups');

    try {
      await fs.access(backupDir);
    } catch {
      // Backup directory doesn't exist, nothing to clean
      return { removed: 0, errors: 0 };
    }

    // Get all backup paths currently referenced in actions
    const referencedBackups = new Set();
    for (const action of this.actions) {
      if (action.data?.backupPath) {
        referencedBackups.add(path.basename(action.data.backupPath));
      }
      if (action.data?.operations) {
        for (const op of action.data.operations) {
          if (op.backupPath) {
            referencedBackups.add(path.basename(op.backupPath));
          }
        }
      }
    }

    // Find and remove unreferenced backups
    const files = await fs.readdir(backupDir);
    let removed = 0;
    let errors = 0;

    for (const file of files) {
      if (!referencedBackups.has(file)) {
        try {
          await fs.unlink(path.join(backupDir, file));
          removed++;
          logger.info(`[UndoRedoService] Removed orphaned backup: ${file}`);
        } catch (error) {
          errors++;
          logger.warn(`[UndoRedoService] Failed to remove orphaned backup ${file}:`, error.message);
        }
      }
    }

    logger.info(
      `[UndoRedoService] Backup cleanup complete - removed ${removed} orphaned backups, ${errors} errors`
    );
    return { removed, errors };
  }

  getActionDescription(actionType, actionData) {
    const safe = actionData && typeof actionData === 'object' ? actionData : {};
    switch (actionType) {
      case 'FILE_MOVE':
        return `Move ${path.basename(safe.originalPath || '')} to ${path.dirname(safe.newPath || '')}`;
      case 'FILE_RENAME':
        return `Rename ${path.basename(safe.originalPath || '')} to ${path.basename(safe.newPath || '')}`;
      case 'FILE_DELETE':
        return `Delete ${path.basename(safe.originalPath || '')}`;
      case 'FOLDER_CREATE':
        return `Create folder ${path.basename(safe.folderPath || '')}`;
      case 'BATCH_ORGANIZE':
      case 'BATCH_OPERATION':
        return `Organize ${Array.isArray(safe.operations) ? safe.operations.length : 0} files`;
      default:
        return `Unknown action: ${actionType}`;
    }
  }

  generateId() {
    return generateSecureId();
  }

  getActionHistory(limit = 10) {
    const history = this.actions.slice(
      Math.max(0, this.currentIndex - limit + 1),
      this.currentIndex + 1
    );
    return history.map((action) => ({
      id: action.id,
      description: action.description,
      timestamp: action.timestamp,
      type: action.type
    }));
  }

  getRedoHistory(limit = 10) {
    const history = this.actions.slice(this.currentIndex + 1, this.currentIndex + 1 + limit);
    return history.map((action) => ({
      id: action.id,
      description: action.description,
      timestamp: action.timestamp,
      type: action.type
    }));
  }

  /**
   * Get the full undo/redo state for UI synchronization
   * @returns {Object} Full state including stack and pointer
   */
  getFullState() {
    return {
      stack: this.actions.map((action) => ({
        id: action.id,
        description: action.description,
        timestamp: action.timestamp,
        type: action.type,
        metadata: action.data
          ? {
              source: action.data.originalPath,
              destination: action.data.newPath,
              operationCount: action.data.operations?.length,
              operations: Array.isArray(action.data.operations)
                ? action.data.operations
                : undefined,
              newSettings: action.data.newSettings,
              oldSettings: action.data.oldSettings
            }
          : {}
      })),
      pointer: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    };
  }

  async clearHistory() {
    this.actions = [];
    this.currentIndex = -1;
    this.currentMemoryEstimate = 0; // Fixed: Reset memory estimate
    await this._saveActionsNow();
  }

  /**
   * Get memory and usage statistics
   * @returns {Object} Statistics about undo/redo usage
   */
  getStats() {
    return {
      totalActions: this.actions.length,
      currentIndex: this.currentIndex,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      memoryUsageMB: (this.currentMemoryEstimate / (1024 * 1024)).toFixed(2),
      memoryLimitMB: this.maxMemoryMB,
      actionLimit: this.maxActions,
      batchSizeLimit: this.maxBatchSize
    };
  }
}

module.exports = UndoRedoService;
