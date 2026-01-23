const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { getOllama } = require('../ollamaUtils');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { withAbortableTimeout } = require('../../shared/promiseUtils');
const { AI_DEFAULTS } = require('../../shared/constants');
const { enhanceSmartFolderWithLLM } = require('../services/SmartFoldersLLMService');
const { withErrorLogging, safeHandle } = require('./ipcWrappers');
const { extractAndParseJSON } = require('../utils/jsonRepair');
// const { capEmbeddingInput } = require('../utils/embeddingInput');
const { cosineSimilarity } = require('../../shared/vectorMath');
const { isNotFoundError } = require('../../shared/errorClassifier');
const FolderMatchingService = require('../services/FolderMatchingService');
const {
  enrichFolderTextForEmbedding,
  enrichFileTextForEmbedding
} = require('../analysis/semanticExtensionMap');

// Import centralized security configuration
const { ALLOWED_APP_PATHS } = require('../../shared/securityConfig');
const { validateFileOperationPathSync } = require('../../shared/pathSanitization');

// FIX: Import centralized error codes for consistent error handling
const { ERROR_CODES } = require('../../shared/errorHandlingUtils');

/**
 * CRITICAL SECURITY FIX: Sanitize and validate folder paths to prevent path traversal attacks
 * @param {string} inputPath - User-provided path to validate
 * @returns {string} - Sanitized, validated path
 * @throws {Error} - If path is invalid or violates security constraints
 */
