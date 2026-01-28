const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');
const { app, dialog, shell } = require('electron');
const {
  withErrorLogging,
  withValidation,
  successResponse,
  errorResponse,
  canceledResponse,
  safeHandle
} = require('./ipcWrappers');
const {
  getConfigurableLimits,
  sanitizeSettings,
  validateSettings,
  VALIDATION_RULES
} = require('../../shared/settingsValidation');
const fs = require('fs').promises;
const path = require('path');
const { settingsSchema, backupPathSchema, z } = require('./validationSchemas');
// Import centralized security configuration
const { SETTINGS_VALIDATION, PROTOTYPE_POLLUTION_KEYS } = require('../../shared/securityConfig');
const { validateFileOperationPathSync } = require('../../shared/pathSanitization');
const {
  normalizeSlashes,
  normalizeProtocolCase,
  extractBaseUrl,
  hasProtocol,
  ensureProtocol
} = require('../../shared/urlUtils');
const {
  LENIENT_URL_PATTERN,
  LOGGING_LEVELS,
  NUMERIC_LIMITS,
  MODEL_NAME_PATTERN,
  MAX_MODEL_NAME_LENGTH,
  NOTIFICATION_MODES,
  NAMING_CONVENTIONS,
  CASE_CONVENTIONS,
  SMART_FOLDER_ROUTING_MODES,
  SEPARATOR_PATTERN
} = require('../../shared/validationConstants');

/**
 * SECURITY FIX (CRIT-15): Sanitize URL for safe logging
 * Removes credentials (username/password) from URL before logging to prevent credential leakage
 * @param {string} url - The URL to sanitize
 * @returns {string} URL with credentials redacted
 */
function sanitizeUrlForLogging(url) {
  if (!url || typeof url !== 'string') return '[invalid-url]';
  try {
    const parsed = new URL(url);
    // Redact credentials if present
    if (parsed.username || parsed.password) {
      parsed.username = parsed.username ? '[REDACTED]' : '';
      parsed.password = parsed.password ? '[REDACTED]' : '';
    }
    return parsed.toString();
  } catch {
    // If URL parsing fails, redact the middle portion to be safe
    // This handles malformed URLs that might still contain credentials
    if (url.includes('@')) {
      return url.replace(/\/\/[^@]+@/, '//[REDACTED]@');
    }
    return url.substring(0, 20) + (url.length > 20 ? '...[truncated]' : '');
  }
}

function normalizeOllamaHostForValidation(value) {
  if (!value || typeof value !== 'string') return value;
  let trimmed = value.trim();
  if (!trimmed) return trimmed;

  trimmed = normalizeSlashes(trimmed);
  if (hasProtocol(trimmed)) {
    trimmed = normalizeProtocolCase(trimmed);
  }

  trimmed = extractBaseUrl(trimmed);

  if (!hasProtocol(trimmed)) {
    trimmed = ensureProtocol(trimmed);
  }

  return trimmed;
}

/**
 * Apply settings to Ollama services and system configuration
 * Extracted to avoid code duplication across save/import/restore handlers
 * @param {object} merged - The merged settings object
 * @param {object} context - Context containing service setters and logger
 * @returns {Promise<void>}
 */
async function applySettingsToServices(merged, { logger }) {
  // FIX: Use OllamaService.updateConfig() to ensure model change events fire properly
  // This is critical for embedding model changes - FolderMatchingService needs to be notified
  // to clear its cache and reset ChromaDB when the embedding model changes
  const OllamaService = require('../services/OllamaService');
  const ollamaService = OllamaService.getInstance();

  // Build config object with all model settings
  const ollamaConfig = {};
  if (merged.ollamaHost) ollamaConfig.host = merged.ollamaHost;
  if (merged.textModel) ollamaConfig.textModel = merged.textModel;
  if (merged.visionModel) ollamaConfig.visionModel = merged.visionModel;
  if (merged.embeddingModel) ollamaConfig.embeddingModel = merged.embeddingModel;

  // Apply all Ollama config changes through OllamaService to trigger proper notifications
  // skipSave: true because we're already in a save operation (settings are saved by the caller)
  if (Object.keys(ollamaConfig).length > 0) {
    const result = await ollamaService.updateConfig(ollamaConfig, { skipSave: true });
    if (result.modelDowngraded) {
      logger.warn('[SETTINGS] Embedding model was downgraded to default due to invalid selection');
    }
    if (!result.success) {
      logger.error('[SETTINGS] Failed to apply Ollama config:', result.error);
    }
  }

  if (typeof merged.launchOnStartup === 'boolean') {
    try {
      app.setLoginItemSettings({
        openAtLogin: merged.launchOnStartup
      });
    } catch (error) {
      logger.warn('[SETTINGS] Failed to set login item settings:', error.message);
    }
  }
}

