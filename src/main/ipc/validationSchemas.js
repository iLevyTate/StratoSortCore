/**
 * Common Validation Schemas for IPC Handlers
 *
 * Centralized Zod schemas for validating IPC input data.
 * These schemas ensure type safety and provide clear error messages.
 */

const { URL_PATTERN } = require('../../shared/settingsValidation');
const {
  THEME_VALUES,
  LOGGING_LEVELS,
  NUMERIC_LIMITS
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
   *
   * Also supports extracting a URL from common pasted commands (e.g. `curl http://127.0.0.1:11434/api/tags`).
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

    // Collapse duplicate protocols (e.g. "http://http://127.0.0.1:11434")
    // so validation and downstream normalization don't reject common paste mistakes.
    s = collapseDuplicateProtocols(s);
    return s;
  };

  const optionalUrlSchema = z
    .preprocess(extractUrlLikeToken, z.string())
    .refine(
      (val) => val === undefined || val === null || val === '' || URL_PATTERN.test(val),
      'Invalid Ollama URL format (expected host[:port] with optional http/https)'
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
    .regex(
      /^[a-zA-Z0-9._:@/\\-]+$/,
      'Model name must be alphanumeric with hyphens, underscores, dots, @, colons, or slashes'
    )
    .max(100, 'Model name too long (max 100 chars)')
    .nullish();

  // ===== Settings Schemas =====

  /**
   * Settings object validation
   * Uses shared constants from validationConstants.js
   */
  const settingsSchema = z
    .object({
      // AI Models & Config
      ollamaHost: optionalUrlSchema,
      textModel: modelNameSchema,
      visionModel: modelNameSchema,
      embeddingModel: modelNameSchema,
      autoUpdateOllama: z.boolean().nullish(),
      autoUpdateChromaDb: z.boolean().nullish(),

      // Onboarding / Wizards
      dependencyWizardShown: z.boolean().nullish(),
      dependencyWizardLastPromptAt: z.string().nullable().optional(),
      dependencyWizardPromptIntervalDays: z.number().int().min(1).max(365).nullish(),

      // Application Behavior
      launchOnStartup: z.boolean().nullish(),
      autoOrganize: z.boolean().nullish(),
      backgroundMode: z.boolean().nullish(),
      autoUpdateCheck: z.boolean().nullish(),
      telemetryEnabled: z.boolean().nullish(),

      // UI Preferences
      theme: z.enum(THEME_VALUES).nullish(),
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

      // Smart Folder Watching
      smartFolderWatchEnabled: z.boolean().nullish(),

      // Notification settings
      notifications: z.boolean().nullish(),
      notificationMode: z.enum(['both', 'ui', 'tray', 'none']).nullish(),
      notifyOnAutoAnalysis: z.boolean().nullish(),
      notifyOnLowConfidence: z.boolean().nullish(),

      // Organization settings
      confidenceThreshold: z.number().min(0).max(1).nullish(),
      defaultSmartFolderLocation: z.string().nullish(),
      maxConcurrentAnalysis: z.number().int().min(1).max(10).nullish(),
      lastBrowsedPath: z.string().nullish(),

      // Naming convention settings
      namingConvention: z.string().nullish(),
      dateFormat: z.string().nullish(),
      caseConvention: z.string().nullish(),
      separator: z.string().nullish(),

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
      saveDebounceMs: z.number().int().min(100).nullish()
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
   * Uses relaxed URL validation that allows URLs with or without protocol
   * (e.g., "localhost:11434", "http://127.0.0.1:11434")
   */
  const ollamaHostSchema = optionalUrlSchema;

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