function sanitizeFolderPath(inputPath) {
  // Get allowed base paths from centralized config
  const ALLOWED_BASE_PATHS = ALLOWED_APP_PATHS.map((appPath) => {
    try {
      return app.getPath(appPath);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const validation = validateFileOperationPathSync(inputPath, ALLOWED_BASE_PATHS, {
    requireAbsolute: true,
    disallowUNC: true,
    disallowUrlSchemes: true
  });

  if (validation.valid) {
    return validation.normalizedPath;
  }

  // Cross-platform fallback: allow POSIX-style paths on Windows in test/mocked environments.
  if (
    process.platform === 'win32' &&
    typeof inputPath === 'string' &&
    inputPath.startsWith('/') &&
    ALLOWED_BASE_PATHS.some((base) => typeof base === 'string' && base.startsWith('/'))
  ) {
    const normalized = path.posix.normalize(inputPath);
    if (!path.posix.isAbsolute(normalized)) {
      throw new Error('Invalid path: must be absolute');
    }
    const parts = normalized.split('/').filter(Boolean);
    if (parts.some((part) => part === '..')) {
      throw new Error('Invalid path: path traversal detected');
    }
    const allowed = ALLOWED_BASE_PATHS.some((base) => {
      if (!base || !base.startsWith('/')) return false;
      const baseNormalized = path.posix.normalize(base);
      if (normalized === baseNormalized) return true;
      return normalized.startsWith(`${baseNormalized}/`);
    });
    if (!allowed) {
      throw new Error(
        'Invalid path: must be within allowed directories (Documents, Downloads, Desktop, Pictures, Videos, Music, or Home)'
      );
    }
    return normalized;
  }

  throw new Error(
    validation.error ||
      'Invalid path: must be within allowed directories (Documents, Downloads, Desktop, Pictures, Videos, Music, or Home)'
  );
}

const { IpcServiceContext, createFromLegacyParams } = require('./IpcServiceContext');

function registerSmartFoldersIpc(servicesOrParams) {
  let container;
  if (servicesOrParams instanceof IpcServiceContext) {
    container = servicesOrParams;
  } else {
    // Handling the case where getSmartFolderWatcher might be passed in legacy params
    // but createFromLegacyParams doesn't explicitly handle it in the 'set' methods
    // unless we add it or just extract it from params if it's there.
    // However, the new pattern is to derive it from serviceIntegration.
    container = createFromLegacyParams(servicesOrParams);
  }

  const { ipcMain, IPC_CHANNELS, logger } = container.core;
  const { getCustomFolders, setCustomFolders, saveCustomFolders, scanDirectory } =
    container.folders;
  const { getOllamaModel, buildOllamaOptions } = container.ollama;
  const { getServiceIntegration } = container;

  // Derive getSmartFolderWatcher from serviceIntegration if not provided
  // (In legacy mode, it might have been passed directly, but we want to move away from that)
  // Actually, registerAllIpc passes a custom function.
  // If I use IpcServiceContext, I should replicate that logic here.

  const getSmartFolderWatcher = () => {
    if (getServiceIntegration) {
      const serviceIntegration = getServiceIntegration();
      return serviceIntegration?.smartFolderWatcher || null;
    }
    // Fallback for legacy params if it was passed directly (though createFromLegacyParams doesn't store it)
    // If servicesOrParams is object and has getSmartFolderWatcher, use it?
    if (servicesOrParams.getSmartFolderWatcher) {
      return servicesOrParams.getSmartFolderWatcher();
    }
    return null;
  };

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.GET,
    withErrorLogging(logger, async () => {
      try {
        const customFolders = getCustomFolders();
        logger.info(
          '[SMART-FOLDERS] Getting Smart Folders for UI:',
          customFolders?.length || 0,
          'folders'
        );

        if (!Array.isArray(customFolders)) {
          logger.warn(
            '[SMART-FOLDERS] getCustomFolders() returned non-array:',
            typeof customFolders
          );
          return [];
        }

        if (customFolders.length === 0) {
          logger.info('[SMART-FOLDERS] No custom folders found, returning empty array');
          return [];
        }

        const foldersWithStatus = await Promise.all(
          customFolders.map(async (folder) => {
            // Skip path check if path is null or empty (default folders)
            if (!folder || !folder.path || folder.path.trim() === '') {
              return { ...folder, physicallyExists: false };
            }
            try {
              const stats = await fs.stat(folder.path);
              return { ...folder, physicallyExists: stats.isDirectory() };
            } catch (error) {
              logger.debug('[SMART-FOLDERS] Path check failed for:', folder.path, error.message);
              return { ...folder, physicallyExists: false };
            }
          })
        );

        logger.info('[SMART-FOLDERS] Returning', foldersWithStatus.length, 'folders with status');
        return foldersWithStatus;
      } catch (error) {
        logger.error('[SMART-FOLDERS] Error in GET handler:', error);
        // Return error response with empty folders array so callers can check success
        // and still safely iterate over folders if they don't check
        return { success: false, error: error.message, folders: [] };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.GET_CUSTOM,
    withErrorLogging(logger, async () => {
      const customFolders = getCustomFolders();
      logger.info('[SMART-FOLDERS] Getting Custom Folders for UI:', customFolders.length);
      return customFolders;
    })
  );

  // Smart folder matching using embeddings/LLM with fallbacks
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.MATCH,
    withErrorLogging(logger, async (event, payload) => {
      try {
        const { text, smartFolders = [] } = payload || {};
        if (!text || !Array.isArray(smartFolders) || smartFolders.length === 0) {
          return {
            success: false,
            error: 'Invalid input for SMART_FOLDERS.MATCH'
          };
        }

        try {
          // Use FolderMatchingService for efficient embedding generation with caching
          const folderMatchingService = FolderMatchingService.getInstance();

          // Ensure service is initialized (handled internally, but good practice)
          await folderMatchingService.initialize().catch((err) => {
            logger.warn('[SMART_FOLDERS.MATCH] FolderMatchingService init warning:', err.message);
          });

          // Embed the query text
          // embedText handles capping, model selection, and caching automatically

          // FIX: Enrich input text if it looks like a filename (has extension)
          // This ensures preview matches align with background analysis
          let queryText = text;
          // Simple extension check: dot followed by 1-5 alphanumeric chars at end of string
          const extMatch = text.match(/\.([a-zA-Z0-9]{1,5})$/);
          if (extMatch) {
            queryText = enrichFileTextForEmbedding(text, extMatch[0]);
            logger.debug('[SMART_FOLDERS.MATCH] Enriched query text with semantic keywords', {
              original: text,
              enriched: queryText
            });
          }

          const queryResult = await folderMatchingService.embedText(queryText);
          const queryVector = queryResult.vector;

          if (!queryVector || queryVector.length === 0) {
            throw new Error('Failed to generate query embedding');
          }

          const scored = [];

          // Parallelize folder embedding generation with concurrency limit handled by service
          // or just sequential here since we use the service's cache which is fast
          for (const folder of smartFolders) {
            // Use same enrichment logic as upsertFolderEmbedding for consistent cache keys
            const folderText = enrichFolderTextForEmbedding(folder.name, folder.description);

            try {
              const folderResult = await folderMatchingService.embedText(folderText);
              const folderVector = folderResult.vector;

              if (folderVector && folderVector.length > 0) {
                const score = cosineSimilarity(queryVector, folderVector);
                scored.push({ folder, score });
              }
            } catch (embedErr) {
              logger.warn(
                `[SMART_FOLDERS.MATCH] Failed to embed folder "${folder.name}":`,
                embedErr.message
              );
              // Continue with other folders
            }
          }

          scored.sort((a, b) => b.score - a.score);

          // Bounds check: ensure scored array is not empty
          if (scored.length === 0) {
            throw new Error('No folder scores computed');
          }

          const best = scored[0];
          return {
            success: true,
            folder: best.folder,
            score: best.score,
            method: 'embeddings'
          };
        } catch (e) {
          try {
            const ollama = await getOllama();
            const genPerf = await buildOllamaOptions('text');
            const prompt = `You are ranking folders for organizing a file. Given this description:\n"""${text}"""\nFolders:\n${smartFolders.map((f, i) => `${i + 1}. ${f.name} - ${f.description || ''}`).join('\n')}\nReturn JSON: { "index": <1-based best folder index>, "reason": "..." }`;
            const timeoutMs = TIMEOUTS.AI_ANALYSIS_LONG;
            logger.debug('[SMART_FOLDERS.MATCH] Using text model', {
              model: getOllamaModel() || AI_DEFAULTS.TEXT.MODEL,
              timeoutMs
            });
            const resp = await withAbortableTimeout(
              (abortController) =>
                ollama.generate({
                  model: getOllamaModel() || AI_DEFAULTS.TEXT.MODEL,
                  prompt,
                  format: 'json',
                  options: { ...genPerf, temperature: 0.1, num_predict: 200 },
                  signal: abortController.signal
                }),
              timeoutMs,
              'Smart folder LLM match'
            );
            // Use robust JSON extraction with repair for malformed LLM responses
            const parsed = extractAndParseJSON(resp.response, null);
            if (!parsed) {
              throw new Error('Failed to parse LLM JSON response');
            }
            const parsedIdx = parseInt(parsed.index, 10);
            // Validate parsed index is a valid number
            if (isNaN(parsedIdx) || parsedIdx < 1) {
              throw new Error('Invalid folder index from LLM response');
            }
            const idx = Math.max(1, Math.min(smartFolders.length, parsedIdx));
            return {
              success: true,
              folder: smartFolders[idx - 1],
              reason: parsed.reason,
              method: 'llm'
            };
          } catch (llmErr) {
            const scored = smartFolders
              .map((f) => {
                const textLower = text.toLowerCase();
                const hay = [f.name, f.description].filter(Boolean).join(' ').toLowerCase();
                let score = 0;
                textLower.split(/\W+/).forEach((w) => {
                  if (w && hay.includes(w)) score += 1;
                });
                return { folder: f, score };
              })
              .sort((a, b) => b.score - a.score);
            return {
              success: true,
              folder: scored[0]?.folder || smartFolders[0],
              method: 'fallback'
            };
          }
        }
      } catch (error) {
        logger.error('[SMART_FOLDERS.MATCH] Failed:', error);
        return { success: false, error: error.message };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.SAVE,
    withErrorLogging(logger, async (event, folders) => {
      try {
        if (!Array.isArray(folders))
          return {
            success: false,
            error: 'Folders must be an array',
            errorCode: ERROR_CODES.INVALID_INPUT
          };

        // FIX: Prevent saving empty array - at minimum Uncategorized must exist
        if (folders.length === 0) {
          logger.warn('[SMART-FOLDERS] Rejecting save of empty folders array');
          return {
            success: false,
            error: 'Cannot save empty folders list. At least one folder is required.',
            errorCode: ERROR_CODES.INVALID_INPUT
          };
        }

        // FIX: Ensure Uncategorized folder is always preserved
        const hasUncategorized = folders.some(
          (f) => f.isDefault && f.name?.toLowerCase() === 'uncategorized'
        );
        if (!hasUncategorized) {
          logger.warn('[SMART-FOLDERS] Rejecting save without Uncategorized folder');
          return {
            success: false,
            error: 'The Uncategorized default folder cannot be removed.',
            errorCode: ERROR_CODES.INVALID_INPUT
          };
        }

        // Ensure all folder paths exist as physical directories
        for (const folder of folders) {
          if (folder.path) {
            try {
              const stats = await fs.stat(folder.path);
              if (!stats.isDirectory()) {
                return {
                  success: false,
                  error: `Path "${folder.path}" exists but is not a directory`,
                  errorCode: ERROR_CODES.INVALID_PATH
                };
              }
            } catch (error) {
              if (isNotFoundError(error)) {
                // Directory doesn't exist, create it
                try {
                  await fs.mkdir(folder.path, { recursive: true });
                  logger.info('[SMART-FOLDERS] Created directory:', folder.path);
                } catch (createError) {
                  return {
                    success: false,
                    error: `Failed to create directory "${folder.path}": ${createError.message}`,
                    errorCode: ERROR_CODES.DIRECTORY_CREATION_FAILED
                  };
                }
              } else {
                throw error;
              }
            }
          }
        }

        const originalFolders = [...getCustomFolders()];
        try {
          setCustomFolders(folders);
          await saveCustomFolders(folders);
          logger.info('[SMART-FOLDERS] Saved Smart Folders:', folders.length);
          return { success: true, folders: getCustomFolders() };
        } catch (saveError) {
          setCustomFolders(originalFolders);
          throw saveError;
        }
      } catch (error) {
        logger.error('[ERROR] Failed to save smart folders:', error);
        return {
          success: false,
          error: error.message,
          errorCode: ERROR_CODES.SAVE_FAILED
        };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.UPDATE_CUSTOM,
    withErrorLogging(logger, async (event, folders) => {
      try {
        if (!Array.isArray(folders))
          return {
            success: false,
            error: 'Folders must be an array',
            errorCode: ERROR_CODES.INVALID_INPUT
          };

        // FIX: Prevent saving empty array - at minimum Uncategorized must exist
        if (folders.length === 0) {
          logger.warn('[SMART-FOLDERS] Rejecting update with empty folders array');
          return {
            success: false,
            error: 'Cannot save empty folders list. At least one folder is required.',
            errorCode: ERROR_CODES.INVALID_INPUT
          };
        }

        // FIX: Ensure Uncategorized folder is always preserved
        const hasUncategorized = folders.some(
          (f) => f.isDefault && f.name?.toLowerCase() === 'uncategorized'
        );
        if (!hasUncategorized) {
          logger.warn('[SMART-FOLDERS] Rejecting update without Uncategorized folder');
          return {
            success: false,
            error: 'The Uncategorized default folder cannot be removed.',
            errorCode: ERROR_CODES.INVALID_INPUT
          };
        }

        // Ensure all folder paths exist as physical directories
        for (const folder of folders) {
          if (folder.path) {
            try {
              const stats = await fs.stat(folder.path);
              if (!stats.isDirectory()) {
                return {
                  success: false,
                  error: `Path "${folder.path}" exists but is not a directory`,
                  errorCode: ERROR_CODES.INVALID_PATH
                };
              }
            } catch (error) {
              if (isNotFoundError(error)) {
                // Directory doesn't exist, create it
                try {
                  await fs.mkdir(folder.path, { recursive: true });
                  logger.info('[SMART-FOLDERS] Created directory:', folder.path);
                } catch (createError) {
                  return {
                    success: false,
                    error: `Failed to create directory "${folder.path}": ${createError.message}`,
                    errorCode: ERROR_CODES.DIRECTORY_CREATION_FAILED
                  };
                }
              } else {
                throw error;
              }
            }
          }
        }

        const originalFolders = [...getCustomFolders()];
        try {
          setCustomFolders(folders);
          await saveCustomFolders(folders);
          logger.info('[SMART-FOLDERS] Updated Custom Folders:', folders.length);
          return { success: true, folders: getCustomFolders() };
        } catch (saveError) {
          setCustomFolders(originalFolders);
          throw saveError;
        }
      } catch (error) {
        logger.error('[ERROR] Failed to update custom folders:', error);
        return {
          success: false,
          error: error.message,
          errorCode: ERROR_CODES.UPDATE_FAILED
        };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.EDIT,
    withErrorLogging(logger, async (event, folderId, updatedFolder) => {
      try {
        if (!folderId || typeof folderId !== 'string')
          return {
            success: false,
            error: 'Valid folder ID is required',
            errorCode: ERROR_CODES.INVALID_FOLDER_ID
          };
        if (!updatedFolder || typeof updatedFolder !== 'object')
          return {
            success: false,
            error: 'Valid folder data is required',
            errorCode: ERROR_CODES.INVALID_FOLDER_DATA
          };
        const customFolders = getCustomFolders();
        const folderIndex = customFolders.findIndex((f) => f.id === folderId);
        if (folderIndex === -1)
          return {
            success: false,
            error: 'Folder not found',
            errorCode: ERROR_CODES.FOLDER_NOT_FOUND
          };
        if (updatedFolder.name) {
          // Fix for issue where " > Subfolder" might be appended
          if (updatedFolder.name.includes(' > ')) {
            updatedFolder.name = updatedFolder.name.split(' > ')[0].trim();
          }

          const illegalChars = /([<>:"|?*])/g;
          if (illegalChars.test(updatedFolder.name)) {
            return {
              success: false,
              error: 'Folder name contains invalid characters. Please avoid: < > : " | ? *',
              errorCode: ERROR_CODES.INVALID_FOLDER_NAME_CHARS
            };
          }
          const existingFolder = customFolders.find(
            (f) =>
              f.id !== folderId && f.name.toLowerCase() === updatedFolder.name.trim().toLowerCase()
          );
          if (existingFolder)
            return {
              success: false,
              error: `A smart folder with name "${updatedFolder.name}" already exists`,
              errorCode: ERROR_CODES.FOLDER_NAME_EXISTS
            };
        }
        if (updatedFolder.path) {
          try {
            // CRITICAL SECURITY FIX: Sanitize path before any operations
            const normalizedPath = sanitizeFolderPath(updatedFolder.path);
            const parentDir = path.dirname(normalizedPath);

            // FIX: Auto-create parent directory if it doesn't exist (Issue 3.1-A, 3.1-B)
            try {
              const parentStats = await fs.stat(parentDir);
              if (!parentStats.isDirectory()) {
                return {
                  success: false,
                  error: `Parent directory "${parentDir}" is not a directory`,
                  errorCode: ERROR_CODES.PARENT_NOT_DIRECTORY
                };
              }
            } catch (parentError) {
              if (parentError.code === 'ENOENT') {
                // Parent doesn't exist - create it recursively
                await fs.mkdir(parentDir, { recursive: true });
                logger.info('[SMART-FOLDERS] Created parent directory for edit:', parentDir);
              } else {
                throw parentError;
              }
            }

            updatedFolder.path = normalizedPath;
          } catch (pathError) {
            return {
              success: false,
              error: `Invalid path: ${pathError.message}`,
              errorCode: ERROR_CODES.INVALID_PATH
            };
          }
        }
        const originalFolder = { ...customFolders[folderIndex] };
        if (updatedFolder.path && updatedFolder.path !== originalFolder.path) {
          try {
            const oldPath = originalFolder.path;
            const newPath = updatedFolder.path;
            const oldStats = await fs.stat(oldPath);
            if (!oldStats.isDirectory())
              return {
                success: false,
                error: 'Original path is not a directory',
                errorCode: ERROR_CODES.ORIGINAL_NOT_DIRECTORY
              };
            await fs.rename(oldPath, newPath);
            logger.info(`[SMART-FOLDERS] Renamed directory "${oldPath}" -> "${newPath}"`);
          } catch (renameErr) {
            logger.error('[SMART-FOLDERS] Directory rename failed:', renameErr.message);
            return {
              success: false,
              error: 'Failed to rename directory',
              errorCode: ERROR_CODES.RENAME_FAILED,
              details: renameErr.message
            };
          }
        }
        try {
          customFolders[folderIndex] = {
            ...customFolders[folderIndex],
            ...updatedFolder,
            updatedAt: new Date().toISOString()
          };
          setCustomFolders(customFolders);
          await saveCustomFolders(customFolders);
          logger.info('[SMART-FOLDERS] Edited Smart Folder:', folderId);
          return {
            success: true,
            folder: customFolders[folderIndex],
            message: 'Smart folder updated successfully'
          };
        } catch (saveError) {
          customFolders[folderIndex] = originalFolder;
          throw saveError;
        }
      } catch (error) {
        logger.error('[ERROR] Failed to edit smart folder:', error);
        return {
          success: false,
          error: error.message,
          errorCode: ERROR_CODES.EDIT_FAILED
        };
      }
    })
  );

  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.DELETE,
    withErrorLogging(logger, async (event, folderId) => {
      try {
        if (!folderId || typeof folderId !== 'string')
          return {
            success: false,
            error: 'Valid folder ID is required',
            errorCode: ERROR_CODES.INVALID_FOLDER_ID
          };
        const customFolders = getCustomFolders();
        const folderIndex = customFolders.findIndex((f) => f.id === folderId);
        if (folderIndex === -1)
          return {
            success: false,
            error: 'Folder not found',
            errorCode: ERROR_CODES.FOLDER_NOT_FOUND
          };

        // FIX: Prevent deleting the Uncategorized default folder
        const folderToDelete = customFolders[folderIndex];
        if (folderToDelete.isDefault && folderToDelete.name?.toLowerCase() === 'uncategorized') {
          logger.warn('[SMART-FOLDERS] Rejecting deletion of Uncategorized folder');
          return {
            success: false,
            error: 'The Uncategorized default folder cannot be deleted.',
            errorCode: ERROR_CODES.INVALID_INPUT
          };
        }

        const originalFolders = [...customFolders];
        const deletedFolder = customFolders[folderIndex];
        try {
          const updated = customFolders.filter((f) => f.id !== folderId);
          setCustomFolders(updated);
          await saveCustomFolders(updated);
          logger.info('[SMART-FOLDERS] Deleted Smart Folder:', folderId);
          // Note: We intentionally do NOT delete the physical directory.
          // The UI promises "This will not delete the physical directory or its files."
          // Users can manually delete the folder if desired.
          return {
            success: true,
            folders: updated,
            deletedFolder,
            directoryRemoved: false,
            message: `Smart folder "${deletedFolder.name}" removed from StratoSort`
          };
        } catch (saveError) {
          setCustomFolders(originalFolders);
          throw saveError;
        }
      } catch (error) {
        logger.error('[ERROR] Failed to delete smart folder:', error);
        return {
          success: false,
          error: error.message,
          errorCode: ERROR_CODES.DELETE_FAILED
        };
      }
    })
  );

  // FIX: Generate description for smart folder using AI (Issue 2.5)
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.GENERATE_DESCRIPTION,
    withErrorLogging(logger, async (event, folderName) => {
      try {
        if (!folderName || typeof folderName !== 'string') {
          return {
            success: false,
            error: 'Folder name is required'
          };
        }

        // Generate description using LLM
        const prompt = `You are helping organize files on a computer. Generate a brief, helpful description (1-2 sentences) for a folder called "${folderName}". The description should explain what types of files belong in this folder to help an AI system match files to folders. Be specific and practical.

Example for "Work Documents": "Contains professional documents, reports, and work-related files such as meeting notes, project plans, and business correspondence."

Now generate a description for "${folderName}":`;

        try {
          const model = getOllamaModel();
          if (!model) {
            return {
              success: false,
              error: 'Ollama model not configured'
            };
          }

          const OllamaService = require('../services/OllamaService');
          const result = await OllamaService.analyzeText(prompt, { model });

          if (result.success && result.response && result.response.trim()) {
            return {
              success: true,
              description: result.response.trim()
            };
          }
          return {
            success: false,
            error: result.error || 'No response from AI'
          };
        } catch (llmError) {
          logger.error('[SMART-FOLDERS] LLM description generation failed:', llmError.message);
          return {
            success: false,
            error: 'AI service unavailable'
          };
        }
      } catch (error) {
        logger.error('[ERROR] Failed to generate description:', error);
        return {
          success: false,
          error: error.message
        };
      }
    })
  );

  // Create/add new smart folder with LLM enhancement
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.ADD,
    withErrorLogging(logger, async (event, folder) => {
      try {
        if (!folder || typeof folder !== 'object')
          return {
            success: false,
            error: 'Invalid folder data provided',
            errorCode: ERROR_CODES.INVALID_FOLDER_DATA
          };
        if (!folder.name || typeof folder.name !== 'string' || !folder.name.trim())
          return {
            success: false,
            error: 'Folder name is required and must be a non-empty string',
            errorCode: ERROR_CODES.INVALID_FOLDER_NAME
          };
        if (!folder.path || typeof folder.path !== 'string' || !folder.path.trim())
          return {
            success: false,
            error: 'Folder path is required and must be a non-empty string',
            errorCode: ERROR_CODES.INVALID_FOLDER_PATH
          };

        // CRITICAL FIX: Sanitize folder name to remove any accidental path separators or suffixes
        // This addresses an issue where names like "Work > Project Management Templates" were being created
        let sanitizedName = folder.name.trim();
        if (sanitizedName.includes(' > ')) {
          sanitizedName = sanitizedName.split(' > ')[0].trim();
        }

        const illegalChars = /([<>:"|?*])/g;
        if (illegalChars.test(sanitizedName))
          return {
            success: false,
            error: 'Folder name contains invalid characters. Please avoid: < > : " | ? *',
            errorCode: ERROR_CODES.INVALID_FOLDER_NAME_CHARS
          };

        const customFolders = getCustomFolders();

        // CRITICAL SECURITY FIX: Sanitize path before any operations
        let normalizedPath;
        try {
          normalizedPath = sanitizeFolderPath(folder.path);
        } catch (securityError) {
          return {
            success: false,
            error: securityError.message,
            errorCode: ERROR_CODES.SECURITY_PATH_VIOLATION
          };
        }

        const existingFolder = customFolders.find(
          (f) => f.name.toLowerCase() === sanitizedName.toLowerCase() || f.path === normalizedPath
        );
        if (existingFolder)
          return {
            success: false,
            error: `A smart folder with name "${existingFolder.name}" or path "${existingFolder.path}" already exists`,
            errorCode: ERROR_CODES.FOLDER_ALREADY_EXISTS
          };
        // FIX: Auto-create parent directory if it doesn't exist (Issue 3.1-A, 3.1-B)
        const parentDir = path.dirname(normalizedPath);
        try {
          const parentStats = await fs.stat(parentDir);
          if (!parentStats.isDirectory()) {
            return {
              success: false,
              error: `Parent directory "${parentDir}" is not a directory`,
              errorCode: ERROR_CODES.PARENT_NOT_DIRECTORY
            };
          }
        } catch (parentError) {
          // Parent doesn't exist - create it recursively
          if (parentError.code === 'ENOENT') {
            try {
              await fs.mkdir(parentDir, { recursive: true });
              logger.info('[SMART-FOLDERS] Created parent directory:', parentDir);
            } catch (mkdirError) {
              return {
                success: false,
                error: `Failed to create parent directory "${parentDir}": ${mkdirError.message}`,
                errorCode: ERROR_CODES.PARENT_NOT_ACCESSIBLE
              };
            }
          } else {
            return {
              success: false,
              error: `Cannot access parent directory "${parentDir}": ${parentError.message}`,
              errorCode: ERROR_CODES.PARENT_NOT_ACCESSIBLE
            };
          }
        }

        // Test write permission in parent directory
        const tempFile = path.join(parentDir, `.stratotest_${Date.now()}`);
        try {
          await fs.writeFile(tempFile, 'test');
          await fs.unlink(tempFile);
        } catch {
          return {
            success: false,
            error: `No write permission in parent directory "${parentDir}"`,
            errorCode: ERROR_CODES.PARENT_NOT_WRITABLE
          };
        }

        let llmEnhancedData = {};
        try {
          const llmAnalysis = await enhanceSmartFolderWithLLM(
            folder,
            customFolders,
            getOllamaModel
          );
          if (llmAnalysis && !llmEnhancedData.error) llmEnhancedData = llmAnalysis;
        } catch (e) {
          logger.warn(
            '[SMART-FOLDERS] LLM enhancement failed, continuing with basic data:',
            e.message
          );
        }

        const newFolder = {
          id: Date.now().toString(),
          name: sanitizedName,
          path: normalizedPath,
          description:
            llmEnhancedData.enhancedDescription ||
            folder.description?.trim() ||
            `Smart folder for ${sanitizedName}`,
          keywords: llmEnhancedData.suggestedKeywords || [],
          category: llmEnhancedData.suggestedCategory || 'general',
          isDefault: folder.isDefault || false,
          createdAt: new Date().toISOString(),
          semanticTags: llmEnhancedData.semanticTags || [],
          relatedFolders: llmEnhancedData.relatedFolders || [],
          confidenceScore: llmEnhancedData.confidence || 0.8,
          usageCount: 0,
          lastUsed: null
        };

        let directoryCreated = false;
        let directoryExisted = false;
        try {
          const existingStats = await fs.stat(normalizedPath);
          if (existingStats.isDirectory()) {
            directoryExisted = true;
          } else {
            return {
              success: false,
              error: 'Path exists but is not a directory',
              errorCode: ERROR_CODES.PATH_NOT_DIRECTORY
            };
          }
        } catch (statError) {
          if (statError.code === 'ENOENT') {
            try {
              await fs.mkdir(normalizedPath, { recursive: true });
              const stats = await fs.stat(normalizedPath);
              if (!stats.isDirectory()) throw new Error('Created path is not a directory');
              directoryCreated = true;
            } catch (dirError) {
              return {
                success: false,
                error: 'Failed to create directory',
                errorCode: ERROR_CODES.DIRECTORY_CREATION_FAILED,
                details: dirError.message
              };
            }
          } else {
            return {
              success: false,
              error: 'Failed to access directory path',
              errorCode: ERROR_CODES.PATH_ACCESS_FAILED,
              details: statError.message
            };
          }
        }

        const originalFolders = [...customFolders];
        try {
          customFolders.push(newFolder);
          setCustomFolders(customFolders);
          await saveCustomFolders(customFolders);
          logger.info(
            '[SMART-FOLDERS] Added folder:',
            newFolder.id,
            'Directory created:',
            directoryCreated,
            'Existed:',
            directoryExisted
          );
          return {
            success: true,
            folder: newFolder,
            folders: customFolders,
            message: directoryCreated
              ? 'Smart folder created successfully'
              : 'Smart folder added (directory already existed)',
            directoryCreated,
            directoryExisted,
            llmEnhanced: !!llmEnhancedData.enhancedDescription
          };
        } catch (saveError) {
          setCustomFolders(originalFolders);
          if (directoryCreated && !directoryExisted) {
            try {
              await fs.rm(normalizedPath, { recursive: true, force: true });
            } catch {
              // Non-fatal if rollback cleanup fails
            }
          }
          return {
            success: false,
            error: 'Failed to save configuration, changes rolled back',
            errorCode: ERROR_CODES.CONFIG_SAVE_FAILED,
            details: saveError.message
          };
        }
      } catch (error) {
        logger.error('[ERROR] Failed to add smart folder:', error);
        return {
          success: false,
          error: 'Failed to add smart folder',
          errorCode: ERROR_CODES.ADD_FOLDER_FAILED,
          details: error.message
        };
      }
    })
  );

  // Scan folder structure
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.SCAN_STRUCTURE,
    withErrorLogging(logger, async (event, rootPath) => {
      try {
        // CRITICAL SECURITY FIX: Sanitize path to prevent directory traversal
        let sanitizedPath;
        try {
          sanitizedPath = sanitizeFolderPath(rootPath);
        } catch (securityError) {
          return {
            success: false,
            error: securityError.message,
            errorCode: ERROR_CODES.SECURITY_PATH_VIOLATION
          };
        }

        logger.info('[FOLDER-SCAN] Scanning folder structure:', sanitizedPath);
        // Reuse existing scanner (shallow aggregation is done in renderer today)
        const items = await scanDirectory(sanitizedPath);
        // Flatten file-like items with basic filtering similar to prior inline implementation
        const flatten = (nodes) => {
          const out = [];
          for (const n of nodes) {
            if (n.type === 'file')
              out.push({
                name: n.name,
                path: n.path,
                type: 'file',
                size: n.size
              });
            if (Array.isArray(n.children)) out.push(...flatten(n.children));
          }
          return out;
        };
        const files = flatten(items);
        logger.info('[FOLDER-SCAN] Found', files.length, 'supported files');
        return { success: true, files };
      } catch (error) {
        logger.error('[FOLDER-SCAN] Error scanning folder structure:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Reset smart folders to defaults
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.RESET_TO_DEFAULTS,
    withErrorLogging(logger, async () => {
      try {
        logger.info('[SMART-FOLDERS] Resetting to default smart folders');
        const { resetToDefaultFolders } = require('../core/customFolders');
        const defaultFolders = await resetToDefaultFolders();
        setCustomFolders(defaultFolders);
        logger.info('[SMART-FOLDERS] Reset complete, created', defaultFolders.length, 'folders');
        return {
          success: true,
          folders: defaultFolders,
          message: `Reset to ${defaultFolders.length} default smart folders`
        };
      } catch (error) {
        logger.error('[ERROR] Failed to reset smart folders:', error);
        return {
          success: false,
          error: error.message,
          errorCode: ERROR_CODES.RESET_FAILED
        };
      }
    })
  );

  // ============== Smart Folder Watcher IPC Handlers ==============

  // Start the smart folder watcher
  // Note: Smart folder watching is always enabled - this is mainly used for restart/recovery
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.WATCHER_START,
    withErrorLogging(logger, async () => {
      try {
        const smartFolderWatcher = getSmartFolderWatcher?.();
        if (!smartFolderWatcher) {
          return {
            success: false,
            error: 'Smart folder watcher not available'
          };
        }

        const started = await smartFolderWatcher.start();
        const status = smartFolderWatcher.getStatus();

        let errorMessage = null;
        if (!started) {
          errorMessage = status.lastStartError || 'Failed to start watcher (unknown reason)';
          logger.warn('[SMART-FOLDER-WATCHER] Start returned false:', errorMessage);
        }

        return {
          success: started,
          message: started ? 'Smart folder watcher started' : errorMessage,
          error: errorMessage,
          status
        };
      } catch (error) {
        logger.error('[SMART-FOLDER-WATCHER] Failed to start:', error);
        return {
          success: false,
          error: error.message
        };
      }
    })
  );

  // Stop the smart folder watcher
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.WATCHER_STOP,
    withErrorLogging(logger, async () => {
      try {
        // FIX: Call getter function to get current watcher instance
        const smartFolderWatcher = getSmartFolderWatcher?.();
        if (!smartFolderWatcher) {
          return {
            success: false,
            error: 'Smart folder watcher not available'
          };
        }

        smartFolderWatcher.stop();
        return {
          success: true,
          message: 'Smart folder watcher stopped',
          status: smartFolderWatcher.getStatus()
        };
      } catch (error) {
        logger.error('[SMART-FOLDER-WATCHER] Failed to stop:', error);
        return {
          success: false,
          error: error.message
        };
      }
    })
  );

  // Get watcher status
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.WATCHER_STATUS,
    withErrorLogging(logger, async () => {
      try {
        // FIX: Call getter function to get current watcher instance
        const smartFolderWatcher = getSmartFolderWatcher?.();
        if (!smartFolderWatcher) {
          return {
            success: true,
            status: {
              isRunning: false,
              isStarting: false,
              watchedFolders: [],
              watchedCount: 0,
              queueLength: 0,
              processingCount: 0,
              available: false
            }
          };
        }

        return {
          success: true,
          status: {
            ...smartFolderWatcher.getStatus(),
            available: true
          }
        };
      } catch (error) {
        logger.error('[SMART-FOLDER-WATCHER] Failed to get status:', error);
        return {
          success: false,
          error: error.message
        };
      }
    })
  );

  // Manually trigger a scan for unanalyzed files
  safeHandle(
    ipcMain,
    IPC_CHANNELS.SMART_FOLDERS.WATCHER_SCAN,
    withErrorLogging(logger, async () => {
      try {
        // FIX: Call getter function to get current watcher instance
        const smartFolderWatcher = getSmartFolderWatcher?.();
        if (!smartFolderWatcher) {
          return {
            success: false,
            error: 'Smart folder watcher not available'
          };
        }

        if (!smartFolderWatcher.isRunning) {
          return {
            success: false,
            error:
              'Watcher is not running. Please wait for it to start or check if smart folders are configured.'
          };
        }

        const result = await smartFolderWatcher.scanForUnanalyzedFiles();
        return {
          success: true,
          ...result,
          message: `Scanned ${result.scanned} files, queued ${result.queued} for analysis`
        };
      } catch (error) {
        logger.error('[SMART-FOLDER-WATCHER] Failed to scan:', error);
        return {
          success: false,
          error: error.message
        };
      }
    })
  );
}

module.exports = registerSmartFoldersIpc;
