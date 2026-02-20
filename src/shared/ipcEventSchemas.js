/**
 * IPC Event Schemas
 *
 * Zod schemas for validating IPC event payloads sent between main and renderer processes.
 * These provide type safety and runtime validation for cross-process communication.
 *
 * Usage:
 * - Main process: Use safeSend() from ipcWrappers.js to validate before sending
 * - Renderer: Use validateEventData() in ipcMiddleware.js to validate on receipt
 */

const { logger } = require('./logger');

// Try to load zod for validation
let z;
let hasWarnedMissingZod = false;
try {
  z = require('zod');
} catch (error) {
  logger.warn('[ipcEventSchemas] Zod not available, schema validation disabled:', error.message);
  z = null;
}

const { IPC_CHANNELS, IPC_EVENTS } = require('./constants');

// Only define schemas if Zod is available
const schemas = z
  ? (() => {
      /**
       * Operation Progress Event
       * Emitted during batch operations, downloads, and background tasks
       * Shape varies based on `type` field
       */
      const operationProgressSchema = z.object({
        type: z
          .enum([
            'batch_organize',
            'batch_analyze',
            'model-download',
            'model-download-complete',
            'model-download-error',
            'dependency',
            'hint',
            'analyze'
          ])
          .optional(),
        current: z.number().optional(),
        total: z.number().optional(),
        percentage: z.number().min(0).max(100).optional(),
        message: z.string().optional(),
        phase: z.string().optional(),
        // For model-download type
        model: z.string().optional(),
        status: z.string().optional(),
        digest: z.string().optional(),
        completed: z.number().optional(),
        // For batch operations
        file: z.string().optional(),
        success: z.boolean().optional(),
        error: z.string().optional()
      });

      /**
       * Operation Complete Event
       * Emitted when a batch operation finishes successfully
       */
      const operationCompleteSchema = z.object({
        operationType: z.string(),
        affectedFiles: z.array(z.string()).optional(),
        duration: z.number().optional(),
        success: z.boolean().optional(),
        results: z.any().optional()
      });

      /**
       * Operation Error Event
       * Emitted when an operation fails
       */
      const operationErrorSchema = z.object({
        operationType: z.string(),
        error: z.string(),
        code: z.string().optional(),
        errorType: z.string().optional(),
        details: z.any().optional()
      });

      /**
       * File Operation Complete Event
       * Emitted after file move, delete, rename, or copy operations
       * Can be single file (oldPath/newPath) or batch (files/destinations)
       */
      const fileOperationCompleteSchema = z.object({
        operation: z.enum(['move', 'delete', 'rename', 'copy']),
        // Single file operation
        oldPath: z.string().optional(),
        newPath: z.string().optional(),
        // Batch operation
        files: z.array(z.string()).optional(),
        destinations: z.array(z.string()).optional()
      });

      /**
       * System Metrics Event
       * Periodic metrics broadcast from main process
       */
      const systemMetricsSchema = z.object({
        uptime: z.number().optional(),
        memory: z
          .object({
            used: z.number(),
            total: z.number(),
            percentage: z.number()
          })
          .optional(),
        cpu: z.number().optional(),
        // Extended metrics from systemAnalytics
        timestamp: z.number().optional(),
        processMemory: z.any().optional(),
        heapUsage: z.any().optional()
      });

      /**
       * Notification Event
       * Generic notification for toast display
       */
      const notificationSchema = z.object({
        id: z.string().optional(),
        message: z.string().optional(),
        title: z.string().optional(),
        severity: z.enum(['info', 'success', 'warning', 'error']).optional(),
        variant: z.enum(['info', 'success', 'warning', 'error']).optional(),
        duration: z.number().optional(),
        type: z.string().optional()
      });

      /**
       * App Error Event
       * Error notification from main process to renderer
       */
      const appErrorSchema = z.object({
        message: z.string().optional(),
        error: z.string().optional(),
        type: z.string().optional(),
        severity: z.enum(['critical', 'error', 'warning', 'info']).optional(),
        userMessage: z.string().optional(),
        code: z.string().optional(),
        stack: z.string().optional()
      });

      /**
       * Settings Changed External Event
       * Emitted when settings are changed programmatically
       */
      const settingsChangedExternalSchema = z.object({
        settings: z.any().optional(),
        source: z.string().optional(),
        timestamp: z.number().optional()
      });

      /**
       * Vector DB Status Changed Event
       * Emitted when Vector DB connection status changes.
       * Uses passthrough() so that normalizeServiceHealth() in ipcMiddleware
       * can read the `health` field without Zod stripping it.
       */
      const vectorDbStatusChangedSchema = z
        .object({
          status: z.enum([
            'connected',
            'disconnected',
            'connecting',
            'error',
            'online',
            'offline',
            'recovering',
            'circuit_changed',
            'operation_queued'
          ]),
          // Health field used by normalizeServiceHealth() for richer status mapping
          health: z.string().optional(),
          timestamp: z.number().optional(),
          error: z.string().optional()
        })
        .passthrough();

      /**
       * Menu Action Event
       * Emitted from application menu to trigger UI actions
       */
      const menuActionSchema = z.enum([
        'select-files',
        'select-folder',
        'open-settings',
        'show-about'
      ]);

      /**
       * App Update Event
       * Emitted during auto-update process
       */
      const appUpdateSchema = z.object({
        status: z.enum([
          'checking',
          'available',
          'not-available',
          'downloading',
          'downloaded',
          'error'
        ]),
        version: z.string().optional(),
        progress: z.number().optional(),
        error: z.string().optional()
      });

      /**
       * Open Semantic Search Event
       * Emitted from system tray or global shortcut to trigger semantic search UI
       */
      const openSemanticSearchSchema = z.void();

      /**
       * Batch Results Chunk Event
       * Emitted during batch operations to stream results progressively
       */
      const batchResultsChunkSchema = z.object({
        // Current payload shape emitted by main batchProgressReporter.
        batchId: z.string().optional(),
        chunk: z.array(z.any()).optional(),
        chunkIndex: z.number().int().nonnegative().optional(),
        totalChunks: z.number().int().nonnegative().optional(),
        isLast: z.boolean().optional(),
        // Legacy compatibility fields (older emitters / tests).
        results: z.array(z.any()).optional(),
        total: z.number().optional(),
        operationType: z.string().optional()
      });

      /**
       * Undo/Redo State Changed Event
       * Emitted after undo/redo operations to notify UI of state changes
       */
      const undoRedoStateChangedSchema = z.object({
        action: z.enum(['undo', 'redo']),
        result: z
          .object({
            success: z.boolean(),
            message: z.string().optional(),
            affectedFiles: z.array(z.string()).optional()
          })
          .optional()
      });

      return {
        operationProgressSchema,
        operationCompleteSchema,
        operationErrorSchema,
        fileOperationCompleteSchema,
        systemMetricsSchema,
        notificationSchema,
        appErrorSchema,
        settingsChangedExternalSchema,
        vectorDbStatusChangedSchema,
        menuActionSchema,
        appUpdateSchema,
        openSemanticSearchSchema,
        batchResultsChunkSchema,
        undoRedoStateChangedSchema
      };
    })()
  : {};

