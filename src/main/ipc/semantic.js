const { getInstance: getChromaDB } = require('../services/ChromaDBService');
const FolderMatchingService = require('../services/FolderMatchingService');
const path = require('path');
const { SUPPORTED_IMAGE_EXTENSIONS } = require('../../shared/constants');
const { withErrorLogging } = require('./withErrorLogging');

function registerEmbeddingsIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  getCustomFolders,
  getServiceIntegration,
}) {
  // Use ChromaDB singleton instance
  const chromaDbService = getChromaDB();
  const folderMatcher = new FolderMatchingService(chromaDbService);

  // Initialize ChromaDB and migrate existing data on startup
  (async () => {
    try {
      await chromaDbService.initialize();

      // Fixed: Initialize FolderMatchingService after ChromaDB is ready
      folderMatcher.initialize();

      // Attempt to migrate existing JSONL data if present
      const { app } = require('electron');
      const basePath = path.join(app.getPath('userData'), 'embeddings');
      const filesPath = path.join(basePath, 'file-embeddings.jsonl');
      const foldersPath = path.join(basePath, 'folder-embeddings.jsonl');

      const filesMigrated = await chromaDbService.migrateFromJsonl(
        filesPath,
        'file',
      );
      const foldersMigrated = await chromaDbService.migrateFromJsonl(
        foldersPath,
        'folder',
      );

      if (filesMigrated > 0 || foldersMigrated > 0) {
        logger.info('[ChromaDB] Migration complete', {
          files: filesMigrated,
          folders: foldersMigrated,
        });
      }
    } catch (error) {
      logger.error('[ChromaDB] Initialization/migration failed:', error);
    }
  })();

  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FOLDERS,
    withErrorLogging(logger, async () => {
      try {
        const smartFolders = getCustomFolders().filter((f) => f && f.name);
        await chromaDbService.resetFolders();

        // Optimization: Batch process folder embeddings
        const folderPayloads = await Promise.all(
          smartFolders.map(async (folder) => {
            try {
              const folderText = [folder.name, folder.description]
                .filter(Boolean)
                .join(' - ');

              const { vector, model } =
                await folderMatcher.embedText(folderText);
              const folderId =
                folder.id || folderMatcher.generateFolderId(folder);

              return {
                id: folderId,
                name: folder.name,
                description: folder.description || '',
                path: folder.path || '',
                vector,
                model,
                updatedAt: new Date().toISOString(),
              };
            } catch (error) {
              logger.warn(
                '[EMBEDDINGS] Failed to generate folder embedding:',
                folder.name,
                error.message,
              );
              return null;
            }
          }),
        );

        const validPayloads = folderPayloads.filter((p) => p !== null);

        // Optimization: Use batch upsert instead of individual operations
        const count = await chromaDbService.batchUpsertFolders(validPayloads);

        return { success: true, folders: count };
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild folders failed:', e);
        return { success: false, error: e.message };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.REBUILD_FILES,
    withErrorLogging(logger, async () => {
      try {
        const serviceIntegration =
          getServiceIntegration && getServiceIntegration();
        const historyService = serviceIntegration?.analysisHistory;

        if (!historyService?.getRecentAnalysis) {
          return {
            success: false,
            error: 'Analysis history service unavailable',
          };
        }

        // Load all history entries (bounded by service defaults if any)
        const allEntries = await historyService.getRecentAnalysis(
          Number.MAX_SAFE_INTEGER,
        );

        const smartFolders = (
          typeof getCustomFolders === 'function' ? getCustomFolders() : []
        ).filter((f) => f && f.name);

        // Optimization: Batch process folder embeddings
        if (smartFolders.length > 0) {
          const folderPayloads = await Promise.all(
            smartFolders.map(async (folder) => {
              try {
                const folderText = [folder.name, folder.description]
                  .filter(Boolean)
                  .join(' - ');

                const { vector, model } =
                  await folderMatcher.embedText(folderText);
                const folderId =
                  folder.id || folderMatcher.generateFolderId(folder);

                return {
                  id: folderId,
                  name: folder.name,
                  description: folder.description || '',
                  path: folder.path || '',
                  vector,
                  model,
                  updatedAt: new Date().toISOString(),
                };
              } catch (error) {
                logger.warn(
                  '[EMBEDDINGS] Failed to generate folder embedding:',
                  folder.name,
                );
                return null;
              }
            }),
          );

          const validFolderPayloads = folderPayloads.filter((p) => p !== null);
          await chromaDbService.batchUpsertFolders(validFolderPayloads);
        }

        // Reset file vectors to rebuild from scratch
        await chromaDbService.resetFiles();

        // Optimization: Batch process file embeddings
        const filePayloads = [];
        for (const entry of allEntries) {
          try {
            const filePath = entry.originalPath;
            const ext = (path.extname(filePath) || '').toLowerCase();
            const isImage = SUPPORTED_IMAGE_EXTENSIONS.includes(ext);
            const fileId = `${isImage ? 'image' : 'file'}:${filePath}`;

            const summary = [
              entry.analysis?.subject,
              entry.analysis?.summary,
              Array.isArray(entry.analysis?.tags)
                ? entry.analysis.tags.join(' ')
                : '',
              entry.analysis?.extractedText
                ? String(entry.analysis.extractedText).slice(0, 2000)
                : '',
            ]
              .filter(Boolean)
              .join('\n');

            // Generate embedding
            const { vector, model } = await folderMatcher.embedText(summary);

            filePayloads.push({
              id: fileId,
              vector,
              model,
              meta: {
                path: filePath,
                name: path.basename(filePath),
                type: isImage ? 'image' : 'document',
              },
              updatedAt: new Date().toISOString(),
            });
          } catch (e) {
            logger.warn(
              '[EMBEDDINGS] Failed to prepare file entry:',
              e.message,
            );
            // continue on individual entry failure
          }
        }

        // Optimization: Batch upsert all files at once (in chunks for large datasets)
        const BATCH_SIZE = 50; // Process in chunks of 50
        let rebuilt = 0;
        for (let i = 0; i < filePayloads.length; i += BATCH_SIZE) {
          const batch = filePayloads.slice(i, i + BATCH_SIZE);
          try {
            const count = await chromaDbService.batchUpsertFiles(batch);
            rebuilt += count;
          } catch (e) {
            logger.warn(
              '[EMBEDDINGS] Failed to batch upsert files:',
              e.message,
            );
          }
        }

        return { success: true, files: rebuilt };
      } catch (e) {
        logger.error('[EMBEDDINGS] Rebuild files failed:', e);
        return { success: false, error: e.message };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.CLEAR_STORE,
    withErrorLogging(logger, async () => {
      try {
        await chromaDbService.resetAll();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );

  // New endpoint for getting vector DB statistics
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.GET_STATS,
    withErrorLogging(logger, async () => {
      try {
        const stats = await chromaDbService.getStats();
        return { success: true, ...stats };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }),
  );

  // New endpoint for finding similar documents
  ipcMain.handle(
    IPC_CHANNELS.EMBEDDINGS.FIND_SIMILAR,
    withErrorLogging(logger, async (event, { fileId, topK = 10 }) => {
      try {
        if (!fileId) {
          return { success: false, error: 'File ID is required' };
        }

        const similarFiles = await folderMatcher.findSimilarFiles(fileId, topK);
        return { success: true, results: similarFiles };
      } catch (e) {
        logger.error('[EMBEDDINGS] Find similar failed:', e);
        return { success: false, error: e.message };
      }
    }),
  );

  // Cleanup on app quit
  const { app } = require('electron');
  app.on('before-quit', async () => {
    try {
      await chromaDbService.cleanup();
    } catch (error) {
      logger.error('[ChromaDB] Cleanup error:', error);
    }
  });
}

module.exports = registerEmbeddingsIpc;
