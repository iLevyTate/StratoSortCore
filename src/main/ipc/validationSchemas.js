/**
 * Common Validation Schemas for IPC Handlers
 *
 * Centralized Zod schemas for validating IPC input data.
 * These schemas ensure type safety and provide clear error messages.
 */

const { URL_PATTERN } = require('../../shared/settingsValidation');
const { CHAT_PERSONAS } = require('../../shared/chatPersonas');
const {
  LOGGING_LEVELS,
  NUMERIC_LIMITS,
  NOTIFICATION_MODES,
  NAMING_CONVENTIONS,
  CASE_CONVENTIONS,
  SMART_FOLDER_ROUTING_MODES,
  SEPARATOR_PATTERN,
  MODEL_NAME_PATTERN,
  MAX_MODEL_NAME_LENGTH
} = require('../../shared/validationConstants');
const { collapseDuplicateProtocols } = require('../../shared/urlUtils');
const { logger } = require('../../shared/logger');

// Try to load zod
let z;
let zodLoadError = null;
try {
  z = require('zod');
} catch (error) {
  if (process.env.NODE_ENV === 'test') {
    // FIX: Use logger instead of console.warn for consistency
    logger.warn('zod import failed in validationSchemas', { error: error.message });
  }
  zodLoadError = error;
  z = null;
}