/**
 * Event channel to schema mapping
 * Maps IPC channel names to their validation schemas
 */
const EVENT_SCHEMAS = z
  ? {
      [IPC_EVENTS.OPERATION_PROGRESS]: schemas.operationProgressSchema,
      'operation-complete': schemas.operationCompleteSchema,
      'operation-error': schemas.operationErrorSchema,
      [IPC_EVENTS.FILE_OPERATION_COMPLETE]: schemas.fileOperationCompleteSchema,
      [IPC_EVENTS.SYSTEM_METRICS]: schemas.systemMetricsSchema,
      [IPC_EVENTS.NOTIFICATION]: schemas.notificationSchema,
      [IPC_EVENTS.APP_ERROR]: schemas.appErrorSchema,
      [IPC_EVENTS.SETTINGS_CHANGED_EXTERNAL]: schemas.settingsChangedExternalSchema,
      [IPC_CHANNELS.VECTOR_DB.STATUS_CHANGED]: schemas.vectorDbStatusChangedSchema,
      [IPC_EVENTS.MENU_ACTION]: schemas.menuActionSchema,
      [IPC_EVENTS.APP_UPDATE]: schemas.appUpdateSchema,
      [IPC_EVENTS.OPEN_SEMANTIC_SEARCH]: schemas.openSemanticSearchSchema,
      [IPC_EVENTS.BATCH_RESULTS_CHUNK]: schemas.batchResultsChunkSchema,
      [IPC_EVENTS.UNDO_REDO_STATE_CHANGED]: schemas.undoRedoStateChangedSchema
    }
  : {};

/**
 * Validate event payload against schema
 * @param {string} channel - IPC channel name
 * @param {*} data - Payload to validate
 * @returns {{ valid: boolean, data?: *, error?: * }}
 */
function validateEventPayload(channel, data) {
  if (!z) {
    // This ensures callers using strict mode won't send unvalidated payloads.
    if (!hasWarnedMissingZod) {
      hasWarnedMissingZod = true;
      logger.error(`[ipcEventSchemas] CRITICAL: Zod missing, validation will fail-closed`);
    }
    return { valid: false, error: 'Zod validation library not available', data };
  }

  const schema = EVENT_SCHEMAS[channel];
  if (!schema) {
    // No schema defined for this channel, allow through
    return { valid: true, data };
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    return {
      valid: false,
      error: result.error,
      data // Return original data for debugging
    };
  }

  return { valid: true, data: result.data };
}

/**
 * Get schema for a channel (for external use)
 * @param {string} channel - IPC channel name
 * @returns {*} Zod schema or undefined
 */
function getEventSchema(channel) {
  return EVENT_SCHEMAS[channel];
}

/**
 * Check if a channel has a defined schema
 * @param {string} channel - IPC channel name
 * @returns {boolean}
 */
function hasEventSchema(channel) {
  return Object.prototype.hasOwnProperty.call(EVENT_SCHEMAS, channel);
}

module.exports = {
  // Individual schemas (may be undefined if Zod not available)
  ...schemas,

  // Schema lookup map
  EVENT_SCHEMAS,

  // Utility functions
  validateEventPayload,
  getEventSchema,
  hasEventSchema,

  // Re-export Zod instance for convenience
  z
};
