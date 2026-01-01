const {
  withErrorLogging,
  withValidation,
  successResponse,
  errorResponse,
  canceledResponse,
  safeHandle
} = require('./ipcWrappers');
const { app, dialog } = require('electron');
const { getConfigurableLimits, sanitizeSettings } = require('../../shared/settingsValidation');
const fs = require('fs').promises;

// Import centralized security configuration
const { SETTINGS_VALIDATION, PROTOTYPE_POLLUTION_KEYS } = require('../../shared/securityConfig');
const {
  THEME_VALUES,
  LOGGING_LEVELS,
  NUMERIC_LIMITS,
  isValidTheme,
  isValidLoggingLevel,
  isValidNumericSetting
} = require('../../shared/validationConstants');

let z;
try {
  z = require('zod');
} catch {
  z = null;
}

/**
 * Apply settings to Ollama services and system configuration
 * Extracted to avoid code duplication across save/import/restore handlers
 * @param {object} merged - The merged settings object
 * @param {object} context - Context containing service setters and logger
 * @returns {Promise<void>}
 */
async function applySettingsToServices(
  merged,
  { setOllamaHost, setOllamaModel, setOllamaVisionModel, setOllamaEmbeddingModel, logger }
) {
  if (merged.ollamaHost) await setOllamaHost(merged.ollamaHost);
  if (merged.textModel) await setOllamaModel(merged.textModel);
  if (merged.visionModel) await setOllamaVisionModel(merged.visionModel);
  if (merged.embeddingModel && typeof setOllamaEmbeddingModel === 'function') {
    await setOllamaEmbeddingModel(merged.embeddingModel);
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

  // Regex patterns from centralized config
  const URL_REGEX = SETTINGS_VALIDATION.patterns.url;
  const MODEL_REGEX = SETTINGS_VALIDATION.patterns.modelName;

  // Check for prototype pollution attempts using centralized config
  // Use Object.hasOwn to check own properties only, not prototype chain
  for (const key of PROTOTYPE_POLLUTION_KEYS) {
    if (Object.hasOwn(settings, key)) {
      throw new Error(`Security: Prototype pollution attempt detected (${key})`);
    }
  }

  // Sanitize settings using whitelist approach
  const sanitized = {};
  let ignoredCount = 0;

  for (const [key, value] of Object.entries(settings)) {
    // Skip unknown keys
    if (!ALLOWED_SETTINGS_KEYS.has(key)) {
      logger.warn(`[SETTINGS-IMPORT] Ignoring unknown key: ${key}`);
      ignoredCount++;
      continue;
    }

    // Validate value based on key type
    switch (key) {
      case 'ollamaHost': {
        if (typeof value !== 'string' || !URL_REGEX.test(value)) {
          throw new Error(`Invalid ${key}: must be a valid URL`);
        }
        // Block bind-all addresses (0.0.0.0, [::]) which are not valid connection targets
        // Note: localhost/127.0.0.1 are allowed since Ollama legitimately runs there
        const lowerValue = value.toLowerCase();
        if (lowerValue.includes('0.0.0.0') || lowerValue.includes('[::]')) {
          logger.warn(`[SETTINGS-IMPORT] Blocking potentially unsafe URL: ${value}`);
          throw new Error(`Invalid ${key}: potentially unsafe URL pattern detected`);
        }
        // Block URL credential attacks (e.g., http://attacker@127.0.0.1)
        try {
          const parsed = new URL(value);
          if (parsed.username || parsed.password) {
            logger.warn(`[SETTINGS-IMPORT] Blocking URL with credentials: ${value}`);
            throw new Error(`Invalid ${key}: URLs with credentials are not allowed`);
          }
        } catch (urlError) {
          if (urlError.message.includes('credentials')) {
            throw urlError;
          }
          // URL parsing failed but regex passed - allow with warning
          logger.warn(`[SETTINGS-IMPORT] URL parsing failed but pattern valid: ${value}`);
        }
        break;
      }

      case 'textModel':
      case 'visionModel':
      case 'embeddingModel':
        if (typeof value !== 'string' || !MODEL_REGEX.test(value)) {
          throw new Error(
            `Invalid ${key}: must be alphanumeric with hyphens, underscores, dots, @, or colons`
          );
        }
        if (value.length > 100) {
          throw new Error(`Invalid ${key}: name too long (max 100 chars)`);
        }
        break;

      case 'launchOnStartup':
      case 'autoOrganize':
      case 'backgroundMode':
      case 'autoUpdateCheck':
      case 'telemetryEnabled':
        if (typeof value !== 'boolean') {
          throw new Error(`Invalid ${key}: must be boolean`);
        }
        break;

      case 'theme':
        if (!isValidTheme(value)) {
          throw new Error(`Invalid ${key}: must be one of ${THEME_VALUES.join(', ')}`);
        }
        break;

      case 'language':
        if (typeof value !== 'string' || value.length > 10) {
          throw new Error(`Invalid ${key}: must be a valid language code`);
        }
        break;

      case 'loggingLevel':
        if (!isValidLoggingLevel(value)) {
          throw new Error(`Invalid ${key}: must be one of ${LOGGING_LEVELS.join(', ')}`);
        }
        break;

      case 'cacheSize':
        if (!isValidNumericSetting('cacheSize', value)) {
          const { min, max } = NUMERIC_LIMITS.cacheSize;
          throw new Error(`Invalid ${key}: must be integer between ${min} and ${max}`);
        }
        break;

      case 'maxBatchSize':
        if (!isValidNumericSetting('maxBatchSize', value)) {
          const { min, max } = NUMERIC_LIMITS.maxBatchSize;
          throw new Error(`Invalid ${key}: must be integer between ${min} and ${max}`);
        }
        break;

      default:
        // For any other settings, ensure they're primitive types
        if (typeof value === 'object' && value !== null) {
          throw new Error(`Invalid ${key}: nested objects not allowed`);
        }
    }

    sanitized[key] = value;
  }

  if (ignoredCount > 0) {
    logger.info(`[SETTINGS-IMPORT] Ignored ${ignoredCount} unknown setting(s)`);
  }

  return sanitized;
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
    setOllamaHost,
    setOllamaModel,
    setOllamaVisionModel,
    setOllamaEmbeddingModel,
    onSettingsChanged,
    logger
  } = deps;

  try {
    const normalizedInput =
      settings && typeof settings === 'object' ? sanitizeSettings(settings) : {};
    const saveResult = await settingsService.save(normalizedInput);
    const merged = saveResult.settings || saveResult; // Backward compatibility
    const validationWarnings = saveResult.validationWarnings || [];

    await applySettingsToServices(merged, {
      setOllamaHost,
      setOllamaModel,
      setOllamaVisionModel,
      setOllamaEmbeddingModel,
      logger
    });
    logger.info('[SETTINGS] Saved settings');

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

function registerSettingsIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  settingsService,
  setOllamaHost,
  setOllamaModel,
  setOllamaVisionModel,
  setOllamaEmbeddingModel,
  onSettingsChanged
}) {
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.GET,
    withErrorLogging(logger, async () => {
      try {
        const loaded = await settingsService.load();
        return loaded;
      } catch (error) {
        logger.error('Failed to get settings:', error);
        return {};
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

  const settingsSchema = z
    ? z
        .object({
          // IMPORTANT:
          // Don't hard-fail saves on a single invalid field (e.g. ollamaHost while typing/pasting).
          // We sanitize/normalize on the main-process side before persisting so other settings still save.
          // Validation for "test connection" remains strict elsewhere.
          ollamaHost: z.any().optional().nullable(),
          textModel: z.string().nullish(),
          visionModel: z.string().nullish(),
          embeddingModel: z.string().nullish(),
          autoUpdateOllama: z.boolean().nullish(),
          autoUpdateChromaDb: z.boolean().nullish(),
          dependencyWizardShown: z.boolean().nullish(),
          dependencyWizardLastPromptAt: z.string().nullable().optional(),
          dependencyWizardPromptIntervalDays: z.number().int().min(1).max(365).nullish(),
          launchOnStartup: z.boolean().nullish(),
          autoOrganize: z.boolean().nullish(),
          backgroundMode: z.boolean().nullish(),
          theme: z.string().nullish(),
          language: z.string().nullish(),
          loggingLevel: z.string().nullish(),
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
          autoUpdateCheck: z.boolean().nullish(),
          telemetryEnabled: z.boolean().nullish()
        })
        .partial()
    : null;
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
        const settings = await settingsService.load();

        // Create export data with metadata
        const exportData = {
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          appVersion: app.getVersion(),
          settings
        };

        // If no path provided, show save dialog
        let filePath = exportPath;
        if (!filePath) {
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

          filePath = result.filePath;
        }

        // Write export file
        // FIX: Use atomic write (temp + rename) to prevent corruption on crash
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        try {
          await fs.writeFile(tempPath, JSON.stringify(exportData, null, 2), 'utf8');
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

          filePath = result.filePaths[0];
        }

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
        const sanitizedSettings = validateImportedSettings(importData.settings, logger);

        // Save sanitized settings
        const saveResult = await settingsService.save(sanitizedSettings);
        const merged = saveResult.settings || saveResult;
        const validationWarnings = saveResult.validationWarnings || [];

        // Apply settings using shared helper
        await applySettingsToServices(merged, {
          setOllamaHost,
          setOllamaModel,
          setOllamaVisionModel,
          setOllamaEmbeddingModel,
          logger
        });

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

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.RESTORE_BACKUP,
    withErrorLogging(logger, async (event, backupPath) => {
      void event;
      try {
        const result = await settingsService.restoreFromBackup(backupPath);

        if (result.success) {
          // Apply restored settings using shared helper
          const merged = result.settings;

          await applySettingsToServices(merged, {
            setOllamaHost,
            setOllamaModel,
            setOllamaVisionModel,
            setOllamaEmbeddingModel,
            logger
          });

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

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SETTINGS.DELETE_BACKUP,
    withErrorLogging(logger, async (event, backupPath) => {
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
  );
}

module.exports = registerSettingsIpc;