/**
 * HIGH PRIORITY FIX (HIGH-14): Security validation for imported settings
 * Prevents prototype pollution, command injection, and data exfiltration
 * @param {object} settings - Imported settings object to validate
 * @param {object} logger - Logger instance
 * @returns {object} - Sanitized settings object
 * @throws {Error} - If validation fails
 */
function validateImportedSettings(settings, logger) {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid settings: must be an object');
  }

  // Use centralized settings validation config
  const ALLOWED_SETTINGS_KEYS = SETTINGS_VALIDATION.allowedKeys;

  // Check for prototype pollution attempts using centralized config
  // Use Object.hasOwn to check own properties only, not prototype chain
  for (const key of PROTOTYPE_POLLUTION_KEYS) {
    if (Object.hasOwn(settings, key)) {
      throw new Error(`Security: Prototype pollution attempt detected (${key})`);
    }
  }

  // Sanitize settings using whitelist approach
  const filtered = {};
  let ignoredCount = 0;

  for (const [key, value] of Object.entries(settings)) {
    // Skip unknown keys
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      logger.warn(`[SETTINGS-IMPORT] Ignoring unknown key: ${key}`);
      ignoredCount++;
      continue;
    }
    filtered[key] = value;
  }

  if (ignoredCount > 0) {
    logger.info(`[SETTINGS-IMPORT] Ignored ${ignoredCount} unknown setting(s)`);
  }

  const normalized = { ...filtered };
  if (typeof normalized.ollamaHost === 'string') {
    const rawHost = normalized.ollamaHost.trim();
    if (rawHost) {
      const candidate = ensureProtocol(normalizeProtocolCase(normalizeSlashes(rawHost)));
      if (!LENIENT_URL_PATTERN.test(rawHost)) {
        throw new Error('Invalid ollamaHost: URL format is invalid');
      }
      try {
        const parsed = new URL(candidate);
        if (parsed.username || parsed.password) {
          throw new Error('Invalid ollamaHost: URLs with credentials are not allowed');
        }
      } catch (urlError) {
        throw new Error(`Invalid ollamaHost: ${urlError.message || 'URL is malformed'}`);
      }
    }
    normalized.ollamaHost = normalizeOllamaHostForValidation(normalized.ollamaHost);
  }

  // Validate without dropping invalid values so imports fail fast.
  const validation = validateSettings(normalized);

  if (!validation.valid) {
    const error = new Error(`Invalid settings: ${validation.errors.join('; ')}`);
    error.validationErrors = validation.errors;
    error.validationWarnings = validation.warnings;
    throw error;
  }

  // Enforce schema validation for imported settings before sanitization.
  let validated = normalized;
  if (z && settingsSchema) {
    const parsed = settingsSchema.safeParse(normalized);
    if (!parsed.success) {
      const first = parsed.error?.issues?.[0];
      throw new Error(
        `Invalid settings file: ${first?.path?.join('.') || 'settings'} ${first?.message || 'failed validation'}`
      );
    }
    validated = parsed.data;
  }

  const enumChecks = {
    notificationMode: NOTIFICATION_MODES,
    namingConvention: NAMING_CONVENTIONS,
    caseConvention: CASE_CONVENTIONS,
    smartFolderRoutingMode: SMART_FOLDER_ROUTING_MODES
  };

  Object.entries(enumChecks).forEach(([key, allowed]) => {
    const value = validated?.[key];
    if (value === undefined || value === null) return;
    if (!Array.isArray(allowed) || allowed.length === 0) return;
    if (!allowed.includes(value)) {
      throw new Error(`Invalid settings: ${key} must be one of [${allowed.join(', ')}]`);
    }
  });

  const booleanKeys = [
    'launchOnStartup',
    'autoOrganize',
    'autoChunkOnAnalysis',
    'backgroundMode',
    'autoUpdateOllama',
    'autoUpdateChromaDb',
    'dependencyWizardShown',
    'notifications',
    'notifyOnAutoAnalysis',
    'notifyOnLowConfidence',
    'autoUpdateCheck',
    'telemetryEnabled'
  ];
  booleanKeys.forEach((key) => {
    const value = validated?.[key];
    if (value === undefined || value === null) return;
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid settings: ${key} must be a boolean`);
    }
  });

  if (validated?.language !== undefined && validated?.language !== null) {
    if (typeof validated.language !== 'string' || validated.language.length > 20) {
      throw new Error('Invalid settings: language must be a string up to 20 characters');
    }
  }

  if (validated?.loggingLevel !== undefined && validated?.loggingLevel !== null) {
    if (!LOGGING_LEVELS.includes(validated.loggingLevel)) {
      throw new Error(
        `Invalid settings: loggingLevel must be one of [${LOGGING_LEVELS.join(', ')}]`
      );
    }
  }

  const modelKeys = ['textModel', 'visionModel', 'embeddingModel'];
  modelKeys.forEach((key) => {
    const value = validated?.[key];
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') {
      throw new Error(`Invalid settings: ${key} must be a string`);
    }
    if (value.length > MAX_MODEL_NAME_LENGTH || !MODEL_NAME_PATTERN.test(value)) {
      throw new Error(`Invalid settings: ${key} contains invalid characters`);
    }
  });

  if (validated?.cacheSize !== undefined && validated?.cacheSize !== null) {
    const value = validated.cacheSize;
    const limits = NUMERIC_LIMITS.cacheSize;
    if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
      throw new Error(
        `Invalid settings: cacheSize must be an integer between ${limits.min} and ${limits.max}`
      );
    }
  }

  if (validated?.maxBatchSize !== undefined && validated?.maxBatchSize !== null) {
    const value = validated.maxBatchSize;
    const limits = NUMERIC_LIMITS.maxBatchSize;
    if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
      throw new Error(
        `Invalid settings: maxBatchSize must be an integer between ${limits.min} and ${limits.max}`
      );
    }
  }

  if (validated?.separator !== undefined && validated?.separator !== null) {
    if (typeof validated.separator !== 'string' || !SEPARATOR_PATTERN.test(validated.separator)) {
      throw new Error('Invalid settings: separator contains invalid characters');
    }
  }

  if (validated?.confidenceThreshold !== undefined && validated?.confidenceThreshold !== null) {
    const value = validated.confidenceThreshold;
    if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
      throw new Error('Invalid settings: confidenceThreshold must be between 0 and 1');
    }
  }

  if (validated?.maxConcurrentAnalysis !== undefined && validated?.maxConcurrentAnalysis !== null) {
    const value = validated.maxConcurrentAnalysis;
    if (!Number.isInteger(value) || value < 1 || value > 10) {
      throw new Error(
        'Invalid settings: maxConcurrentAnalysis must be an integer between 1 and 10'
      );
    }
  }

  const pathKeys = ['defaultSmartFolderLocation', 'lastBrowsedPath'];
  const pathLengthLimits = {
    defaultSmartFolderLocation: VALIDATION_RULES?.defaultSmartFolderLocation?.maxLength ?? 500,
    lastBrowsedPath: VALIDATION_RULES?.lastBrowsedPath?.maxLength ?? 1000
  };
  pathKeys.forEach((key) => {
    const value = validated?.[key];
    if (typeof value !== 'string' || value.trim().length === 0) return;
    const trimmed = value.trim();
    const maxLength = pathLengthLimits[key];
    if (Number.isInteger(maxLength) && trimmed.length > maxLength) {
      throw new Error(`Invalid settings: ${key} must be at most ${maxLength} characters`);
    }

    // Allow simple folder names for defaultSmartFolderLocation (validated earlier).
    if (key === 'defaultSmartFolderLocation' && !path.isAbsolute(trimmed)) {
      return;
    }

    const pathValidation = validateFileOperationPathSync(trimmed, null, {
      disallowUNC: false,
      ...(key === 'lastBrowsedPath' ? { requireAbsolute: true } : {})
    });
    if (!pathValidation.valid) {
      throw new Error(`Invalid settings: ${key} ${pathValidation.error}`);
    }
  });

  if (validation.warnings.length > 0) {
    logger.warn('[SETTINGS-IMPORT] Validation warnings', {
      warnings: validation.warnings
    });
  }

  // Additional safety checks for Ollama host on imports
  if (typeof validated.ollamaHost === 'string') {
    const trimmed = normalizeOllamaHostForValidation(validated.ollamaHost);
    if (trimmed) {
      const lowerValue = trimmed.toLowerCase();
      if (lowerValue.includes('0.0.0.0') || lowerValue.includes('[::]')) {
        logger.warn(
          `[SETTINGS-IMPORT] Blocking potentially unsafe URL: ${sanitizeUrlForLogging(trimmed)}`
        );
        throw new Error('Invalid ollamaHost: potentially unsafe URL pattern detected');
      }
      try {
        const parsed = new URL(trimmed);
        if (parsed.username || parsed.password) {
          logger.warn(
            `[SETTINGS-IMPORT] Blocking URL with credentials: ${sanitizeUrlForLogging(trimmed)}`
          );
          throw new Error('Invalid ollamaHost: URLs with credentials are not allowed');
        }
      } catch (urlError) {
        logger.warn(
          `[SETTINGS-IMPORT] Rejecting malformed URL: ${sanitizeUrlForLogging(trimmed)}`,
          {
            error: urlError.message
          }
        );
        throw new Error('Invalid ollamaHost: URL is malformed and cannot be parsed');
      }
    }
  }

  return sanitizeSettings(validated);
}

/**
 * Internal helper to handle settings save logic
 * Extracted to avoid duplication between Zod and non-Zod code paths
 * @param {Object} settings - Settings to save
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} IPC response
 */
async function handleSettingsSaveCore(settings, deps) {
  const {
    settingsService,
    setOllamaHost: _setOllamaHost,
    setOllamaModel: _setOllamaModel,
    setOllamaVisionModel: _setOllamaVisionModel,
    setOllamaEmbeddingModel: _setOllamaEmbeddingModel,
    onSettingsChanged,
    logger
  } = deps;

  try {
    const normalizedInput =
      settings && typeof settings === 'object' ? sanitizeSettings(settings) : {};
    const saveResult = await settingsService.save(normalizedInput);
    const merged = saveResult.settings || saveResult; // Backward compatibility
    const validationWarnings = saveResult.validationWarnings || [];

    await applySettingsToServices(merged, { logger });
    logger.info('[SETTINGS] Saved settings');

    // Invalidate notification service cache to ensure new settings take effect immediately
    // This prevents the 5-second TTL cache from causing stale notification behavior
    try {
      const NotificationService = require('../services/NotificationService');
      const notificationService = NotificationService.getInstance?.();
      if (notificationService?.invalidateCache) {
        notificationService.invalidateCache();
        logger.debug('[SETTINGS] Notification service cache invalidated');
      }
    } catch (notifyErr) {
      // Non-fatal - notification service may not be initialized yet
      logger.debug('[SETTINGS] Could not invalidate notification cache:', notifyErr.message);
    }

    // Enhanced settings propagation with error logging
    let propagationSuccess = true;
    try {
      if (typeof onSettingsChanged === 'function') {
        await onSettingsChanged(merged);
        logger.info('[SETTINGS] Settings change notification sent successfully');
      } else if (onSettingsChanged !== undefined && onSettingsChanged !== null) {
        logger.warn('[SETTINGS] onSettingsChanged is not a function:', typeof onSettingsChanged);
      }
    } catch (error) {
      propagationSuccess = false;
      logger.error('[SETTINGS] Settings change notification failed:', error);
    }

    return {
      success: true,
      settings: merged,
      propagationSuccess,
      validationWarnings
    };
  } catch (error) {
    logger.error('Failed to save settings:', error);

    const response = {
      success: false,
      error: error.message
    };

    if (error.validationErrors) {
      response.validationErrors = error.validationErrors;
    }
    if (error.validationWarnings) {
      response.validationWarnings = error.validationWarnings;
    }

    return response;
  }
}

function registerSettingsIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { settingsService, onSettingsChanged } = container.settings;
  const { setOllamaHost, setOllamaModel, setOllamaVisionModel, setOllamaEmbeddingModel } =
    container.ollama;

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.GET,
    withErrorLogging(logger, async () => {
      try {
        const loaded = await settingsService.load();
        return loaded;
      } catch (error) {
        logger.error('Failed to get settings:', error);
        // FIX HIGH-24: Return proper error structure instead of swallowing error
        return { success: false, error: error.message, settings: {} };
      }
    })
  );

  // Fixed: Add endpoint to get configurable limits
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.GET_CONFIGURABLE_LIMITS,
    withErrorLogging(logger, async () => {
      try {
        const settings = await settingsService.load();
        return getConfigurableLimits(settings);
      } catch (error) {
        logger.error('Failed to get configurable limits:', error);
        return getConfigurableLimits({});
      }
    })
  );

  // Dependencies for save handler (captured in closure)
  const saveDeps = {
    settingsService,
    setOllamaHost,
    setOllamaModel,
    setOllamaVisionModel,
    setOllamaEmbeddingModel,
    onSettingsChanged,
    logger
  };

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.SAVE,
    z && settingsSchema
      ? withValidation(logger, settingsSchema, async (event, settings) => {
          void event;
          return handleSettingsSaveCore(settings, saveDeps);
        })
      : withErrorLogging(logger, async (event, settings) => {
          void event;
          return handleSettingsSaveCore(settings, saveDeps);
        })
  );

  // Fixed: Add config export handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.EXPORT,
    withErrorLogging(logger, async (event, exportPath) => {
      void event;
      try {
        // SECURITY: Ignore exportPath from renderer - always use dialog
        // This prevents path traversal attacks from compromised renderer
        if (exportPath) {
          logger.warn(
            '[SETTINGS] Export path provided via IPC is ignored for security. Using dialog instead.'
          );
        }

        const settings = await settingsService.load();

        // Create export data with metadata
        const exportData = {
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          appVersion: app.getVersion(),
          settings
        };

        // Always show save dialog for security
        const result = await dialog.showSaveDialog({
          title: 'Export Settings',
          defaultPath: `stratosort-config-${new Date().toISOString().split('T')[0]}.json`,
          filters: [
            { name: 'JSON Files', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });

        if (result.canceled) {
          return canceledResponse();
        }

        const filePath = result.filePath;

        // Serialize export data with proper error handling
        let jsonContent;
        try {
          // FIX: Yield to event loop before heavy serialization to prevent UI blocking
          await new Promise((resolve) => setImmediate(resolve));
          jsonContent = JSON.stringify(exportData, null, 2);
        } catch (serializeError) {
          logger.error('[SETTINGS] Failed to serialize export data:', serializeError);
          throw new Error('Failed to serialize settings data for export');
        }

        // Write export file
        // FIX: Use atomic write (temp + rename) to prevent corruption on crash
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        try {
          await fs.writeFile(tempPath, jsonContent, 'utf8');
          await fs.rename(tempPath, filePath);
        } catch (writeError) {
          // Clean up temp file on failure
          try {
            await fs.unlink(tempPath);
          } catch {
            // Ignore cleanup errors
          }
          throw writeError;
        }

        logger.info('[SETTINGS] Exported settings to:', filePath);

        return successResponse({ path: filePath });
      } catch (error) {
        logger.error('[SETTINGS] Failed to export settings:', error);
        return errorResponse(error.message);
      }
    })
  );

  // Fixed: Add config import handler
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.IMPORT,
    withErrorLogging(logger, async (event, importPath) => {
      void event;
      try {
        // If no path provided, show open dialog
        let filePath = importPath;
        if (!filePath) {
          const result = await dialog.showOpenDialog({
            title: 'Import Settings',
            filters: [
              { name: 'JSON Files', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] }
            ],
            properties: ['openFile']
          });

          if (result.canceled) {
            return canceledResponse();
          }

          // FIX MED-9: Add bounds check before accessing filePaths[0]
          if (!result.filePaths || result.filePaths.length === 0) {
            return canceledResponse();
          }
          filePath = result.filePaths[0];
        }

        // Removed insecure direct path handling block

        // SECURITY FIX: Check file size before reading to prevent DoS
        const MAX_IMPORT_SIZE = 1 * 1024 * 1024; // 1MB limit for settings files
        const stats = await fs.stat(filePath);
        if (stats.size > MAX_IMPORT_SIZE) {
          throw new Error(
            `Import file too large (${Math.round(stats.size / 1024)}KB). Maximum size is 1MB.`
          );
        }

        // Read and parse import file
        const fileContent = await fs.readFile(filePath, 'utf8');

        // Fixed: Add specific error handling for JSON parsing
        let importData;
        try {
          importData = JSON.parse(fileContent);
        } catch (parseError) {
          throw new Error(`Invalid JSON in settings file: ${parseError.message}`);
        }

        // Validate import data structure
        if (!importData.settings || typeof importData.settings !== 'object') {
          throw new Error('Invalid settings file: missing or invalid settings object');
        }

        // HIGH PRIORITY FIX (HIGH-14): Sanitize and validate imported settings
        // Prevents prototype pollution, command injection, and data exfiltration
        let sanitizedSettings = validateImportedSettings(importData.settings, logger);

        // Save sanitized settings
        const saveResult = await settingsService.save(sanitizedSettings);
        const merged = saveResult.settings || saveResult;
        const validationWarnings = saveResult.validationWarnings || [];

        // Apply settings using shared helper
        await applySettingsToServices(merged, { logger });

        // Notify settings changed
        if (typeof onSettingsChanged === 'function') {
          await onSettingsChanged(merged);
        }

        logger.info('[SETTINGS] Imported settings from:', filePath);

        return successResponse(
          {
            settings: merged,
            importInfo: {
              version: importData.version,
              exportDate: importData.exportDate,
              appVersion: importData.appVersion
            }
          },
          validationWarnings
        );
      } catch (error) {
        logger.error('[SETTINGS] Failed to import settings:', error);
        return errorResponse(error.message);
      }
    })
  );

  // Fixed: Add backup management handlers
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.CREATE_BACKUP,
    withErrorLogging(logger, async () => {
      try {
        const result = await settingsService.createBackup();
        if (result.success) {
          logger.info('[SETTINGS] Backup created:', result.path);
          return successResponse({ path: result.path, timestamp: result.timestamp });
        }
        return errorResponse(result.error || 'Unknown backup error');
      } catch (error) {
        logger.error('[SETTINGS] Failed to create backup:', error);
        return errorResponse(error.message);
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.LIST_BACKUPS,
    withErrorLogging(logger, async () => {
      try {
        const backups = await settingsService.listBackups();
        return successResponse({ backups });
      } catch (error) {
        logger.error('[SETTINGS] Failed to list backups:', error);
        return errorResponse(error.message, { backups: [] });
      }
    })
  );

  // FIX: Apply consistent Zod validation to backup endpoints
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.RESTORE_BACKUP,
    z && backupPathSchema
      ? withValidation(logger, backupPathSchema, async (event, backupPath) => {
          void event;
          try {
            const result = await settingsService.restoreFromBackup(backupPath);

            if (result.success) {
              // Apply restored settings using shared helper
              const merged = result.settings;

              await applySettingsToServices(merged, { logger });

              // Notify settings changed
              if (typeof onSettingsChanged === 'function') {
                await onSettingsChanged(merged);
              }

              logger.info('[SETTINGS] Restored from backup:', backupPath);
              return successResponse(
                { settings: merged, restoredFrom: result.restoredFrom },
                result.validationWarnings
              );
            }

            return errorResponse(result.error || 'Unknown restore error', {
              validationErrors: result.validationErrors
            });
          } catch (error) {
            logger.error('[SETTINGS] Failed to restore backup:', error);
            return errorResponse(error.message);
          }
        })
      : withErrorLogging(logger, async (event, backupPath) => {
          void event;
          try {
            // Fallback manual validation when Zod not available
            if (!backupPath || typeof backupPath !== 'string') {
              return errorResponse('Invalid backup path: must be a non-empty string');
            }

            const result = await settingsService.restoreFromBackup(backupPath);

            if (result.success) {
              // Apply restored settings using shared helper
              const merged = result.settings;

              await applySettingsToServices(merged, { logger });

              // Notify settings changed
              if (typeof onSettingsChanged === 'function') {
                await onSettingsChanged(merged);
              }

              logger.info('[SETTINGS] Restored from backup:', backupPath);
              return successResponse(
                { settings: merged, restoredFrom: result.restoredFrom },
                result.validationWarnings
              );
            }

            return errorResponse(result.error || 'Unknown restore error', {
              validationErrors: result.validationErrors
            });
          } catch (error) {
            logger.error('[SETTINGS] Failed to restore backup:', error);
            return errorResponse(error.message);
          }
        })
  );

  // FIX: Apply consistent Zod validation to backup endpoints
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.DELETE_BACKUP,
    z && backupPathSchema
      ? withValidation(logger, backupPathSchema, async (event, backupPath) => {
          void event;
          try {
            const result = await settingsService.deleteBackup(backupPath);
            if (result.success) {
              logger.info('[SETTINGS] Deleted backup:', backupPath);
              return successResponse();
            }
            return errorResponse(result.error || 'Unknown delete error');
          } catch (error) {
            logger.error('[SETTINGS] Failed to delete backup:', error);
            return errorResponse(error.message);
          }
        })
      : withErrorLogging(logger, async (event, backupPath) => {
          void event;
          try {
            // Fallback manual validation when Zod not available
            if (!backupPath || typeof backupPath !== 'string') {
              return errorResponse('Invalid backup path: must be a non-empty string');
            }

            const result = await settingsService.deleteBackup(backupPath);
            if (result.success) {
              logger.info('[SETTINGS] Deleted backup:', backupPath);
              return successResponse();
            }
            return errorResponse(result.error || 'Unknown delete error');
          } catch (error) {
            logger.error('[SETTINGS] Failed to delete backup:', error);
            return errorResponse(error.message);
          }
        })
  );

  // ---- Troubleshooting helpers ----
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.GET_LOGS_INFO,
    withErrorLogging(logger, async () => {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      return successResponse({
        logsDir,
        appVersion: app.getVersion(),
        platform: process.platform,
        arch: process.arch
      });
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.OPEN_LOGS_FOLDER,
    withErrorLogging(logger, async () => {
      const logsDir = path.join(app.getPath('userData'), 'logs');
      try {
        await fs.mkdir(logsDir, { recursive: true });
      } catch (mkdirErr) {
        logger.warn('[SETTINGS] Failed to ensure logs directory exists:', mkdirErr?.message);
      }

      const result = await shell.openPath(logsDir);
      if (typeof result === 'string' && result.length > 0) {
        logger.warn('[SETTINGS] Failed to open logs folder:', { logsDir, error: result });
        return errorResponse(`Failed to open logs folder: ${result}`);
      }

      logger.info('[SETTINGS] Opened logs folder:', logsDir);
      return successResponse({ logsDir });
    })
  );
}

module.exports = registerSettingsIpc;