// FIX: Provide fallback validation when Zod is not available
// This ensures basic type checking even without Zod, preventing security bypasses
if (!z) {
  // Create simple fallback validators that provide basic type safety
  const createFallbackValidator = (name, validator) => ({
    parse: (data) => {
      const result = validator(data);
      if (result.error) {
        const error = new Error(result.error);
        error.name = 'ValidationError';
        throw error;
      }
      return result.data !== undefined ? result.data : data;
    },
    safeParse: (data) => {
      try {
        const result = validator(data);
        if (result.error) {
          return { success: false, error: { message: result.error } };
        }
        return { success: true, data: result.data !== undefined ? result.data : data };
      } catch (e) {
        return { success: false, error: { message: e.message } };
      }
    },
    _isFallback: true,
    _name: name
  });

  // Basic fallback validators for critical schemas
  const fallbackFilePathSchema = createFallbackValidator('filePath', (data) => {
    if (typeof data !== 'string' || data.length === 0) {
      return { error: 'File path must be a non-empty string' };
    }
    return { data };
  });

  const fallbackSettingsSchema = createFallbackValidator('settings', (data) => {
    if (typeof data !== 'object' || data === null) {
      return { error: 'Settings must be an object' };
    }
    // Basic sanitization - remove dangerous keys
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      // Use defineProperty to avoid triggering special setters (e.g. __proto__) on assignment
      Object.defineProperty(sanitized, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return { data: sanitized };
  });

  const fallbackSmartFolderSchema = createFallbackValidator('smartFolder', (data) => {
    if (typeof data !== 'object' || data === null) {
      return { error: 'Smart folder must be an object' };
    }
    if (typeof data.name !== 'string' || data.name.length === 0) {
      return { error: 'Smart folder name is required' };
    }
    if (typeof data.path !== 'string' || data.path.length === 0) {
      return { error: 'Smart folder path is required' };
    }
    return { data };
  });

  const fallbackSearchQuerySchema = createFallbackValidator('searchQuery', (data) => {
    if (typeof data !== 'object' || data === null) {
      return { error: 'Search query must be an object' };
    }
    if (data.query !== undefined && typeof data.query !== 'string') {
      return { error: 'Search query.query must be a string' };
    }
    if (
      data.limit !== undefined &&
      (typeof data.limit !== 'number' || data.limit < 1 || data.limit > 1000)
    ) {
      return { error: 'Search query limit must be a number between 1 and 1000' };
    }
    if (data.offset !== undefined && (typeof data.offset !== 'number' || data.offset < 0)) {
      return { error: 'Search query offset must be a non-negative number' };
    }
    return { data };
  });

  const fallbackPaginationSchema = createFallbackValidator('pagination', (data) => {
    if (typeof data !== 'object' || data === null) {
      return { error: 'Pagination must be an object' };
    }
    if (
      data.limit !== undefined &&
      (typeof data.limit !== 'number' || data.limit < 1 || data.limit > 1000)
    ) {
      return { error: 'Limit must be a number between 1 and 1000' };
    }
    if (data.offset !== undefined && (typeof data.offset !== 'number' || data.offset < 0)) {
      return { error: 'Offset must be a non-negative number' };
    }
    return { data };
  });

  const fallbackBatchOperationSchema = createFallbackValidator('batchOperation', (data) => {
    if (typeof data !== 'object' || data === null) {
      return { error: 'Batch operation must be an object' };
    }
    if (!Array.isArray(data.operations) || data.operations.length === 0) {
      return { error: 'Batch operation requires a non-empty operations array' };
    }
    if (data.operations.length > 1000) {
      return { error: 'Batch size exceeds maximum of 1000' };
    }
    for (let i = 0; i < data.operations.length; i++) {
      const op = data.operations[i];
      if (!op || typeof op !== 'object') {
        return { error: `Operation at index ${i} must be an object` };
      }
      if (typeof op.source !== 'string' || op.source.length === 0) {
        return { error: `Operation at index ${i} requires a non-empty source string` };
      }
      if (typeof op.destination !== 'string' || op.destination.length === 0) {
        return { error: `Operation at index ${i} requires a non-empty destination string` };
      }
    }
    return { data };
  });

  logger.warn('[validationSchemas] Zod not available, using fallback validation', {
    error: zodLoadError?.message
  });

  module.exports = {
    z: null,
    schemas: {
      filePath: fallbackFilePathSchema,
      settings: fallbackSettingsSchema,
      smartFolder: fallbackSmartFolderSchema,
      searchQuery: fallbackSearchQuerySchema,
      pagination: fallbackPaginationSchema,
      batchOrganize: fallbackBatchOperationSchema
    },
    zodLoadError,
    filePathSchema: fallbackFilePathSchema,
    settingsSchema: fallbackSettingsSchema,
    smartFolderSchema: fallbackSmartFolderSchema,
    batchOperationSchema: fallbackBatchOperationSchema,
    searchQuerySchema: fallbackSearchQuerySchema,
    paginationSchema: fallbackPaginationSchema,
    _usingFallback: true
  };
} else {
  // ===== Primitive Schemas =====

  /**
   * File path validation - non-empty string
   */
  const filePathSchema = z.string().min(1, 'File path is required');

  /**
   * Directory path validation - non-empty string
   */
  const directoryPathSchema = z.string().min(1, 'Directory path is required');

  /**
   * Optional URL validation (relaxed: protocol optional, trims whitespace)
   *
   * Also supports extracting a URL from common pasted commands (e.g. `curl http://127.0.0.1:8080/api/endpoint`).
   * Uses optional+nullable to allow both undefined and null values.
   * Uses shared URL_PATTERN from settingsValidation.js
   */
  const extractUrlLikeToken = (raw) => {
    if (typeof raw !== 'string') return raw;
    let s = raw.trim();
    if (!s) return '';

    // Strip surrounding quotes commonly added when copying values
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'")) ||
      (s.startsWith('`') && s.endsWith('`'))
    ) {
      s = s.slice(1, -1).trim();
    }

    // If the user pasted a full command (e.g. "curl ..."), try to extract a URL-like token.
    if (/\s/.test(s)) {
      // Prefer explicit http(s) URLs first.
      const httpMatch = s.match(/https?:\/\/[^\s"'`]+/i);
      if (httpMatch?.[0]) {
        s = httpMatch[0];
      } else {
        // Otherwise, scan tokens for host[:port][/path] and skip command words like "curl".
        const tokens = s.split(/\s+/).map((t) => t.replace(/^[("'`]+|[)"'`,;]+$/g, '').trim());
        const isLikelyHost = (t) => {
          if (!t) return false;
          const lower = t.toLowerCase();
          if (['curl', 'wget', 'powershell', 'pwsh', 'invoke-restmethod', 'irm'].includes(lower)) {
            return false;
          }
          // Heuristics: "localhost", IPv4, or something containing "." or ":".
          if (lower.startsWith('localhost')) return true;
          if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?(?:\/.*)?$/.test(t)) return true;
          if (t.includes('.') || t.includes(':')) return true;
          return false;
        };

        const candidate = tokens.find((t) => isLikelyHost(t) && URL_PATTERN.test(t));
        if (candidate) s = candidate;
      }
    }

    // Trim trailing punctuation that often comes from prose/snippets
    s = s.replace(/[),;]+$/, '').trim();

    // Collapse duplicate protocols (e.g. "http://http://127.0.0.1:8080")
    // so validation and downstream normalization don't reject common paste mistakes.
    s = collapseDuplicateProtocols(s);
    return s;
  };

  const optionalUrlSchema = z
    .preprocess(extractUrlLikeToken, z.string())
    .refine(
      (val) => val === undefined || val === null || val === '' || URL_PATTERN.test(val),
      'Invalid URL format (expected host[:port] with optional http/https)'
    )
    .optional()
    .nullable();

  /**
   * Model name validation - alphanumeric with common separators
   * Uses .nullish() to allow both null and undefined values
   * Regex allows forward slashes for registry-style names (e.g., library/model)
   */
  const modelNameSchema = z
    .string()
    .regex(MODEL_NAME_PATTERN, 'Model name contains invalid characters')
    .max(MAX_MODEL_NAME_LENGTH, `Model name too long (max ${MAX_MODEL_NAME_LENGTH} chars)`)
    .nullish();

  const chatPersonaSchema = z.enum(CHAT_PERSONAS.map((persona) => persona.id)).nullish();

  // ===== Settings Schemas =====

  /**
   * Settings object validation
   * Uses shared constants from validationConstants.js
   */
  const settingsSchema = z
    .object({
      // AI Models & Config
      textModel: modelNameSchema,
      visionModel: modelNameSchema,
      embeddingModel: modelNameSchema,
      // Embedding workflow controls
      embeddingTiming: z.enum(['during_analysis', 'after_organize', 'manual']).nullish(),
      defaultEmbeddingPolicy: z.enum(['embed', 'skip', 'web_only']).nullish(),
      embeddingScope: z.enum(['all_analyzed', 'smart_folders_only']).nullish(),
      chatPersona: chatPersonaSchema,
      chatResponseMode: z.enum(['fast', 'deep']).nullish(),
      // Application Behavior
      launchOnStartup: z.boolean().nullish(),
      autoOrganize: z.boolean().nullish(),
      backgroundMode: z.boolean().nullish(),
      autoChunkOnAnalysis: z.boolean().nullish(),
      autoUpdateCheck: z.boolean().nullish(),
      telemetryEnabled: z.boolean().nullish(),

      // UI Preferences
      language: z.string().max(20).nullish(),
      loggingLevel: z.enum(LOGGING_LEVELS).nullish(),

      // Performance
      cacheSize: z
        .number()
        .int()
        .min(NUMERIC_LIMITS.cacheSize.min)
        .max(NUMERIC_LIMITS.cacheSize.max)
        .nullish(),
      maxBatchSize: z
        .number()
        .int()
        .min(NUMERIC_LIMITS.maxBatchSize.min)
        .max(NUMERIC_LIMITS.maxBatchSize.max)
        .nullish(),

      // Notification settings
      notifications: z.boolean().nullish(),
      notificationMode: z.enum(NOTIFICATION_MODES).nullish(),
      notifyOnAutoAnalysis: z.boolean().nullish(),
      notifyOnLowConfidence: z.boolean().nullish(),

      // Organization settings
      confidenceThreshold: z.number().min(0).max(1).nullish(),
      defaultSmartFolderLocation: z.string().max(500).nullish(),
      smartFolderRoutingMode: z.enum(SMART_FOLDER_ROUTING_MODES).nullish(),
      maxConcurrentAnalysis: z.number().int().min(1).max(10).nullish(),
      lastBrowsedPath: z.string().max(1000).nullish(),

      // Naming convention settings
      namingConvention: z.enum(NAMING_CONVENTIONS).nullish(),
      dateFormat: z.string().nullish(),
      caseConvention: z.enum(CASE_CONVENTIONS).nullish(),
      separator: z.string().regex(SEPARATOR_PATTERN).nullish(),

      // File size limits
      maxFileSize: z
        .number()
        .int()
        .min(1024 * 1024)
        .nullish(),
      maxImageFileSize: z
        .number()
        .int()
        .min(1024 * 1024)
        .nullish(),
      maxDocumentFileSize: z
        .number()
        .int()
        .min(1024 * 1024)
        .nullish(),
      maxTextFileSize: z
        .number()
        .int()
        .min(1024 * 1024)
        .nullish(),

      // Processing limits
      analysisTimeout: z.number().int().min(10000).nullish(),
      fileOperationTimeout: z.number().int().min(1000).nullish(),
      retryAttempts: z.number().int().min(0).nullish(),

      // UI limits
      workflowRestoreMaxAge: z.number().int().min(60000).nullish(),
      saveDebounceMs: z.number().int().min(100).nullish(),

      // Graph-aware retrieval (GraphRAG-lite)
      graphExpansionEnabled: z.boolean().nullish(),
      graphExpansionWeight: z.number().min(0).max(1).nullish(),
      graphExpansionMaxNeighbors: z.number().int().min(10).max(500).nullish(),
      chunkContextEnabled: z.boolean().nullish(),
      chunkContextMaxNeighbors: z.number().int().min(0).max(3).nullish(),

      // Llama engine tuning
      llamaGpuLayers: z.number().int().min(-1).nullish(),
      llamaContextSize: z.number().int().min(512).max(131072).nullish(),

      // Vector DB persistence (relative to userData)
      vectorDbPersistPath: z.string().min(1).max(200).nullish(),

      // Internal schema version for settings migrations
      settingsSchemaVersion: z.number().int().min(1).nullish(),

      // Deprecated settings (kept for backward compatibility)
      smartFolderWatchEnabled: z.boolean().nullish()
    })
    .partial();

  // ===== Smart Folder Schemas =====

  /**
   * Smart folder object validation
   */
  const smartFolderSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(1, 'Folder name is required').max(255, 'Folder name too long'),
    path: z.string().min(1, 'Folder path is required'),
    description: z.string().max(1000).optional(),
    keywords: z.array(z.string()).optional(),
    category: z.string().optional(),
    isDefault: z.boolean().optional()
  });

  /**
   * Array of smart folders
   */
  const smartFoldersArraySchema = z.array(smartFolderSchema);

  /**
   * Smart folder edit input (folderId + updated data)
   */
  const smartFolderEditSchema = z.tuple([
    z.string().min(1, 'Folder ID is required'),
    smartFolderSchema.partial()
  ]);

  // ===== File Operation Schemas =====

  /**
   * Single file operation
   */
  const fileOperationSchema = z
    .object({
      type: z.enum(['move', 'copy', 'delete', 'batch_organize']),
      source: z.string().optional(),
      destination: z.string().optional(),
      operations: z
        .array(
          z.object({
            source: z.string(),
            destination: z.string(),
            type: z.string().optional()
          })
        )
        .optional()
    })
    .superRefine((value, ctx) => {
      if (value.type === 'batch_organize') {
        if (!Array.isArray(value.operations) || value.operations.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['operations'],
            message: 'Batch organize requires at least one operation'
          });
        }
      }
    });

  /**
   * Batch organize operation
   */
  const batchOrganizeSchema = z.object({
    operations: z
      .array(
        z.object({
          source: z.string().min(1),
          destination: z.string().min(1),
          type: z.string().optional()
        })
      )
      .min(1, 'At least one operation is required')
      .max(1000, 'Batch size exceeds maximum of 1000')
  });

  // ===== Analysis Schemas =====

  /**
   * File object for analysis
   */
  const analysisFileSchema = z.object({
    path: z.string().min(1),
    name: z.string().optional(),
    extension: z.string().optional(),
    size: z.number().optional(),
    type: z.string().optional(),
    analysis: z.object({}).passthrough().optional()
  });

  /**
   * Batch analysis input
   */
  const batchAnalysisSchema = z.object({
    files: z.array(analysisFileSchema).min(1),
    options: z.object({}).passthrough().optional()
  });

  // ===== Search/Query Schemas =====

  /**
   * Pagination options
   */
  const paginationSchema = z.object({
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional()
  });

  /**
   * Search query with pagination
   */
  const searchQuerySchema = z.object({
    query: z.string().optional(),
    limit: z.number().int().min(1).max(1000).optional(),
    offset: z.number().int().min(0).optional(),
    all: z.boolean().optional()
  });

  /**
   * History options
   */
  const historyOptionsSchema = z.object({
    limit: z.union([z.number().int().positive(), z.literal('all')]).optional(),
    offset: z.number().int().min(0).optional(),
    all: z.boolean().optional()
  });

  // ===== Organization Schemas =====

  /**
   * Auto-organize input
   */
  const autoOrganizeSchema = z.object({
    files: z.array(analysisFileSchema),
    smartFolders: z.array(smartFolderSchema).optional(),
    options: z.object({}).passthrough().optional()
  });

  /**
   * Organization thresholds
   */
  const thresholdsSchema = z.object({
    thresholds: z.object({
      autoApprove: z.number().min(0).max(1).optional(),
      review: z.number().min(0).max(1).optional(),
      reject: z.number().min(0).max(1).optional()
    })
  });

  // ===== Suggestion Schemas =====

  /**
   * Single file suggestion input
   */
  const fileSuggestionSchema = z.object({
    file: analysisFileSchema,
    options: z.object({}).passthrough().optional()
  });

  /**
   * Batch suggestion input
   */
  const batchSuggestionSchema = z.object({
    files: z.array(analysisFileSchema),
    options: z.object({}).passthrough().optional()
  });

  /**
   * Feedback recording input
   */
  const feedbackSchema = z.object({
    file: analysisFileSchema,
    suggestion: z.object({
      folder: z.string().optional(),
      confidence: z.number().optional()
    }),
    accepted: z.boolean(),
    note: z.string().max(500).optional()
  });

  /**
   * Feedback memory add input
   */
  const feedbackMemoryAddSchema = z.object({
    text: z.string().min(2).max(500),
    metadata: z.object({}).passthrough().optional()
  });

  /**
   * Feedback memory delete input
   */
  const feedbackMemoryDeleteSchema = z.object({
    id: z.string().min(1)
  });

  /**
   * Feedback memory update input
   */
  const feedbackMemoryUpdateSchema = z.object({
    id: z.string().min(1),
    text: z.string().min(2).max(500),
    metadata: z.object({}).passthrough().optional()
  });

  /**
   * Strategy application input
   */
  const strategyApplicationSchema = z.object({
    files: z.array(analysisFileSchema),
    strategyId: z.string().min(1)
  });

  // ===== Embeddings Schemas =====

  /**
   * Find similar files input
   */
  const findSimilarSchema = z.object({
    fileId: z.string().min(1, 'File ID is required'),
    topK: z.number().int().min(1).max(100).optional().default(10)
  });

  /**
   * Semantic search parameters
   * FIX P1-5: Add Zod schema for SEARCH handler validation
   */
  const semanticSearchSchema = z.object({
    query: z
      .string()
      .min(2, 'Query must be at least 2 characters')
      .max(2000, 'Query too long (max 2000)'),
    topK: z.number().int().min(1).max(100).optional().default(20),
    mode: z.enum(['hybrid', 'vector', 'bm25']).optional().default('hybrid'),
    minScore: z.number().min(0).max(1).optional(),
    chunkWeight: z.number().min(0).max(1).optional(),
    chunkTopK: z.number().int().min(1).max(2000).optional(),
    graphExpansion: z.boolean().optional(),
    graphExpansionWeight: z.number().min(0).max(1).optional(),
    graphExpansionMaxNeighbors: z.number().int().min(1).max(500).optional(),
    chunkContext: z.boolean().optional(),
    chunkContextMaxNeighbors: z.number().int().min(0).max(3).optional()
  });

  /**
   * Score files against query
   * FIX P1-5: Add Zod schema for SCORE_FILES handler validation
   */
  const scoreFilesSchema = z.object({
    query: z
      .string()
      .min(2, 'Query must be at least 2 characters')
      .max(2000, 'Query too long (max 2000)'),
    fileIds: z
      .array(z.string().min(1).max(2048))
      .min(1, 'At least one file ID is required')
      .max(1000, 'Maximum 1000 file IDs allowed')
  });

  /**
   * Cluster computation parameters
   * FIX P1-5: Add Zod schema for COMPUTE_CLUSTERS handler validation
   */
  const computeClustersSchema = z.object({
    k: z
      .union([z.literal('auto'), z.number().int().min(1).max(100)])
      .optional()
      .default('auto'),
    generateLabels: z.boolean().optional().default(true)
  });

  /**
   * Get cluster members parameters
   */
  const getClusterMembersSchema = z.object({
    clusterId: z.number().int().min(0, 'Cluster ID must be a non-negative integer')
  });

  /**
   * Similarity edges parameters
   * FIX P1-5: Add Zod schema for GET_SIMILARITY_EDGES handler validation
   */
  const similarityEdgesSchema = z.object({
    fileIds: z
      .array(z.string().min(1).max(2048))
      .min(2, 'At least 2 file IDs required for similarity edges')
      .max(500, 'Maximum 500 file IDs for performance'),
    threshold: z.number().min(0).max(1).optional().default(0.5),
    maxEdgesPerNode: z.number().int().min(1).max(20).optional().default(5)
  });

  /**
   * File metadata parameters
   */
  const getFileMetadataSchema = z.object({
    fileIds: z.array(z.string().min(1).max(2048)).max(100, 'Maximum 100 file IDs per request')
  });

  /**
   * Knowledge relationship edges parameters
   */
  const relationshipEdgesSchema = z.object({
    fileIds: z
      .array(z.string().min(1).max(2048))
      .min(2, 'At least 2 file IDs required')
      .max(500, 'Maximum 500 file IDs for performance'),
    minWeight: z.number().int().min(1).max(20).optional().default(2),
    maxEdges: z.number().int().min(1).max(2000).optional().default(500)
  });

  /**
   * Knowledge relationship index stats parameters
   */
  const relationshipStatsSchema = z.object({}).optional().default({});

  /**
   * Chat query parameters
   */
  const chatQuerySchema = z.object({
    sessionId: z.string().min(1).max(128).optional(),
    requestId: z.union([z.string().min(1).max(128), z.number().int().nonnegative()]).optional(),
    query: z
      .string()
      .min(2, 'Query must be at least 2 characters')
      .max(2000, 'Query too long (max 2000)'),
    topK: z.number().int().min(1).max(20).optional().default(6),
    mode: z.enum(['hybrid', 'vector', 'bm25']).optional().default('hybrid'),
    chunkTopK: z.number().int().min(1).max(2000).optional(),
    chunkWeight: z.number().min(0).max(1).optional(),
    contextFileIds: z.array(z.string().min(1).max(2048)).max(1000).optional(),
    documentScopeItems: z
      .array(
        z.object({
          id: z.string().min(1).max(2048),
          path: z.string().min(1).max(8192),
          name: z.string().min(1).max(2048).optional(),
          type: z.string().min(1).max(128).optional()
        })
      )
      .max(1000)
      .optional(),
    strictScope: z.boolean().optional().default(false),
    responseMode: z.enum(['fast', 'deep']).optional().default('fast')
  });

  /**
   * Chat session reset parameters
   */
  const chatResetSchema = z.object({
    sessionId: z.string().min(1).max(128).optional()
  });

  /**
   * Chat stream cancel parameters
   */
  const chatCancelSchema = z.object({
    requestId: z.union([z.string().min(1).max(128), z.number().int().nonnegative()]).optional(),
    sessionId: z.string().min(1).max(128).optional()
  });

  /**
   * Find duplicates parameters
   * FIX P1-5: Add Zod schema for FIND_DUPLICATES handler validation
   */
  const findDuplicatesSchema = z.object({
    threshold: z.number().min(0.7).max(1).optional().default(0.9),
    maxResults: z.number().int().min(1).max(200).optional().default(50)
  });

  /**
   * Smart folder matching input
   */
  const smartFolderMatchSchema = z.object({
    text: z.string().min(1, 'Text is required for matching'),
    smartFolders: z.array(smartFolderSchema).min(1)
  });

  // ===== Chat History Schemas =====

  /**
   * Chat conversation list parameters
   */
  const chatListConversationsSchema = z.object({
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional()
  });

  /**
   * Chat conversation ID parameter
   */
  const chatConversationIdSchema = z.object({
    id: z.string().min(1, 'Conversation ID is required').max(256)
  });

  /**
   * Chat conversation search parameter
   */
  const chatSearchConversationsSchema = z.object({
    query: z.string().min(1, 'Search query is required').max(500)
  });

  // ===== System Schemas =====

  /**
   * System log input validation
   */
  const systemLogSchema = z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']),
    message: z.string().min(1).max(8192),
    data: z.record(z.string(), z.any()).optional()
  });

  /**
   * Config path validation (dot-separated, alphanumeric + underscores)
   */
  const configPathSchema = z
    .string()
    .min(1, 'Config path is required')
    .max(120)
    .regex(/^[A-Za-z0-9_.-]+$/, 'Config path contains invalid characters');

  // ===== Undo/Redo Schemas =====

  /**
   * History limit parameter
   */
  const historyLimitSchema = z.number().int().min(1).max(500).optional();

  // ===== Organization Extended Schemas =====

  /**
   * Process new file input
   */
  const processNewSchema = z.object({
    filePath: z.string().min(1),
    options: z.object({}).passthrough().optional()
  });

  /**
   * Cluster batch input
   */
  const clusterBatchSchema = z.object({
    files: z.array(analysisFileSchema).min(1),
    smartFolders: z.array(smartFolderSchema).optional()
  });

  /**
   * Identify outliers input
   */
  const identifyOutliersSchema = z.object({
    files: z.array(analysisFileSchema).min(1)
  });

  /**
   * Cluster suggestions input
   */
  const clusterSuggestionsSchema = z.object({
    file: analysisFileSchema,
    smartFolders: z.array(smartFolderSchema).optional()
  });

  // ===== Suggestion Extended Schemas =====

  /**
   * Folder structure analysis input
   */
  const analyzeFolderStructureSchema = z.object({
    files: z.array(analysisFileSchema).min(1)
  });

  /**
   * Suggest new folder input
   */
  const suggestNewFolderSchema = z.object({
    file: analysisFileSchema
  });

  // ===== Analysis History Extended Schemas =====

  /**
   * Analysis history search input
   */
  const analysisHistorySearchSchema = z.tuple([
    z.string().min(1, 'Search query is required').max(500),
    z.object({}).passthrough().optional()
  ]);

  /**
   * Embedding policy input
   */
  const embeddingPolicySchema = z.object({
    filePath: z.string().min(1),
    policy: z.enum(['embed', 'skip', 'web_only'])
  });

  /**
   * Analysis history export format
   */
  const analysisExportFormatSchema = z.enum(['json', 'csv']).optional().default('json');

  // ===== Backup Schemas =====

  /**
   * Backup path input
   */
  const backupPathSchema = z.string().min(1, 'Backup path is required');

  // ===== Export all schemas =====
  const schemas = {
    // Primitives
    filePath: filePathSchema,
    directoryPath: directoryPathSchema,
    optionalUrl: optionalUrlSchema,
    modelName: modelNameSchema,

    // Settings
    settings: settingsSchema,

    // Smart Folders
    smartFolder: smartFolderSchema,
    smartFoldersArray: smartFoldersArraySchema,
    smartFolderEdit: smartFolderEditSchema,
    smartFolderMatch: smartFolderMatchSchema,

    // File Operations
    fileOperation: fileOperationSchema,
    batchOrganize: batchOrganizeSchema,

    // Analysis
    analysisFile: analysisFileSchema,
    batchAnalysis: batchAnalysisSchema,

    // Search/Query
    pagination: paginationSchema,
    searchQuery: searchQuerySchema,
    historyOptions: historyOptionsSchema,

    // Organization
    autoOrganize: autoOrganizeSchema,
    thresholds: thresholdsSchema,

    // Suggestions
    fileSuggestion: fileSuggestionSchema,
    batchSuggestion: batchSuggestionSchema,
    feedback: feedbackSchema,
    feedbackMemoryAdd: feedbackMemoryAddSchema,
    feedbackMemoryDelete: feedbackMemoryDeleteSchema,
    feedbackMemoryUpdate: feedbackMemoryUpdateSchema,
    strategyApplication: strategyApplicationSchema,

    // Embeddings
    findSimilar: findSimilarSchema,
    semanticSearch: semanticSearchSchema,
    scoreFiles: scoreFilesSchema,
    computeClusters: computeClustersSchema,
    getClusterMembers: getClusterMembersSchema,
    similarityEdges: similarityEdgesSchema,
    getFileMetadata: getFileMetadataSchema,
    findDuplicates: findDuplicatesSchema,
    relationshipEdges: relationshipEdgesSchema,
    relationshipStats: relationshipStatsSchema,

    // Chat
    chatQuery: chatQuerySchema,
    chatReset: chatResetSchema,
    chatCancel: chatCancelSchema,
    chatListConversations: chatListConversationsSchema,
    chatConversationId: chatConversationIdSchema,
    chatSearchConversations: chatSearchConversationsSchema,

    // System
    systemLog: systemLogSchema,
    configPath: configPathSchema,

    // Undo/Redo
    historyLimit: historyLimitSchema,

    // Organization (extended)
    processNew: processNewSchema,
    clusterBatch: clusterBatchSchema,
    identifyOutliers: identifyOutliersSchema,
    clusterSuggestions: clusterSuggestionsSchema,

    // Suggestions (extended)
    analyzeFolderStructure: analyzeFolderStructureSchema,
    suggestNewFolder: suggestNewFolderSchema,

    // Analysis History (extended)
    analysisHistorySearch: analysisHistorySearchSchema,
    embeddingPolicy: embeddingPolicySchema,
    analysisExportFormat: analysisExportFormatSchema,

    // Backup
    backupPath: backupPathSchema
  };

  module.exports = {
    z,
    schemas,
    zodLoadError,
    // Also export individual schemas for convenience
    ...schemas
  };
}
