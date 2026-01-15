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

// Try to load zod for validation
let z;
try {
  z = require('zod');
} catch (error) {
  // Zod not available - schemas will be null
  z = null;
}

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
          .enum(['batch_organize', 'batch_analyze', 'ollama-pull', 'dependency', 'hint', 'analyze'])
          .optional(),
        current: z.number().optional(),
        total: z.number().optional(),
        percentage: z.number().min(0).max(100).optional(),
        message: z.string().optional(),
        phase: z.string().optional(),
        // For ollama-pull type
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
       * ChromaDB Status Changed Event
       * Emitted when ChromaDB connection status changes
       */
      const chromadbStatusChangedSchema = z.object({
        status: z.enum(['connected', 'disconnected', 'connecting', 'error']),
        timestamp: z.number().optional(),
        error: z.string().optional()
      });

      /**
       * Service Status Changed Event
       * Emitted when any dependency service status changes
       */
      const serviceStatusChangedSchema = z.object({
        timestamp: z.number().optional(),
        service: z.string().optional(),
        status: z.string().optional(),
        details: z.any().optional()
      });

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
      const openSemanticSearchSchema = z.undefined().optional();

      /**
       * Batch Results Chunk Event
       * Emitted during batch operations to stream results progressively
       */
      const batchResultsChunkSchema = z.object({
        results: z.array(z.any()).optional(),
        chunk: z.number().optional(),
        total: z.number().optional(),
        operationType: z.string().optional()
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
        chromadbStatusChangedSchema,
        serviceStatusChangedSchema,
        menuActionSchema,
        appUpdateSchema,
        openSemanticSearchSchema,
        batchResultsChunkSchema
      };
    })()
  : {};

/**
 * Event channel to schema mapping
 * Maps IPC channel names to their validation schemas
 */
const EVENT_SCHEMAS = z
  ? {
      'operation-progress': schemas.operationProgressSchema,
      'operation-complete': schemas.operationCompleteSchema,
      'operation-error': schemas.operationErrorSchema,
      'file-operation-complete': schemas.fileOperationCompleteSchema,
      'system-metrics': schemas.systemMetricsSchema,
      notification: schemas.notificationSchema,
      'app:error': schemas.appErrorSchema,
      'settings-changed-external': schemas.settingsChangedExternalSchema,
      'chromadb-status-changed': schemas.chromadbStatusChangedSchema,
      'dependencies-service-status-changed': schemas.serviceStatusChangedSchema,
      'menu-action': schemas.menuActionSchema,
      'app:update': schemas.appUpdateSchema,
      'open-semantic-search': schemas.openSemanticSearchSchema,
      'batch-results-chunk': schemas.batchResultsChunkSchema
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
    // Zod not available, skip validation
    return { valid: true, data };
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
  return channel in EVENT_SCHEMAS;
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
