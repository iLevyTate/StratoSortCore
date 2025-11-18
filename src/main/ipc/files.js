const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { app } = require('electron');
const {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_ARCHIVE_EXTENSIONS,
  ACTION_TYPES,
} = require('../../shared/constants');
const { withErrorLogging, withValidation } = require('./withErrorLogging');
let z;
try {
  z = require('zod');
} catch {
  z = null;
}

// Helper function to compute file checksum for verification
async function computeFileChecksum(filePath) {
  const hash = crypto.createHash('sha256');
  const fileBuffer = await fs.readFile(filePath);
  hash.update(fileBuffer);
  return hash.digest('hex');
}

function registerFilesIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  dialog,
  shell,
  getMainWindow,
  getServiceIntegration,
}) {
  const stringSchema = z ? z.string().min(1) : null;
  const opSchema = z
    ? z.object({
        type: z.enum(['move', 'copy', 'delete', 'batch_organize']),
        source: z.string().optional(),
        destination: z.string().optional(),
        operations: z
          .array(
            z.object({
              source: z.string(),
              destination: z.string(),
              type: z.string().optional(),
            }),
          )
          .optional(),
      })
    : null;
  // Select files (and folders scanned shallowly)
  ipcMain.handle(
    IPC_CHANNELS.FILES.SELECT,
    withErrorLogging(logger, async () => {
      logger.info(
        '[MAIN-FILE-SELECT] ===== FILE SELECTION HANDLER CALLED =====',
      );
      const mainWindow = getMainWindow();
      logger.info('[MAIN-FILE-SELECT] mainWindow exists?', !!mainWindow);
      logger.info(
        '[MAIN-FILE-SELECT] mainWindow visible?',
        mainWindow?.isVisible(),
      );
      logger.info(
        '[MAIN-FILE-SELECT] mainWindow focused?',
        mainWindow?.isFocused(),
      );
      try {
        if (mainWindow && !mainWindow.isFocused()) {
          logger.info('[MAIN-FILE-SELECT] Focusing window before dialog...');
          mainWindow.focus();
        }
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          if (!mainWindow.isVisible()) mainWindow.show();
          if (!mainWindow.isFocused()) mainWindow.focus();
          await new Promise((resolve) => {
            const t = setTimeout(resolve, 100);
            try {
              t.unref();
            } catch {
              // Non-fatal if timer is already cleared
            }
          });
        }
        const result = await dialog.showOpenDialog(mainWindow || null, {
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
          title: 'Select Files to Organize',
          buttonLabel: 'Select Files',
          filters: (() => {
            const stripDot = (exts) =>
              exts.map((e) => (e.startsWith('.') ? e.slice(1) : e));
            const docs = stripDot([
              ...SUPPORTED_DOCUMENT_EXTENSIONS,
              '.txt',
              '.md',
              '.rtf',
            ]);
            const images = stripDot(SUPPORTED_IMAGE_EXTENSIONS);
            const archives = stripDot(SUPPORTED_ARCHIVE_EXTENSIONS);
            const allSupported = Array.from(
              new Set([...docs, ...images, ...archives]),
            );
            return [
              { name: 'All Supported Files', extensions: allSupported },
              { name: 'Documents', extensions: docs },
              { name: 'Images', extensions: images },
              { name: 'Archives', extensions: archives },
              { name: 'All Files', extensions: ['*'] },
            ];
          })(),
        });
        logger.info('[MAIN-FILE-SELECT] Dialog closed, result:', result);
        if (result.canceled || !result.filePaths.length)
          return { success: false, files: [] };
        logger.info(
          `[FILE-SELECTION] Selected ${result.filePaths.length} items`,
        );
        const allFiles = [];
        const supportedExts = Array.from(
          new Set([
            ...SUPPORTED_DOCUMENT_EXTENSIONS,
            ...SUPPORTED_IMAGE_EXTENSIONS,
            ...SUPPORTED_ARCHIVE_EXTENSIONS,
            '.txt',
            '.md',
            '.rtf',
          ]),
        );
        const scanFolder = async (folderPath, depth = 0, maxDepth = 3) => {
          if (depth > maxDepth) return [];
          try {
            const items = await fs.readdir(folderPath, { withFileTypes: true });
            const foundFiles = [];
            for (const item of items) {
              const itemPath = path.join(folderPath, item.name);
              if (item.isFile()) {
                const ext = path.extname(item.name).toLowerCase();
                if (supportedExts.includes(ext)) foundFiles.push(itemPath);
              } else if (
                item.isDirectory() &&
                !item.name.startsWith('.') &&
                !item.name.startsWith('node_modules')
              ) {
                const subFiles = await scanFolder(
                  itemPath,
                  depth + 1,
                  maxDepth,
                );
                foundFiles.push(...subFiles);
              }
            }
            return foundFiles;
          } catch (error) {
            logger.warn(
              `[FILE-SELECTION] Error scanning folder ${folderPath}:`,
              error.message,
            );
            return [];
          }
        };
        for (const selectedPath of result.filePaths) {
          try {
            const stats = await fs.stat(selectedPath);
            if (stats.isFile()) {
              const ext = path.extname(selectedPath).toLowerCase();
              if (supportedExts.includes(ext)) {
                allFiles.push(selectedPath);
                logger.info(
                  `[FILE-SELECTION] Added file: ${path.basename(selectedPath)}`,
                );
              }
            } else if (stats.isDirectory()) {
              logger.info(`[FILE-SELECTION] Scanning folder: ${selectedPath}`);
              const folderFiles = await scanFolder(selectedPath);
              allFiles.push(...folderFiles);
              logger.info(
                `[FILE-SELECTION] Found ${folderFiles.length} files in folder: ${path.basename(selectedPath)}`,
              );
            }
          } catch (error) {
            logger.warn(
              `[FILE-SELECTION] Error processing ${selectedPath}:`,
              error.message,
            );
          }
        }
        const uniqueFiles = [...new Set(allFiles)];
        logger.info(
          `[FILE-SELECTION] Total files collected: ${uniqueFiles.length} (${allFiles.length - uniqueFiles.length} duplicates removed)`,
        );
        return {
          success: true,
          files: uniqueFiles,
          summary: {
            totalSelected: result.filePaths.length,
            filesFound: uniqueFiles.length,
            duplicatesRemoved: allFiles.length - uniqueFiles.length,
          },
        };
      } catch (error) {
        logger.error('[MAIN-FILE-SELECT] Failed to select files:', error);
        return { success: false, error: error.message, files: [] };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES.SELECT_DIRECTORY,
    withErrorLogging(logger, async () => {
      try {
        const result = await dialog.showOpenDialog(getMainWindow() || null, {
          properties: ['openDirectory', 'dontAddToRecent'],
          title: 'Select Directory to Scan',
          buttonLabel: 'Select Directory',
        });
        if (result.canceled || !result.filePaths.length)
          return { success: false, folder: null };
        return { success: true, folder: result.filePaths[0] };
      } catch (error) {
        logger.error('[IPC] Directory selection failed:', error);
        return { success: false, folder: null, error: error.message };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES.GET_DOCUMENTS_PATH,
    withErrorLogging(logger, async () => {
      try {
        return app.getPath('documents');
      } catch (error) {
        logger.error('Failed to get documents path:', error);
        return null;
      }
    }),
  );

  const getFileStatsHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, async (event, filePath) => {
          try {
            const stats = await fs.stat(filePath);
            return {
              size: stats.size,
              isDirectory: stats.isDirectory(),
              isFile: stats.isFile(),
              modified: stats.mtime,
              created: stats.birthtime,
            };
          } catch (error) {
            logger.error('Failed to get file stats:', error);
            return null;
          }
        })
      : withErrorLogging(logger, async (event, filePath) => {
          try {
            const stats = await fs.stat(filePath);
            return {
              size: stats.size,
              isDirectory: stats.isDirectory(),
              isFile: stats.isFile(),
              modified: stats.mtime,
              created: stats.birthtime,
            };
          } catch (error) {
            logger.error('Failed to get file stats:', error);
            return null;
          }
        });
  ipcMain.handle(IPC_CHANNELS.FILES.GET_FILE_STATS, getFileStatsHandler);
  const createFolderDirectHandler =
    z && stringSchema
      ? withValidation(logger, stringSchema, async (event, fullPath) => {
          try {
            const normalizedPath = path.resolve(fullPath);
            try {
              const stats = await fs.stat(normalizedPath);
              if (stats.isDirectory()) {
                logger.info(
                  '[FILE-OPS] Folder already exists:',
                  normalizedPath,
                );
                return { success: true, path: normalizedPath, existed: true };
              }
            } catch {
              // Folder does not exist, proceed to create
            }
            await fs.mkdir(normalizedPath, { recursive: true });
            logger.info('[FILE-OPS] Created folder:', normalizedPath);
            return { success: true, path: normalizedPath, existed: false };
          } catch (error) {
            logger.error('[FILE-OPS] Error creating folder:', error);
            let userMessage = 'Failed to create folder';
            if (error.code === 'EACCES' || error.code === 'EPERM')
              userMessage = 'Permission denied - check folder permissions';
            else if (error.code === 'ENOTDIR')
              userMessage = 'Invalid path - parent is not a directory';
            else if (error.code === 'EEXIST')
              userMessage = 'Folder already exists';
            return {
              success: false,
              error: userMessage,
              details: error.message,
              code: error.code,
            };
          }
        })
      : withErrorLogging(logger, async (event, fullPath) => {
          try {
            const normalizedPath = path.resolve(fullPath);
            await fs.mkdir(normalizedPath, { recursive: true });
            logger.info('[FILE-OPS] Created folder:', normalizedPath);
            return { success: true, path: normalizedPath, existed: false };
          } catch (error) {
            logger.error('[FILE-OPS] Error creating folder:', error);
            let userMessage = 'Failed to create folder';
            if (error.code === 'EACCES' || error.code === 'EPERM')
              userMessage = 'Permission denied - check folder permissions';
            else if (error.code === 'ENOTDIR')
              userMessage = 'Invalid path - parent is not a directory';
            else if (error.code === 'EEXIST')
              userMessage = 'Folder already exists';
            return {
              success: false,
              error: userMessage,
              details: error.message,
              code: error.code,
            };
          }
        });
  ipcMain.handle(
    IPC_CHANNELS.FILES.CREATE_FOLDER_DIRECT,
    createFolderDirectHandler,
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES.GET_FILES_IN_DIRECTORY,
    withErrorLogging(logger, async (event, dirPath) => {
      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        const result = items.map((item) => ({
          name: item.name,
          path: path.join(dirPath, item.name),
          isDirectory: item.isDirectory(),
          isFile: item.isFile(),
        }));
        logger.info(
          '[FILE-OPS] Listed directory contents:',
          dirPath,
          result.length,
          'items',
        );
        return result;
      } catch (error) {
        logger.error('[FILE-OPS] Error reading directory:', error);
        return { error: error.message };
      }
    }),
  );

  const performOperationHandler =
    z && opSchema
      ? withValidation(logger, opSchema, async (event, operation) => {
          try {
            logger.info('[FILE-OPS] Performing operation:', operation.type);
            logger.info(
              '[FILE-OPS] Operation details:',
              JSON.stringify(operation, null, 2),
            );
            switch (operation.type) {
              case 'move':
                await fs.rename(operation.source, operation.destination);
                try {
                  await getServiceIntegration()?.undoRedo?.recordAction?.(
                    ACTION_TYPES.FILE_MOVE,
                    {
                      originalPath: operation.source,
                      newPath: operation.destination,
                    },
                  );
                } catch {
                  // Non-fatal if undo recording fails
                }
                return {
                  success: true,
                  message: `Moved ${operation.source} to ${operation.destination}`,
                };
              case 'copy':
                await fs.copyFile(operation.source, operation.destination);
                return {
                  success: true,
                  message: `Copied ${operation.source} to ${operation.destination}`,
                };
              case 'delete':
                await fs.unlink(operation.source);
                return {
                  success: true,
                  message: `Deleted ${operation.source}`,
                };
              case 'batch_organize': {
                // CRITICAL FIX (BUG #3): Transaction-like rollback mechanism for batch operations
                // Previous code had no rollback on partial failures, leaving files scattered
                // Now we track all completed operations and can rollback on critical failures
                const results = [];
                const completedOperations = []; // Track for rollback
                let successCount = 0;
                let failCount = 0;
                const batchId = `batch_${Date.now()}`;
                let shouldRollback = false;
                let rollbackReason = null;

                try {
                  const svc = getServiceIntegration();
                  const batch =
                    await svc?.processingState?.createOrLoadOrganizeBatch(
                      batchId,
                      operation.operations,
                    );

                  logger.info(
                    `[FILE-OPS] Starting batch operation ${batchId} with ${batch.operations.length} files`,
                  );

                  for (let i = 0; i < batch.operations.length; i += 1) {
                    const op = batch.operations[i];
                    if (op.status === 'done') {
                      results.push({
                        success: true,
                        source: op.source,
                        destination: op.destination,
                        operation: op.type || 'move',
                        resumed: true,
                      });
                      successCount++;
                      continue;
                    }
                    try {
                      await getServiceIntegration()?.processingState?.markOrganizeOpStarted(
                        batchId,
                        i,
                      );
                      if (!op.source || !op.destination)
                        throw new Error(
                          `Invalid operation data: source="${op.source}", destination="${op.destination}"`,
                        );
                      const destDir = path.dirname(op.destination);
                      await fs.mkdir(destDir, { recursive: true });
                      try {
                        await fs.access(op.source);
                      } catch {
                        throw new Error(
                          `Source file does not exist: ${op.source}`,
                        );
                      }

                      // BUG FIX #9: Improved collision handling with UUID fallback
                      // CRITICAL: 1000 collisions throws error, causing organization to fail
                      // Solution: Increase limit, add UUID fallback, better error handling
                      let counter = 0;
                      let uniqueDestination = op.destination;
                      const ext = path.extname(op.destination);
                      const baseName = op.destination.slice(0, -ext.length);
                      let operationComplete = false;
                      const maxNumericRetries = 5000; // Increased from 1000 to 5000

                      while (
                        !operationComplete &&
                        counter < maxNumericRetries
                      ) {
                        try {
                          // Attempt atomic rename first
                          await fs.rename(op.source, uniqueDestination);
                          operationComplete = true;
                          op.destination = uniqueDestination;
                        } catch (renameError) {
                          if (renameError.code === 'EEXIST') {
                            // Destination exists, try next filename atomically
                            counter++;
                            uniqueDestination = `${baseName}_${counter}${ext}`;
                            continue; // Retry with new name
                          } else if (renameError.code === 'EXDEV') {
                            // Cross-device move: use atomic copy with COPYFILE_EXCL
                            // NOTE: There's still a small TOCTOU window between copy and verification,
                            // but this is the best we can do without OS-level file locking
                            try {
                              // Step 1: Atomic copy (fails if destination exists)
                              await fs.copyFile(
                                op.source,
                                uniqueDestination,
                                fs.constants.COPYFILE_EXCL,
                              );

                              // Step 2: Verify file copy integrity immediately after copy
                              // Fixed: Get stats in parallel to minimize TOCTOU window
                              let sourceStats, destStats;
                              try {
                                [sourceStats, destStats] = await Promise.all([
                                  fs.stat(op.source),
                                  fs.stat(uniqueDestination),
                                ]);
                              } catch (error) {
                                // Clean up the copied file if verification fails
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                throw new Error(
                                  `File verification failed: ${error.message}`,
                                );
                              }

                              // CRITICAL: Verify file size matches before proceeding
                              if (sourceStats.size !== destStats.size) {
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                throw new Error(
                                  `File copy verification failed - size mismatch (source: ${sourceStats.size} bytes, dest: ${destStats.size} bytes)`,
                                );
                              }

                              // CRITICAL FIX (BUG #1): Always verify checksum for ALL files to prevent silent corruption
                              // Previous code only verified files >10MB, leaving smaller files vulnerable
                              // Performance trade-off: slower operations but guaranteed data integrity
                              logger.info(
                                `[FILE-OPS] Verifying file copy integrity with checksum: ${path.basename(op.source)} (${sourceStats.size} bytes)`,
                              );

                              let sourceChecksum, destChecksum;
                              try {
                                [sourceChecksum, destChecksum] =
                                  await Promise.all([
                                    computeFileChecksum(op.source),
                                    computeFileChecksum(uniqueDestination),
                                  ]);
                              } catch (checksumError) {
                                // Clean up destination if checksum computation fails
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                throw new Error(
                                  `Checksum computation failed: ${checksumError.message}`,
                                );
                              }

                              if (sourceChecksum !== destChecksum) {
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                logger.error(
                                  `[FILE-OPS] Checksum mismatch detected - possible data corruption or TOCTOU race condition`,
                                  {
                                    source: op.source,
                                    destination: uniqueDestination,
                                    sourceChecksum,
                                    destChecksum,
                                  },
                                );
                                throw new Error(
                                  `File copy verification failed - checksum mismatch (source: ${sourceChecksum.substring(0, 8)}..., dest: ${destChecksum.substring(0, 8)}...)`,
                                );
                              }

                              logger.info(
                                `[FILE-OPS] File copy verified successfully: ${path.basename(op.source)} (checksum: ${sourceChecksum.substring(0, 16)}...)`,
                              );

                              // Step 3: Delete source (safe because destination verified)
                              // Fixed: Handle case where source was already deleted
                              try {
                                await fs.unlink(op.source);
                              } catch (unlinkError) {
                                if (unlinkError.code !== 'ENOENT') {
                                  // Source exists but can't delete - this is an error
                                  // Clean up destination and throw
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `Failed to delete source after copy: ${unlinkError.message}`,
                                  );
                                }
                                // ENOENT is fine - source was already deleted by another process
                              }

                              operationComplete = true;
                              op.destination = uniqueDestination;
                            } catch (copyError) {
                              if (copyError.code === 'EEXIST') {
                                // Destination exists, try next filename
                                counter++;
                                uniqueDestination = `${baseName}_${counter}${ext}`;
                                continue; // Retry with new name
                              } else {
                                throw copyError;
                              }
                            }
                          } else {
                            throw renameError;
                          }
                        }
                      }

                      // BUG FIX #9: UUID fallback if numeric counter exhausted
                      if (!operationComplete) {
                        // Try UUID-based naming as fallback
                        logger.warn(
                          `[FILE-OPS] Exhausted ${maxNumericRetries} numeric attempts for ${path.basename(op.source)}, falling back to UUID`,
                        );

                        const uuidAttempts = 3; // Try 3 UUID-based names
                        for (
                          let uuidTry = 0;
                          uuidTry < uuidAttempts && !operationComplete;
                          uuidTry++
                        ) {
                          // Generate UUID v4 (random) for guaranteed uniqueness
                          const uuid = require('crypto').randomUUID();
                          // Use first 8 chars of UUID for shorter filename
                          const uuidShort = uuid.split('-')[0];
                          uniqueDestination = `${baseName}_${uuidShort}${ext}`;

                          try {
                            // Try atomic rename with UUID name
                            await fs.rename(op.source, uniqueDestination);
                            operationComplete = true;
                            op.destination = uniqueDestination;
                            logger.info(
                              `[FILE-OPS] Successfully used UUID fallback: ${path.basename(uniqueDestination)}`,
                            );
                          } catch (uuidRenameError) {
                            if (uuidRenameError.code === 'EEXIST') {
                              // Incredibly unlikely, but UUID collision occurred
                              logger.warn(
                                `[FILE-OPS] UUID collision (try ${uuidTry + 1}/${uuidAttempts}): ${uuidShort}`,
                              );
                              continue; // Try another UUID
                            } else if (uuidRenameError.code === 'EXDEV') {
                              // Cross-device move with UUID name - use same verified copy logic
                              try {
                                await fs.copyFile(
                                  op.source,
                                  uniqueDestination,
                                  fs.constants.COPYFILE_EXCL,
                                );

                                let sourceStats, destStats;
                                try {
                                  [sourceStats, destStats] = await Promise.all([
                                    fs.stat(op.source),
                                    fs.stat(uniqueDestination),
                                  ]);
                                } catch (statError) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `File verification failed: ${statError.message}`,
                                  );
                                }

                                if (sourceStats.size !== destStats.size) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `File copy verification failed - size mismatch`,
                                  );
                                }

                                // Always verify checksum
                                logger.info(
                                  `[FILE-OPS] Verifying UUID fallback copy with checksum: ${path.basename(op.source)}`,
                                );
                                let sourceChecksum, destChecksum;
                                try {
                                  [sourceChecksum, destChecksum] =
                                    await Promise.all([
                                      computeFileChecksum(op.source),
                                      computeFileChecksum(uniqueDestination),
                                    ]);
                                } catch (checksumError) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `Checksum computation failed: ${checksumError.message}`,
                                  );
                                }

                                if (sourceChecksum !== destChecksum) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `File copy verification failed - checksum mismatch`,
                                  );
                                }

                                // Delete source
                                try {
                                  await fs.unlink(op.source);
                                } catch (unlinkError) {
                                  if (unlinkError.code !== 'ENOENT') {
                                    await fs
                                      .unlink(uniqueDestination)
                                      .catch(() => {});
                                    throw new Error(
                                      `Failed to delete source after copy: ${unlinkError.message}`,
                                    );
                                  }
                                }

                                operationComplete = true;
                                op.destination = uniqueDestination;
                                logger.info(
                                  `[FILE-OPS] Successfully used UUID fallback for cross-device move`,
                                );
                              } catch (uuidCopyError) {
                                if (uuidCopyError.code === 'EEXIST') {
                                  continue; // Try another UUID
                                } else {
                                  throw uuidCopyError;
                                }
                              }
                            } else {
                              throw uuidRenameError;
                            }
                          }
                        }

                        // Final check: if still not complete after UUID attempts, fail with detailed error
                        if (!operationComplete) {
                          throw new Error(
                            `Failed to create unique destination after ${maxNumericRetries} numeric attempts and ${uuidAttempts} UUID attempts. ` +
                              `Source: ${op.source}, Destination pattern: ${baseName}*${ext}. ` +
                              `This indicates either extreme file collision or file system issue.`,
                          );
                        }
                      }
                      await getServiceIntegration()?.processingState?.markOrganizeOpDone(
                        batchId,
                        i,
                        { destination: op.destination },
                      );

                      // CRITICAL FIX (BUG #3): Track completed operation for potential rollback
                      completedOperations.push({
                        index: i,
                        source: op.source,
                        destination: op.destination,
                        originalDestination:
                          operation.operations[i].destination,
                      });

                      results.push({
                        success: true,
                        source: op.source,
                        destination: op.destination,
                        operation: op.type || 'move',
                      });
                      successCount++;
                      const win = getMainWindow();
                      if (win && !win.isDestroyed()) {
                        win.webContents.send('operation-progress', {
                          type: 'batch_organize',
                          current: i + 1,
                          total: batch.operations.length,
                          currentFile: path.basename(op.source),
                        });
                      }
                    } catch (error) {
                      await getServiceIntegration()?.processingState?.markOrganizeOpError(
                        batchId,
                        i,
                        error.message,
                      );

                      // CRITICAL FIX (BUG #3): Determine if this error should trigger rollback
                      // Critical errors (permissions, disk full, corruption) should rollback entire batch
                      // Non-critical errors (file already exists, file not found) can continue
                      const isCriticalError =
                        error.code === 'EACCES' || // Permission denied
                        error.code === 'EPERM' || // Operation not permitted
                        error.code === 'ENOSPC' || // No space left on device
                        error.code === 'EIO' || // I/O error (corruption)
                        error.message.includes('checksum mismatch') || // Data corruption
                        error.message.includes('verification failed'); // File integrity issue

                      if (isCriticalError) {
                        shouldRollback = true;
                        rollbackReason = `Critical error on file ${i + 1}/${batch.operations.length}: ${error.message}`;
                        logger.error(
                          `[FILE-OPS] Critical error in batch ${batchId}, will rollback ${completedOperations.length} completed operations`,
                          {
                            error: error.message,
                            errorCode: error.code,
                            file: op.source,
                            completedCount: completedOperations.length,
                          },
                        );
                      }

                      results.push({
                        success: false,
                        source: op.source,
                        destination: op.destination,
                        error: error.message,
                        operation: op.type || 'move',
                        critical: isCriticalError,
                      });
                      failCount++;

                      // Stop processing if critical error occurred
                      if (shouldRollback) {
                        break;
                      }
                    }
                  }
                  // CRITICAL FIX (BUG #3): Execute rollback if critical error occurred
                  if (shouldRollback && completedOperations.length > 0) {
                    logger.warn(
                      `[FILE-OPS] Executing rollback for batch ${batchId} due to: ${rollbackReason}`,
                    );

                    const rollbackResults = [];
                    let rollbackSuccessCount = 0;
                    let rollbackFailCount = 0;

                    // Rollback in reverse order (LIFO - Last In First Out)
                    for (const completedOp of [
                      ...completedOperations,
                    ].reverse()) {
                      try {
                        // Move file back to original source location
                        await fs.rename(
                          completedOp.destination,
                          completedOp.source,
                        );
                        rollbackSuccessCount++;
                        rollbackResults.push({
                          success: true,
                          file: completedOp.source,
                          message: 'Rolled back successfully',
                        });
                        logger.info(
                          `[FILE-OPS] Rolled back: ${completedOp.destination} -> ${completedOp.source}`,
                        );
                      } catch (rollbackError) {
                        rollbackFailCount++;
                        rollbackResults.push({
                          success: false,
                          file: completedOp.source,
                          destination: completedOp.destination,
                          error: rollbackError.message,
                        });
                        logger.error(
                          `[FILE-OPS] Failed to rollback ${completedOp.destination}:`,
                          rollbackError.message,
                        );
                      }
                    }

                    logger.warn(
                      `[FILE-OPS] Rollback complete for batch ${batchId}: ${rollbackSuccessCount} succeeded, ${rollbackFailCount} failed`,
                    );

                    // Return rollback results
                    return {
                      success: false,
                      rolledBack: true,
                      rollbackReason,
                      results,
                      rollbackResults,
                      successCount: 0, // All operations rolled back
                      failCount: failCount,
                      rollbackSuccessCount,
                      rollbackFailCount,
                      summary:
                        `Batch operation failed and was rolled back. Reason: ${rollbackReason}. ` +
                        `Rolled back ${rollbackSuccessCount}/${completedOperations.length} operations. ` +
                        `${rollbackFailCount > 0 ? `WARNING: ${rollbackFailCount} files could not be rolled back and may be in inconsistent state!` : ''}`,
                      batchId,
                      criticalError: true,
                    };
                  }

                  await getServiceIntegration()?.processingState?.completeOrganizeBatch(
                    batchId,
                  );

                  // Only record undo if batch completed successfully (no rollback)
                  if (!shouldRollback) {
                    try {
                      const undoOps = batch.operations.map((op) => ({
                        type: 'move',
                        originalPath: op.source,
                        newPath: op.destination,
                      }));
                      await getServiceIntegration()?.undoRedo?.recordAction?.(
                        ACTION_TYPES.BATCH_OPERATION,
                        { operations: undoOps },
                      );
                    } catch {
                      // Non-fatal if undo recording fails
                    }
                  }
                } catch {
                  // Non-fatal if batch processing service fails
                }

                return {
                  success: successCount > 0 && !shouldRollback,
                  results,
                  successCount,
                  failCount,
                  completedOperations: completedOperations.length,
                  summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
                  batchId,
                };
              }
              default:
                logger.error(
                  `[FILE-OPS] Unknown operation type: ${operation.type}`,
                );
                return {
                  success: false,
                  error: `Unknown operation type: ${operation.type}`,
                };
            }
          } catch (error) {
            logger.error('[FILE-OPS] Error performing operation:', error);
            return { success: false, error: error.message };
          }
        })
      : withErrorLogging(logger, async (event, operation) => {
          try {
            logger.info('[FILE-OPS] Performing operation:', operation.type);
            logger.info(
              '[FILE-OPS] Operation details:',
              JSON.stringify(operation, null, 2),
            );
            switch (operation.type) {
              case 'move':
                await fs.rename(operation.source, operation.destination);
                try {
                  await getServiceIntegration()?.undoRedo?.recordAction?.(
                    ACTION_TYPES.FILE_MOVE,
                    {
                      originalPath: operation.source,
                      newPath: operation.destination,
                    },
                  );
                } catch {
                  // Non-fatal if undo recording fails
                }
                return {
                  success: true,
                  message: `Moved ${operation.source} to ${operation.destination}`,
                };
              case 'copy':
                await fs.copyFile(operation.source, operation.destination);
                return {
                  success: true,
                  message: `Copied ${operation.source} to ${operation.destination}`,
                };
              case 'delete':
                await fs.unlink(operation.source);
                return {
                  success: true,
                  message: `Deleted ${operation.source}`,
                };
              case 'batch_organize': {
                // CRITICAL FIX (BUG #3): Transaction-like rollback mechanism for batch operations
                // Previous code had no rollback on partial failures, leaving files scattered
                // Now we track all completed operations and can rollback on critical failures
                const results = [];
                const completedOperations = []; // Track for rollback
                let successCount = 0;
                let failCount = 0;
                const batchId = `batch_${Date.now()}`;
                let shouldRollback = false;
                let rollbackReason = null;

                try {
                  const svc = getServiceIntegration();
                  const batch =
                    await svc?.processingState?.createOrLoadOrganizeBatch(
                      batchId,
                      operation.operations,
                    );

                  logger.info(
                    `[FILE-OPS] Starting batch operation ${batchId} with ${batch.operations.length} files`,
                  );

                  for (let i = 0; i < batch.operations.length; i += 1) {
                    const op = batch.operations[i];
                    if (op.status === 'done') {
                      results.push({
                        success: true,
                        source: op.source,
                        destination: op.destination,
                        operation: op.type || 'move',
                        resumed: true,
                      });
                      successCount++;
                      continue;
                    }
                    try {
                      await getServiceIntegration()?.processingState?.markOrganizeOpStarted(
                        batchId,
                        i,
                      );
                      if (!op.source || !op.destination)
                        throw new Error(
                          `Invalid operation data: source="${op.source}", destination="${op.destination}"`,
                        );
                      const destDir = path.dirname(op.destination);
                      await fs.mkdir(destDir, { recursive: true });
                      try {
                        await fs.access(op.source);
                      } catch {
                        throw new Error(
                          `Source file does not exist: ${op.source}`,
                        );
                      }

                      // BUG FIX #9: Improved collision handling with UUID fallback
                      // CRITICAL: 1000 collisions throws error, causing organization to fail
                      // Solution: Increase limit, add UUID fallback, better error handling
                      let counter = 0;
                      let uniqueDestination = op.destination;
                      const ext = path.extname(op.destination);
                      const baseName = op.destination.slice(0, -ext.length);
                      let operationComplete = false;
                      const maxNumericRetries = 5000; // Increased from 1000 to 5000

                      while (
                        !operationComplete &&
                        counter < maxNumericRetries
                      ) {
                        try {
                          // Attempt atomic rename first
                          await fs.rename(op.source, uniqueDestination);
                          operationComplete = true;
                          op.destination = uniqueDestination;
                        } catch (renameError) {
                          if (renameError.code === 'EEXIST') {
                            // Destination exists, try next filename atomically
                            counter++;
                            uniqueDestination = `${baseName}_${counter}${ext}`;
                            continue; // Retry with new name
                          } else if (renameError.code === 'EXDEV') {
                            // Cross-device move: use atomic copy with COPYFILE_EXCL
                            // NOTE: There's still a small TOCTOU window between copy and verification,
                            // but this is the best we can do without OS-level file locking
                            try {
                              // Step 1: Atomic copy (fails if destination exists)
                              await fs.copyFile(
                                op.source,
                                uniqueDestination,
                                fs.constants.COPYFILE_EXCL,
                              );

                              // Step 2: Verify file copy integrity immediately after copy
                              // Fixed: Get stats in parallel to minimize TOCTOU window
                              let sourceStats, destStats;
                              try {
                                [sourceStats, destStats] = await Promise.all([
                                  fs.stat(op.source),
                                  fs.stat(uniqueDestination),
                                ]);
                              } catch (error) {
                                // Clean up the copied file if verification fails
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                throw new Error(
                                  `File verification failed: ${error.message}`,
                                );
                              }

                              // CRITICAL: Verify file size matches before proceeding
                              if (sourceStats.size !== destStats.size) {
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                throw new Error(
                                  `File copy verification failed - size mismatch (source: ${sourceStats.size} bytes, dest: ${destStats.size} bytes)`,
                                );
                              }

                              // CRITICAL FIX (BUG #1): Always verify checksum for ALL files to prevent silent corruption
                              // Previous code only verified files >10MB, leaving smaller files vulnerable
                              // Performance trade-off: slower operations but guaranteed data integrity
                              logger.info(
                                `[FILE-OPS] Verifying file copy integrity with checksum: ${path.basename(op.source)} (${sourceStats.size} bytes)`,
                              );

                              let sourceChecksum, destChecksum;
                              try {
                                [sourceChecksum, destChecksum] =
                                  await Promise.all([
                                    computeFileChecksum(op.source),
                                    computeFileChecksum(uniqueDestination),
                                  ]);
                              } catch (checksumError) {
                                // Clean up destination if checksum computation fails
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                throw new Error(
                                  `Checksum computation failed: ${checksumError.message}`,
                                );
                              }

                              if (sourceChecksum !== destChecksum) {
                                await fs
                                  .unlink(uniqueDestination)
                                  .catch(() => {});
                                logger.error(
                                  `[FILE-OPS] Checksum mismatch detected - possible data corruption or TOCTOU race condition`,
                                  {
                                    source: op.source,
                                    destination: uniqueDestination,
                                    sourceChecksum,
                                    destChecksum,
                                  },
                                );
                                throw new Error(
                                  `File copy verification failed - checksum mismatch (source: ${sourceChecksum.substring(0, 8)}..., dest: ${destChecksum.substring(0, 8)}...)`,
                                );
                              }

                              logger.info(
                                `[FILE-OPS] File copy verified successfully: ${path.basename(op.source)} (checksum: ${sourceChecksum.substring(0, 16)}...)`,
                              );

                              // Step 3: Delete source (safe because destination verified)
                              // Fixed: Handle case where source was already deleted
                              try {
                                await fs.unlink(op.source);
                              } catch (unlinkError) {
                                if (unlinkError.code !== 'ENOENT') {
                                  // Source exists but can't delete - this is an error
                                  // Clean up destination and throw
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `Failed to delete source after copy: ${unlinkError.message}`,
                                  );
                                }
                                // ENOENT is fine - source was already deleted by another process
                              }

                              operationComplete = true;
                              op.destination = uniqueDestination;
                            } catch (copyError) {
                              if (copyError.code === 'EEXIST') {
                                // Destination exists, try next filename
                                counter++;
                                uniqueDestination = `${baseName}_${counter}${ext}`;
                                continue; // Retry with new name
                              } else {
                                throw copyError;
                              }
                            }
                          } else {
                            throw renameError;
                          }
                        }
                      }

                      // BUG FIX #9: UUID fallback if numeric counter exhausted
                      if (!operationComplete) {
                        // Try UUID-based naming as fallback
                        logger.warn(
                          `[FILE-OPS] Exhausted ${maxNumericRetries} numeric attempts for ${path.basename(op.source)}, falling back to UUID`,
                        );

                        const uuidAttempts = 3; // Try 3 UUID-based names
                        for (
                          let uuidTry = 0;
                          uuidTry < uuidAttempts && !operationComplete;
                          uuidTry++
                        ) {
                          // Generate UUID v4 (random) for guaranteed uniqueness
                          const uuid = require('crypto').randomUUID();
                          // Use first 8 chars of UUID for shorter filename
                          const uuidShort = uuid.split('-')[0];
                          uniqueDestination = `${baseName}_${uuidShort}${ext}`;

                          try {
                            // Try atomic rename with UUID name
                            await fs.rename(op.source, uniqueDestination);
                            operationComplete = true;
                            op.destination = uniqueDestination;
                            logger.info(
                              `[FILE-OPS] Successfully used UUID fallback: ${path.basename(uniqueDestination)}`,
                            );
                          } catch (uuidRenameError) {
                            if (uuidRenameError.code === 'EEXIST') {
                              // Incredibly unlikely, but UUID collision occurred
                              logger.warn(
                                `[FILE-OPS] UUID collision (try ${uuidTry + 1}/${uuidAttempts}): ${uuidShort}`,
                              );
                              continue; // Try another UUID
                            } else if (uuidRenameError.code === 'EXDEV') {
                              // Cross-device move with UUID name - use same verified copy logic
                              try {
                                await fs.copyFile(
                                  op.source,
                                  uniqueDestination,
                                  fs.constants.COPYFILE_EXCL,
                                );

                                let sourceStats, destStats;
                                try {
                                  [sourceStats, destStats] = await Promise.all([
                                    fs.stat(op.source),
                                    fs.stat(uniqueDestination),
                                  ]);
                                } catch (statError) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `File verification failed: ${statError.message}`,
                                  );
                                }

                                if (sourceStats.size !== destStats.size) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `File copy verification failed - size mismatch`,
                                  );
                                }

                                // Always verify checksum
                                logger.info(
                                  `[FILE-OPS] Verifying UUID fallback copy with checksum: ${path.basename(op.source)}`,
                                );
                                let sourceChecksum, destChecksum;
                                try {
                                  [sourceChecksum, destChecksum] =
                                    await Promise.all([
                                      computeFileChecksum(op.source),
                                      computeFileChecksum(uniqueDestination),
                                    ]);
                                } catch (checksumError) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `Checksum computation failed: ${checksumError.message}`,
                                  );
                                }

                                if (sourceChecksum !== destChecksum) {
                                  await fs
                                    .unlink(uniqueDestination)
                                    .catch(() => {});
                                  throw new Error(
                                    `File copy verification failed - checksum mismatch`,
                                  );
                                }

                                // Delete source
                                try {
                                  await fs.unlink(op.source);
                                } catch (unlinkError) {
                                  if (unlinkError.code !== 'ENOENT') {
                                    await fs
                                      .unlink(uniqueDestination)
                                      .catch(() => {});
                                    throw new Error(
                                      `Failed to delete source after copy: ${unlinkError.message}`,
                                    );
                                  }
                                }

                                operationComplete = true;
                                op.destination = uniqueDestination;
                                logger.info(
                                  `[FILE-OPS] Successfully used UUID fallback for cross-device move`,
                                );
                              } catch (uuidCopyError) {
                                if (uuidCopyError.code === 'EEXIST') {
                                  continue; // Try another UUID
                                } else {
                                  throw uuidCopyError;
                                }
                              }
                            } else {
                              throw uuidRenameError;
                            }
                          }
                        }

                        // Final check: if still not complete after UUID attempts, fail with detailed error
                        if (!operationComplete) {
                          throw new Error(
                            `Failed to create unique destination after ${maxNumericRetries} numeric attempts and ${uuidAttempts} UUID attempts. ` +
                              `Source: ${op.source}, Destination pattern: ${baseName}*${ext}. ` +
                              `This indicates either extreme file collision or file system issue.`,
                          );
                        }
                      }
                      await getServiceIntegration()?.processingState?.markOrganizeOpDone(
                        batchId,
                        i,
                        { destination: op.destination },
                      );

                      // CRITICAL FIX (BUG #3): Track completed operation for potential rollback
                      completedOperations.push({
                        index: i,
                        source: op.source,
                        destination: op.destination,
                        originalDestination:
                          operation.operations[i].destination,
                      });

                      results.push({
                        success: true,
                        source: op.source,
                        destination: op.destination,
                        operation: op.type || 'move',
                      });
                      successCount++;
                      const win = getMainWindow();
                      if (win && !win.isDestroyed()) {
                        win.webContents.send('operation-progress', {
                          type: 'batch_organize',
                          current: i + 1,
                          total: batch.operations.length,
                          currentFile: path.basename(op.source),
                        });
                      }
                    } catch (error) {
                      await getServiceIntegration()?.processingState?.markOrganizeOpError(
                        batchId,
                        i,
                        error.message,
                      );

                      // CRITICAL FIX (BUG #3): Determine if this error should trigger rollback
                      // Critical errors (permissions, disk full, corruption) should rollback entire batch
                      // Non-critical errors (file already exists, file not found) can continue
                      const isCriticalError =
                        error.code === 'EACCES' || // Permission denied
                        error.code === 'EPERM' || // Operation not permitted
                        error.code === 'ENOSPC' || // No space left on device
                        error.code === 'EIO' || // I/O error (corruption)
                        error.message.includes('checksum mismatch') || // Data corruption
                        error.message.includes('verification failed'); // File integrity issue

                      if (isCriticalError) {
                        shouldRollback = true;
                        rollbackReason = `Critical error on file ${i + 1}/${batch.operations.length}: ${error.message}`;
                        logger.error(
                          `[FILE-OPS] Critical error in batch ${batchId}, will rollback ${completedOperations.length} completed operations`,
                          {
                            error: error.message,
                            errorCode: error.code,
                            file: op.source,
                            completedCount: completedOperations.length,
                          },
                        );
                      }

                      results.push({
                        success: false,
                        source: op.source,
                        destination: op.destination,
                        error: error.message,
                        operation: op.type || 'move',
                        critical: isCriticalError,
                      });
                      failCount++;

                      // Stop processing if critical error occurred
                      if (shouldRollback) {
                        break;
                      }
                    }
                  }
                  // CRITICAL FIX (BUG #3): Execute rollback if critical error occurred
                  if (shouldRollback && completedOperations.length > 0) {
                    logger.warn(
                      `[FILE-OPS] Executing rollback for batch ${batchId} due to: ${rollbackReason}`,
                    );

                    const rollbackResults = [];
                    let rollbackSuccessCount = 0;
                    let rollbackFailCount = 0;

                    // Rollback in reverse order (LIFO - Last In First Out)
                    for (const completedOp of [
                      ...completedOperations,
                    ].reverse()) {
                      try {
                        // Move file back to original source location
                        await fs.rename(
                          completedOp.destination,
                          completedOp.source,
                        );
                        rollbackSuccessCount++;
                        rollbackResults.push({
                          success: true,
                          file: completedOp.source,
                          message: 'Rolled back successfully',
                        });
                        logger.info(
                          `[FILE-OPS] Rolled back: ${completedOp.destination} -> ${completedOp.source}`,
                        );
                      } catch (rollbackError) {
                        rollbackFailCount++;
                        rollbackResults.push({
                          success: false,
                          file: completedOp.source,
                          destination: completedOp.destination,
                          error: rollbackError.message,
                        });
                        logger.error(
                          `[FILE-OPS] Failed to rollback ${completedOp.destination}:`,
                          rollbackError.message,
                        );
                      }
                    }

                    logger.warn(
                      `[FILE-OPS] Rollback complete for batch ${batchId}: ${rollbackSuccessCount} succeeded, ${rollbackFailCount} failed`,
                    );

                    // Return rollback results
                    return {
                      success: false,
                      rolledBack: true,
                      rollbackReason,
                      results,
                      rollbackResults,
                      successCount: 0, // All operations rolled back
                      failCount: failCount,
                      rollbackSuccessCount,
                      rollbackFailCount,
                      summary:
                        `Batch operation failed and was rolled back. Reason: ${rollbackReason}. ` +
                        `Rolled back ${rollbackSuccessCount}/${completedOperations.length} operations. ` +
                        `${rollbackFailCount > 0 ? `WARNING: ${rollbackFailCount} files could not be rolled back and may be in inconsistent state!` : ''}`,
                      batchId,
                      criticalError: true,
                    };
                  }

                  await getServiceIntegration()?.processingState?.completeOrganizeBatch(
                    batchId,
                  );

                  // Only record undo if batch completed successfully (no rollback)
                  if (!shouldRollback) {
                    try {
                      const undoOps = batch.operations.map((op) => ({
                        type: 'move',
                        originalPath: op.source,
                        newPath: op.destination,
                      }));
                      await getServiceIntegration()?.undoRedo?.recordAction?.(
                        ACTION_TYPES.BATCH_OPERATION,
                        { operations: undoOps },
                      );
                    } catch {
                      // Non-fatal if undo recording fails
                    }
                  }
                } catch {
                  // Non-fatal if batch processing service fails
                }

                return {
                  success: successCount > 0 && !shouldRollback,
                  results,
                  successCount,
                  failCount,
                  completedOperations: completedOperations.length,
                  summary: `Processed ${operation.operations.length} files: ${successCount} successful, ${failCount} failed`,
                  batchId,
                };
              }
              default:
                logger.error(
                  `[FILE-OPS] Unknown operation type: ${operation.type}`,
                );
                return {
                  success: false,
                  error: `Unknown operation type: ${operation.type}`,
                };
            }
          } catch (error) {
            logger.error('[FILE-OPS] Error performing operation:', error);
            return { success: false, error: error.message };
          }
        });
  ipcMain.handle(IPC_CHANNELS.FILES.PERFORM_OPERATION, performOperationHandler);

  ipcMain.handle(
    IPC_CHANNELS.FILES.DELETE_FILE,
    withErrorLogging(logger, async (event, filePath) => {
      try {
        if (!filePath || typeof filePath !== 'string') {
          return {
            success: false,
            error: 'Invalid file path provided',
            errorCode: 'INVALID_PATH',
          };
        }
        try {
          await fs.access(filePath);
        } catch (accessError) {
          return {
            success: false,
            error: 'File not found or inaccessible',
            errorCode: 'FILE_NOT_FOUND',
            details: accessError.message,
          };
        }
        const stats = await fs.stat(filePath);
        await fs.unlink(filePath);
        logger.info(
          '[FILE-OPS] Deleted file:',
          filePath,
          `(${stats.size} bytes)`,
        );
        return {
          success: true,
          message: 'File deleted successfully',
          deletedFile: {
            path: filePath,
            size: stats.size,
            deletedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error deleting file:', error);
        let errorCode = 'DELETE_FAILED';
        let userMessage = 'Failed to delete file';
        if (error.code === 'ENOENT') {
          errorCode = 'FILE_NOT_FOUND';
          userMessage = 'File not found';
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
          errorCode = 'PERMISSION_DENIED';
          userMessage = 'Permission denied - file may be in use';
        } else if (error.code === 'EBUSY') {
          errorCode = 'FILE_IN_USE';
          userMessage = 'File is currently in use';
        }
        return {
          success: false,
          error: userMessage,
          errorCode,
          details: error.message,
          systemError: error.code,
        };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES.OPEN_FILE,
    withErrorLogging(logger, async (event, filePath) => {
      try {
        await shell.openPath(filePath);
        logger.info('[FILE-OPS] Opened file:', filePath);
        return { success: true };
      } catch (error) {
        logger.error('[FILE-OPS] Error opening file:', error);
        return { success: false, error: error.message };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES.REVEAL_FILE,
    withErrorLogging(logger, async (event, filePath) => {
      try {
        await shell.showItemInFolder(filePath);
        logger.info('[FILE-OPS] Revealed file in folder:', filePath);
        return { success: true };
      } catch (error) {
        logger.error('[FILE-OPS] Error revealing file:', error);
        return { success: false, error: error.message };
      }
    }),
  );

  ipcMain.handle(
    IPC_CHANNELS.FILES.COPY_FILE,
    withErrorLogging(logger, async (event, sourcePath, destinationPath) => {
      try {
        if (!sourcePath || !destinationPath) {
          return {
            success: false,
            error: 'Source and destination paths are required',
            errorCode: 'INVALID_PATHS',
          };
        }
        const normalizedSource = path.resolve(sourcePath);
        const normalizedDestination = path.resolve(destinationPath);
        try {
          await fs.access(normalizedSource);
        } catch (accessError) {
          return {
            success: false,
            error: 'Source file not found',
            errorCode: 'SOURCE_NOT_FOUND',
            details: accessError.message,
          };
        }
        const destDir = path.dirname(normalizedDestination);
        await fs.mkdir(destDir, { recursive: true });
        const sourceStats = await fs.stat(normalizedSource);
        await fs.copyFile(normalizedSource, normalizedDestination);
        logger.info(
          '[FILE-OPS] Copied file:',
          normalizedSource,
          'to',
          normalizedDestination,
        );
        return {
          success: true,
          message: 'File copied successfully',
          operation: {
            source: normalizedSource,
            destination: normalizedDestination,
            size: sourceStats.size,
            copiedAt: new Date().toISOString(),
          },
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error copying file:', error);
        let errorCode = 'COPY_FAILED';
        let userMessage = 'Failed to copy file';
        if (error.code === 'ENOSPC') {
          errorCode = 'INSUFFICIENT_SPACE';
          userMessage = 'Insufficient disk space';
        } else if (error.code === 'EACCES' || error.code === 'EPERM') {
          errorCode = 'PERMISSION_DENIED';
          userMessage = 'Permission denied';
        } else if (error.code === 'EEXIST') {
          errorCode = 'FILE_EXISTS';
          userMessage = 'Destination file already exists';
        }
        return {
          success: false,
          error: userMessage,
          errorCode,
          details: error.message,
        };
      }
    }),
  );

  // Open folder
  ipcMain.handle(
    IPC_CHANNELS.FILES.OPEN_FOLDER,
    withErrorLogging(logger, async (event, folderPath) => {
      try {
        if (!folderPath || typeof folderPath !== 'string') {
          return {
            success: false,
            error: 'Invalid folder path provided',
            errorCode: 'INVALID_PATH',
          };
        }
        const normalizedPath = path.resolve(folderPath);
        try {
          const stats = await fs.stat(normalizedPath);
          if (!stats.isDirectory()) {
            return {
              success: false,
              error: 'Path is not a directory',
              errorCode: 'NOT_A_DIRECTORY',
            };
          }
        } catch (accessError) {
          return {
            success: false,
            error: 'Folder not found or inaccessible',
            errorCode: 'FOLDER_NOT_FOUND',
            details: accessError.message,
          };
        }
        await shell.openPath(normalizedPath);
        logger.info('[FILE-OPS] Opened folder:', normalizedPath);
        return {
          success: true,
          message: 'Folder opened successfully',
          openedPath: normalizedPath,
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error opening folder:', error);
        return {
          success: false,
          error: 'Failed to open folder',
          errorCode: 'OPEN_FAILED',
          details: error.message,
        };
      }
    }),
  );

  // Delete empty folder
  ipcMain.handle(
    IPC_CHANNELS.FILES.DELETE_FOLDER,
    withErrorLogging(logger, async (event, fullPath) => {
      try {
        const normalizedPath = path.resolve(fullPath);
        try {
          const stats = await fs.stat(normalizedPath);
          if (!stats.isDirectory()) {
            return {
              success: false,
              error: 'Path is not a directory',
              code: 'NOT_DIRECTORY',
            };
          }
        } catch (statError) {
          if (statError.code === 'ENOENT') {
            return {
              success: true,
              message: 'Folder already deleted or does not exist',
              existed: false,
            };
          }
          throw statError;
        }
        const contents = await fs.readdir(normalizedPath);
        if (contents.length > 0) {
          return {
            success: false,
            error: `Directory not empty - contains ${contents.length} items`,
            code: 'NOT_EMPTY',
            itemCount: contents.length,
          };
        }
        await fs.rmdir(normalizedPath);
        logger.info('[FILE-OPS] Deleted folder:', normalizedPath);
        return {
          success: true,
          path: normalizedPath,
          message: 'Folder deleted successfully',
        };
      } catch (error) {
        logger.error('[FILE-OPS] Error deleting folder:', error);
        let userMessage = 'Failed to delete folder';
        if (error.code === 'EACCES' || error.code === 'EPERM')
          userMessage = 'Permission denied - check folder permissions';
        else if (error.code === 'ENOTEMPTY')
          userMessage = 'Directory not empty - contains files or subfolders';
        else if (error.code === 'EBUSY')
          userMessage = 'Directory is in use by another process';
        return {
          success: false,
          error: userMessage,
          details: error.message,
          code: error.code,
        };
      }
    }),
  );
}

module.exports = registerFilesIpc;
