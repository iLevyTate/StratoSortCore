const { withErrorLogging, withValidation } = require('./withErrorLogging');
const { app, dialog } = require('electron');
const { getConfigurableLimits } = require('../../shared/settingsValidation');
const fs = require('fs').promises;

// Import centralized security configuration
const {
  SETTINGS_VALIDATION,
  PROTOTYPE_POLLUTION_KEYS,
} = require('../../shared/securityConfig');

let z;
try {
  z = require('zod');
} catch {
  z = null;
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
  for (const key of PROTOTYPE_POLLUTION_KEYS) {
    if (key in settings) {
      throw new Error(
        `Security: Prototype pollution attempt detected (${key})`,
      );
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
      case 'ollamaHost':
        if (typeof value !== 'string' || !URL_REGEX.test(value)) {
          throw new Error(`Invalid ${key}: must be a valid URL`);
        }
        // Block potentially dangerous localhost redirects
        if (
          value.includes('0.0.0.0') ||
          value.includes('[::]') ||
          value.includes('[::1]')
        ) {
          logger.warn(
            `[SETTINGS-IMPORT] Blocking potentially unsafe URL: ${value}`,
          );
          throw new Error(
            `Invalid ${key}: potentially unsafe URL pattern detected`,
          );
        }
        break;

      case 'textModel':
      case 'visionModel':
      case 'embeddingModel':
        if (typeof value !== 'string' || !MODEL_REGEX.test(value)) {
          throw new Error(
            `Invalid ${key}: must be alphanumeric with hyphens, underscores, dots, @, or colons`,
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
        if (
          typeof value !== 'string' ||
          !['light', 'dark', 'auto', 'system'].includes(value)
        ) {
          throw new Error(
            `Invalid ${key}: must be 'light', 'dark', 'auto', or 'system'`,
          );
        }
        break;

      case 'language':
        if (typeof value !== 'string' || value.length > 10) {
          throw new Error(`Invalid ${key}: must be a valid language code`);
        }
        break;

      case 'loggingLevel':
        if (
          typeof value !== 'string' ||
          !['error', 'warn', 'info', 'debug'].includes(value)
        ) {
          throw new Error(
            `Invalid ${key}: must be 'error', 'warn', 'info', or 'debug'`,
          );
        }
        break;

      case 'cacheSize':
      case 'maxBatchSize':
        if (!Number.isInteger(value) || value < 0 || value > 100000) {
          throw new Error(
            `Invalid ${key}: must be integer between 0 and 100000`,
          );
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

function registerSettingsIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  settingsService,
  setOllamaHost,
  setOllamaModel,
  setOllamaVisionModel,
  setOllamaEmbeddingModel,
  onSettingsChanged,
}) {
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.GET,
    withErrorLogging(logger, async () => {
      try {
        const loaded = await settingsService.load();
        return loaded;
      } catch (error) {
        logger.error('Failed to get settings:', error);
        return {};
      }
    }),
  );

  // Fixed: Add endpoint to get configurable limits
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.GET_CONFIGURABLE_LIMITS,
    withErrorLogging(logger, async () => {
      try {
        const settings = await settingsService.load();
        return getConfigurableLimits(settings);
      } catch (error) {
        logger.error('Failed to get configurable limits:', error);
        return getConfigurableLimits({});
      }
    }),
  );

  const settingsSchema = z
    ? z
        .object({
          // Fixed: Use regex for more permissive URL validation (optional protocol)
          ollamaHost: z
            .string()
            .regex(
              /^(?:https?:\/\/)?(?:[\w.-]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/,
              'Invalid Ollama URL format',
            )
            .optional(),
          textModel: z.string().optional(),
          visionModel: z.string().optional(),
          embeddingModel: z.string().optional(),
          launchOnStartup: z.boolean().optional(),
          autoOrganize: z.boolean().optional(),
          backgroundMode: z.boolean().optional(),
        })
        .partial()
    : null;
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.SAVE,
    z && settingsSchema
      ? withValidation(logger, settingsSchema, async (event, settings) => {
          void event;
          try {
            // Fixed: Handle validation results from SettingsService
            const saveResult = await settingsService.save(settings);
            const merged = saveResult.settings || saveResult; // Backward compatibility
            const validationWarnings = saveResult.validationWarnings || [];

            if (merged.ollamaHost) await setOllamaHost(merged.ollamaHost);
            if (merged.textModel) await setOllamaModel(merged.textModel);
            if (merged.visionModel)
              await setOllamaVisionModel(merged.visionModel);
            if (
              merged.embeddingModel &&
              typeof setOllamaEmbeddingModel === 'function'
            )
              await setOllamaEmbeddingModel(merged.embeddingModel);
            if (typeof merged.launchOnStartup === 'boolean') {
              try {
                app.setLoginItemSettings({
                  openAtLogin: merged.launchOnStartup,
                });
              } catch (error) {
                logger.warn(
                  '[SETTINGS] Failed to set login item settings:',
                  error.message,
                );
              }
            }
            logger.info('[SETTINGS] Saved settings');

            // Fixed: Enhanced settings propagation with error logging
            let propagationSuccess = true;
            try {
              if (typeof onSettingsChanged === 'function') {
                await onSettingsChanged(merged);
                logger.info(
                  '[SETTINGS] Settings change notification sent successfully',
                );
              } else if (
                onSettingsChanged !== undefined &&
                onSettingsChanged !== null
              ) {
                logger.warn(
                  '[SETTINGS] onSettingsChanged is not a function:',
                  typeof onSettingsChanged,
                );
              }
            } catch (error) {
              propagationSuccess = false;
              logger.error(
                '[SETTINGS] Settings change notification failed:',
                error,
              );
            }

            return {
              success: true,
              settings: merged,
              propagationSuccess,
              validationWarnings,
            };
          } catch (error) {
            logger.error('Failed to save settings:', error);

            // Include validation errors if available
            const response = {
              success: false,
              error: error.message,
            };

            if (error.validationErrors) {
              response.validationErrors = error.validationErrors;
            }
            if (error.validationWarnings) {
              response.validationWarnings = error.validationWarnings;
            }

            return response;
          }
        })
      : withErrorLogging(logger, async (event, settings) => {
          void event;
          try {
            // Fixed: Handle validation results from SettingsService
            const saveResult = await settingsService.save(settings);
            const merged = saveResult.settings || saveResult; // Backward compatibility
            const validationWarnings = saveResult.validationWarnings || [];

            if (merged.ollamaHost) await setOllamaHost(merged.ollamaHost);
            if (merged.textModel) await setOllamaModel(merged.textModel);
            if (merged.visionModel)
              await setOllamaVisionModel(merged.visionModel);
            if (
              merged.embeddingModel &&
              typeof setOllamaEmbeddingModel === 'function'
            )
              await setOllamaEmbeddingModel(merged.embeddingModel);
            if (typeof merged.launchOnStartup === 'boolean') {
              try {
                app.setLoginItemSettings({
                  openAtLogin: merged.launchOnStartup,
                });
              } catch (error) {
                logger.warn(
                  '[SETTINGS] Failed to set login item settings:',
                  error.message,
                );
              }
            }
            logger.info('[SETTINGS] Saved settings');

            // Fixed: Enhanced settings propagation with error logging
            let propagationSuccess = true;
            try {
              if (typeof onSettingsChanged === 'function') {
                await onSettingsChanged(merged);
                logger.info(
                  '[SETTINGS] Settings change notification sent successfully',
                );
              } else if (
                onSettingsChanged !== undefined &&
                onSettingsChanged !== null
              ) {
                logger.warn(
                  '[SETTINGS] onSettingsChanged is not a function:',
                  typeof onSettingsChanged,
                );
              }
            } catch (error) {
              propagationSuccess = false;
              logger.error(
                '[SETTINGS] Settings change notification failed:',
                error,
              );
            }

            return {
              success: true,
              settings: merged,
              propagationSuccess,
              validationWarnings,
            };
          } catch (error) {
            logger.error('Failed to save settings:', error);

            // Include validation errors if available
            const response = {
              success: false,
              error: error.message,
            };

            if (error.validationErrors) {
              response.validationErrors = error.validationErrors;
            }
            if (error.validationWarnings) {
              response.validationWarnings = error.validationWarnings;
            }

            return response;
          }
        }),
  );

  // Fixed: Add config export handler
  ipcMain.handle(
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
          settings,
        };

        // If no path provided, show save dialog
        let filePath = exportPath;
        if (!filePath) {
          const result = await dialog.showSaveDialog({
            title: 'Export Settings',
            defaultPath: `stratosort-config-${new Date().toISOString().split('T')[0]}.json`,
            filters: [
              { name: 'JSON Files', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });

          if (result.canceled) {
            return { success: false, canceled: true };
          }

          filePath = result.filePath;
        }

        // Write export file
        // FIX: Use atomic write (temp + rename) to prevent corruption on crash
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        try {
          await fs.writeFile(
            tempPath,
            JSON.stringify(exportData, null, 2),
            'utf8',
          );
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

        return {
          success: true,
          path: filePath,
        };
      } catch (error) {
        logger.error('[SETTINGS] Failed to export settings:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Fixed: Add config import handler
  ipcMain.handle(
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
              { name: 'All Files', extensions: ['*'] },
            ],
            properties: ['openFile'],
          });

          if (result.canceled) {
            return { success: false, canceled: true };
          }

          filePath = result.filePaths[0];
        }

        // Read and parse import file
        const fileContent = await fs.readFile(filePath, 'utf8');

        // Fixed: Add specific error handling for JSON parsing
        let importData;
        try {
          importData = JSON.parse(fileContent);
        } catch (parseError) {
          throw new Error(
            `Invalid JSON in settings file: ${parseError.message}`,
          );
        }

        // Validate import data structure
        if (!importData.settings || typeof importData.settings !== 'object') {
          throw new Error(
            'Invalid settings file: missing or invalid settings object',
          );
        }

        // HIGH PRIORITY FIX (HIGH-14): Sanitize and validate imported settings
        // Prevents prototype pollution, command injection, and data exfiltration
        const sanitizedSettings = validateImportedSettings(
          importData.settings,
          logger,
        );

        // Save sanitized settings
        const saveResult = await settingsService.save(sanitizedSettings);
        const merged = saveResult.settings || saveResult;
        const validationWarnings = saveResult.validationWarnings || [];

        // Apply settings
        if (merged.ollamaHost) await setOllamaHost(merged.ollamaHost);
        if (merged.textModel) await setOllamaModel(merged.textModel);
        if (merged.visionModel) await setOllamaVisionModel(merged.visionModel);
        if (
          merged.embeddingModel &&
          typeof setOllamaEmbeddingModel === 'function'
        )
          await setOllamaEmbeddingModel(merged.embeddingModel);

        if (typeof merged.launchOnStartup === 'boolean') {
          try {
            app.setLoginItemSettings({
              openAtLogin: merged.launchOnStartup,
            });
          } catch (error) {
            logger.warn(
              '[SETTINGS] Failed to set login item settings:',
              error.message,
            );
          }
        }

        // Notify settings changed
        if (typeof onSettingsChanged === 'function') {
          await onSettingsChanged(merged);
        }

        logger.info('[SETTINGS] Imported settings from:', filePath);

        return {
          success: true,
          settings: merged,
          validationWarnings,
          importInfo: {
            version: importData.version,
            exportDate: importData.exportDate,
            appVersion: importData.appVersion,
          },
        };
      } catch (error) {
        logger.error('[SETTINGS] Failed to import settings:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  // Fixed: Add backup management handlers
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.CREATE_BACKUP,
    withErrorLogging(logger, async () => {
      try {
        const result = await settingsService.createBackup();
        logger.info('[SETTINGS] Backup created:', result.path);
        return result;
      } catch (error) {
        logger.error('[SETTINGS] Failed to create backup:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.LIST_BACKUPS,
    withErrorLogging(logger, async () => {
      try {
        const backups = await settingsService.listBackups();
        return {
          success: true,
          backups,
        };
      } catch (error) {
        logger.error('[SETTINGS] Failed to list backups:', error);
        return {
          success: false,
          error: error.message,
          backups: [],
        };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.RESTORE_BACKUP,
    withErrorLogging(logger, async (event, backupPath) => {
      void event;
      try {
        const result = await settingsService.restoreFromBackup(backupPath);

        if (result.success) {
          // Apply restored settings
          const merged = result.settings;

          if (merged.ollamaHost) await setOllamaHost(merged.ollamaHost);
          if (merged.textModel) await setOllamaModel(merged.textModel);
          if (merged.visionModel)
            await setOllamaVisionModel(merged.visionModel);
          if (
            merged.embeddingModel &&
            typeof setOllamaEmbeddingModel === 'function'
          )
            await setOllamaEmbeddingModel(merged.embeddingModel);

          if (typeof merged.launchOnStartup === 'boolean') {
            try {
              app.setLoginItemSettings({
                openAtLogin: merged.launchOnStartup,
              });
            } catch (error) {
              logger.warn(
                '[SETTINGS] Failed to set login item settings:',
                error.message,
              );
            }
          }

          // Notify settings changed
          if (typeof onSettingsChanged === 'function') {
            await onSettingsChanged(merged);
          }

          logger.info('[SETTINGS] Restored from backup:', backupPath);
        }

        return result;
      } catch (error) {
        logger.error('[SETTINGS] Failed to restore backup:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS.DELETE_BACKUP,
    withErrorLogging(logger, async (event, backupPath) => {
      void event;
      try {
        const result = await settingsService.deleteBackup(backupPath);
        if (result.success) {
          logger.info('[SETTINGS] Deleted backup:', backupPath);
        }
        return result;
      } catch (error) {
        logger.error('[SETTINGS] Failed to delete backup:', error);
        return {
          success: false,
          error: error.message,
        };
      }
    }),
  );
}

module.exports = registerSettingsIpc;
