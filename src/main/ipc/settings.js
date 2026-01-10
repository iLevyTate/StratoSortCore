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
const { getConfigurableLimits, sanitizeSettings } = require('../../shared/settingsValidation');
const fs = require('fs').promises;
const path = require('path');
const { settingsSchema, z } = require('./validationSchemas');

// Import centralized security configuration
const { SETTINGS_VALIDATION, PROTOTYPE_POLLUTION_KEYS } = require('../../shared/securityConfig');
const {
  LOGGING_LEVELS,
  NUMERIC_LIMITS,
  isValidLoggingLevel,
  isValidNumericSetting
} = require('../../shared/validationConstants');

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
  // FIX: Pass false to skip saving to settings file, as we are already in a save operation
  if (merged.ollamaHost) await setOllamaHost(merged.ollamaHost, false);
  if (merged.textModel) await setOllamaModel(merged.textModel, false);
  if (merged.visionModel) await setOllamaVisionModel(merged.visionModel, false);
  if (merged.embeddingModel && typeof setOllamaEmbeddingModel === 'function') {
    await setOllamaEmbeddingModel(merged.embeddingModel, false);
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

  const isSafeAbsolutePathString = (p) => {
    if (typeof p !== 'string') return false;
    const trimmed = p.trim();
    if (!trimmed) return false;
    // Disallow control characters / null bytes.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F]/.test(trimmed)) return false;
    // Disallow URL-style inputs (e.g. file://, http://).
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return false;
    // Disallow Windows device/extended-length prefixes which can bypass normal path handling.
    if (trimmed.startsWith('\\\\?\\') || trimmed.startsWith('\\\\.\\')) return false;
    const normalized = path.normalize(trimmed);
    return path.isAbsolute(normalized);
  };

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
          // FIX: Reject URLs that fail parsing - don't allow potentially malformed URLs
          // even if they pass the regex, as they could cause issues downstream
          logger.warn(`[SETTINGS-IMPORT] Rejecting malformed URL: ${value}`, {
            error: urlError.message
          });
          throw new Error(`Invalid ${key}: URL is malformed and cannot be parsed`);
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
      case 'notifications':
      case 'notifyOnAutoAnalysis':
      case 'notifyOnLowConfidence':
      case 'autoUpdateOllama':
      case 'autoUpdateChromaDb':
      case 'dependencyWizardShown':
      case 'autoChunkOnAnalysis':
        if (typeof value !== 'boolean') {
          throw new Error(`Invalid ${key}: must be boolean`);
        }
        break;

      case 'notificationMode':
        if (typeof value !== 'string' || !['both', 'ui', 'tray', 'none'].includes(value)) {
          throw new Error(`Invalid ${key}: must be one of both, ui, tray, none`);
        }
        break;

      case 'namingConvention':
        if (
          typeof value !== 'string' ||
          ![
            'subject-date',
            'date-subject',
            'project-subject-date',
            'category-subject',
            'keep-original'
          ].includes(value)
        ) {
          throw new Error(`Invalid ${key}: must be a valid naming convention`);
        }
        break;

      case 'caseConvention':
        if (
          typeof value !== 'string' ||
          ![
            'kebab-case',
            'snake_case',
            'camelCase',
            'PascalCase',
            'lowercase',
            'UPPERCASE'
          ].includes(value)
        ) {
          throw new Error(`Invalid ${key}: must be a valid case convention`);
        }
        break;

      case 'dateFormat':
        if (typeof value !== 'string' || value.length > 20) {
          throw new Error(`Invalid ${key}: must be a string with max 20 characters`);
        }
        break;

      case 'separator':
        if (typeof value !== 'string' || value.length > 5 || /[/\\:*?"<>|]/.test(value)) {
          throw new Error(
            `Invalid ${key}: must be a safe separator character (max 5 chars, no path chars)`
          );
        }
        break;

      case 'confidenceThreshold':
        if (typeof value !== 'number' || value < 0 || value > 1) {
          throw new Error(`Invalid ${key}: must be a number between 0 and 1`);
        }
        break;

      case 'maxConcurrentAnalysis':
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
          throw new Error(`Invalid ${key}: must be an integer between 1 and 10`);
        }
        break;

      case 'defaultSmartFolderLocation':
      case 'lastBrowsedPath':
        if (value !== null) {
          if (typeof value !== 'string' || value.length > 1000) {
            throw new Error(`Invalid ${key}: must be a string path (max 1000 chars) or null`);
          }
          if (!isSafeAbsolutePathString(value)) {
            throw new Error(`Invalid ${key}: must be an absolute, safe local filesystem path`);
          }
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

        // Serialize export data with proper error handling
        let jsonContent;
        try {
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
        let sanitizedSettings = validateImportedSettings(importData.settings, logger);

        // If Zod schemas are available, enforce schema validation for imported settings too.
        if (z && settingsSchema) {
          const parsed = settingsSchema.safeParse(sanitizedSettings);
          if (!parsed.success) {
            const first = parsed.error?.issues?.[0];
            throw new Error(
              `Invalid settings file: ${first?.path?.join('.') || 'settings'} ${first?.message || 'failed validation'}`
            );
          }
          sanitizedSettings = parsed.data;
        }

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
