/**
 * Batch Rollback
 *
 * Handles rollback of completed batch operations.
 */

const path = require('path');
const fs = require('fs').promises;
const { app } = require('electron');
const { crossDeviceMove } = require('../../../shared/atomicFileOperations');

/**
 * Execute rollback of completed operations
 */
async function executeRollback(
  completedOperations,
  results,
  failCount,
  rollbackReason,
  batchId,
  log
) {
  log.warn(`[FILE-OPS] Executing rollback for batch ${batchId}`, {
    batchId,
    completedCount: completedOperations.length,
    failCount,
    reason: rollbackReason
  });

  // Persist recovery manifest before starting rollback
  let recoveryPath = null;
  try {
    const userDataPath = app.getPath('userData');
    const recoveryDir = path.join(userDataPath, 'recovery');
    await fs.mkdir(recoveryDir, { recursive: true });

    recoveryPath = path.join(recoveryDir, `rollback_${batchId}.json`);
    const recoveryManifest = {
      batchId,
      timestamp: new Date().toISOString(),
      reason: rollbackReason,
      status: 'pending',
      operations: completedOperations,
      results: []
    };

    await fs.writeFile(recoveryPath, JSON.stringify(recoveryManifest, null, 2));
    log.info(`[FILE-OPS] Recovery manifest saved to ${recoveryPath}`);
  } catch (err) {
    log.error(`[FILE-OPS] Failed to save recovery manifest: ${err.message}`);
  }

  const rollbackResults = [];
  let rollbackSuccessCount = 0;
  let rollbackFailCount = 0;

  for (const completedOp of [...completedOperations].reverse()) {
    try {
      try {
        await fs.rename(completedOp.destination, completedOp.source);
      } catch (renameError) {
        if (renameError.code === 'EXDEV') {
          const sourceDir = path.dirname(completedOp.source);
          await fs.mkdir(sourceDir, { recursive: true });
          await crossDeviceMove(completedOp.destination, completedOp.source, {
            verify: true
          });
        } else {
          throw renameError;
        }
      }
      rollbackSuccessCount++;
      rollbackResults.push({ success: true, file: completedOp.source });
    } catch (rollbackError) {
      rollbackFailCount++;
      rollbackResults.push({
        success: false,
        file: completedOp.source,
        error: rollbackError.message
      });
    }
  }

  // Update recovery manifest status
  if (recoveryPath) {
    try {
      if (rollbackFailCount === 0) {
        await fs.unlink(recoveryPath);
        log.info('[FILE-OPS] Rollback successful, recovery manifest deleted');
      } else {
        const recoveryManifest = JSON.parse(await fs.readFile(recoveryPath, 'utf8'));
        recoveryManifest.status = 'partial_failure';
        recoveryManifest.results = rollbackResults;
        await fs.writeFile(recoveryPath, JSON.stringify(recoveryManifest, null, 2));
        log.warn(`[FILE-OPS] Rollback had failures, manifest updated at ${recoveryPath}`);
      }
    } catch (err) {
      log.warn(`[FILE-OPS] Failed to update recovery manifest: ${err.message}`);
    }
  }

  log.warn('[FILE-OPS] Rollback summary', {
    batchId,
    rollbackSuccessCount,
    rollbackFailCount,
    completed: completedOperations.length
  });

  return {
    success: false,
    rolledBack: true,
    rollbackReason,
    results,
    rollbackResults,
    successCount: 0,
    failCount,
    rollbackSuccessCount,
    rollbackFailCount,
    summary: `Batch rolled back. ${rollbackSuccessCount}/${completedOperations.length} operations restored.`,
    batchId,
    recoveryPath,
    criticalError: true
  };
}

module.exports = {
  executeRollback
};
