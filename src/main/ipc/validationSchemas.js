/**
 * Common Validation Schemas for IPC Handlers
 *
 * Centralized Zod schemas for validating IPC input data.
 * These schemas ensure type safety and provide clear error messages.
 */

// Try to load zod
let z;
let zodLoadError = null;
try {
  z = require('zod');
} catch (error) {
  if (process.env.NODE_ENV === 'test') {
    // Surface why zod could not be loaded during tests
    // eslint-disable-next-line no-console
    console.warn('zod import failed in validationSchemas', error);
  }
  zodLoadError = error;
  z = null;
}

// Export null schemas if zod is not available
if (!z) {
  module.exports = {
    z: null,
    schemas: null,
    zodLoadError,
    filePathSchema: null,
    settingsSchema: null,
    smartFolderSchema: null,
    batchOperationSchema: null,
    searchQuerySchema: null,
    paginationSchema: null
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
   */
  const relaxedUrlRegex = /^(?:https?:\/\/)?(?:[\w.-]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/;
  const optionalUrlSchema = z
    .string()
    .trim()
    .optional()
    .or(z.literal(''))
    .refine(
      (val) => val === '' || relaxedUrlRegex.test(val),
      'Invalid Ollama URL format (expected host[:port] with optional http/https)'
    );

  /**
   * Model name validation - alphanumeric with common separators
   */
  const modelNameSchema = z
    .string()
    .regex(
      /^[a-zA-Z0-9._:@-]+$/,
      'Model name must be alphanumeric with hyphens, underscores, dots, @, or colons'
    )
    .max(100, 'Model name too long (max 100 chars)')
    .optional();

  // ===== Settings Schemas =====

  /**
   * Settings object validation
   */
  const settingsSchema = z
    .object({
      ollamaHost: optionalUrlSchema,
      textModel: modelNameSchema,
      visionModel: modelNameSchema,
      embeddingModel: modelNameSchema,
      launchOnStartup: z.boolean().optional(),
      autoOrganize: z.boolean().optional(),
      backgroundMode: z.boolean().optional(),
      theme: z.enum(['light', 'dark', 'auto']).optional(),
      language: z.string().max(10).optional(),
      loggingLevel: z.enum(['error', 'warn', 'info', 'debug']).optional(),
      cacheSize: z.number().int().min(0).max(100000).optional(),
      maxBatchSize: z.number().int().min(0).max(100000).optional()
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
  const fileOperationSchema = z.object({
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
    accepted: z.boolean()
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
   * Smart folder matching input
   */
  const smartFolderMatchSchema = z.object({
    text: z.string().min(1, 'Text is required for matching'),
    smartFolders: z.array(smartFolderSchema).min(1)
  });

  // ===== Ollama Schemas =====

  /**
   * Ollama connection test input
   */
  const ollamaHostSchema = z.string().url().or(z.string().length(0)).optional();

  /**
   * Ollama model pull input
   */
  const ollamaPullSchema = z.array(z.string().min(1));

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
    strategyApplication: strategyApplicationSchema,

    // Embeddings
    findSimilar: findSimilarSchema,

    // Ollama
    ollamaHost: ollamaHostSchema,
    ollamaPull: ollamaPullSchema,

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
