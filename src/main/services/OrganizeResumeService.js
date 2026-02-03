const path = require('path');
const fs = require('fs').promises;
const { crossDeviceMove } = require('../../shared/atomicFileOperations');
// FIX: Import safeSend for validated IPC event sending
const { safeSend } = require('../ipc/ipcWrappers');
const { computeFileChecksum, handleDuplicateMove } = require('../utils/fileDedup');
const { removeEmbeddingsForPathBestEffort } = require('../ipc/files/embeddingSync');

async function pathExists(filePath, logger, label) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    logger?.warn?.('[RESUME] Unexpected fs.access error:', {
      error: error.message,
      code: error.code,
      path: filePath,
      label
    });
    throw error;
  }
}

/**
 * Resume incomplete organize batches from a previous session.
 * Coordinates with ProcessingStateService to safely continue operations.
 *
 * Dependencies are injected for testability and modularity.
 */
async function resumeIncompleteBatches(serviceIntegration, logger, getMainWindow) {
  try {
    const incomplete = serviceIntegration?.processingState?.getIncompleteOrganizeBatches?.() || [];
    if (!incomplete.length) return;
    logger.warn(`[RESUME] Resuming ${incomplete.length} incomplete organize batch(es)`);

    for (const batch of incomplete) {
      const total = batch.operations.length;
      for (let i = 0; i < total; i += 1) {
        const op = batch.operations[i];
        if (op.status === 'done') {
          const win = getMainWindow?.();
          if (win && !win.isDestroyed()) {
            // FIX: Use safeSend for validated IPC event sending
            safeSend(win.webContents, 'operation-progress', {
              type: 'batch_organize',
              current: i + 1,
              total,
              currentFile: path.basename(op.source)
            });
          }
          continue;
        }
        try {
          await serviceIntegration.processingState.markOrganizeOpStarted(batch.id, i);

          const sourceExists = await pathExists(op.source, logger, 'source');
          const destinationExists = await pathExists(op.destination, logger, 'destination');

          if (!sourceExists) {
            if (destinationExists) {
              await serviceIntegration.processingState.markOrganizeOpDone(batch.id, i, {
                destination: op.destination
              });

              const win = getMainWindow?.();
              if (win && !win.isDestroyed()) {
                // FIX: Use safeSend for validated IPC event sending
                safeSend(win.webContents, 'operation-progress', {
                  type: 'batch_organize',
                  current: i + 1,
                  total,
                  currentFile: path.basename(op.source)
                });
              }
              continue;
            }

            throw new Error('Source file missing; destination not found');
          }

          // Ensure destination directory exists
          const destDir = path.dirname(op.destination);
          await fs.mkdir(destDir, { recursive: true });

          const duplicateResult = await handleDuplicateMove({
            sourcePath: op.source,
            destinationPath: op.destination,
            checksumFn: computeFileChecksum,
            logger,
            logPrefix: '[RESUME]',
            dedupContext: 'organizeResume',
            removeEmbeddings: removeEmbeddingsForPathBestEffort,
            unlinkFn: fs.unlink
          });
          if (duplicateResult) {
            op.destination = duplicateResult.destination;
            await serviceIntegration.processingState.markOrganizeOpDone(batch.id, i, {
              destination: op.destination,
              skipped: true
            });

            const win = getMainWindow?.();
            if (win && !win.isDestroyed()) {
              safeSend(win.webContents, 'operation-progress', {
                type: 'batch_organize',
                current: i + 1,
                total,
                currentFile: path.basename(op.source)
              });
            }
            continue;
          }

          // Check destination collision and adjust
          if (destinationExists) {
            let counter = 1;
            let uniqueDestination;
            const ext = path.extname(op.destination);
            const baseName =
              ext && ext.length > 0 ? op.destination.slice(0, -ext.length) : op.destination;
            while (counter <= 1000) {
              const base = baseName || op.destination;
              uniqueDestination = `${base}_${counter}${ext}`;
              try {
                await fs.access(uniqueDestination);
                counter += 1;
              } catch (accessErr) {
                if (accessErr?.code && accessErr.code !== 'ENOENT') {
                  logger.warn('[RESUME] Unexpected fs.access error:', {
                    error: accessErr.message,
                    code: accessErr.code
                  });
                }
                break;
              }
            }
            if (counter > 1000) throw new Error('Too many name collisions');
            if (uniqueDestination !== op.destination) {
              op.destination = uniqueDestination;
            }
          }

          // Move with EXDEV handling using shared utility
          try {
            await fs.rename(op.source, op.destination);
          } catch (renameError) {
            if (renameError.code === 'EXDEV') {
              await crossDeviceMove(op.source, op.destination, {
                verify: true
              });
            } else {
              throw renameError;
            }
          }

          await serviceIntegration.processingState.markOrganizeOpDone(batch.id, i, {
            destination: op.destination
          });

          const win = getMainWindow?.();
          if (win && !win.isDestroyed()) {
            // FIX: Use safeSend for validated IPC event sending
            safeSend(win.webContents, 'operation-progress', {
              type: 'batch_organize',
              current: i + 1,
              total,
              currentFile: path.basename(op.source)
            });
          }
        } catch (err) {
          logger?.warn?.(
            '[RESUME] Failed to resume op',
            i + 1,
            'in batch',
            batch.id,
            ':',
            err.message
          );
          try {
            await serviceIntegration.processingState.markOrganizeOpError(batch.id, i, err.message);
          } catch {
            // ignore inner error
          }
        }
      }
      try {
        await serviceIntegration.processingState.completeOrganizeBatch(batch.id);
      } catch {
        // ignore inner error
      }
      logger?.info?.('[RESUME] Completed batch resume:', batch.id);
    }
  } catch (e) {
    logger?.warn?.('[RESUME] Resume batches failed:', e.message);
  }
}

module.exports = {
  resumeIncompleteBatches
};
