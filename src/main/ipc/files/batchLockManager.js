/**
 * Batch Lock Manager
 *
 * Provides a global lock to prevent concurrent batch operations.
 */

const { logger: baseLogger, createLogger } = require('../../../shared/logger');

const logger =
  typeof createLogger === 'function' ? createLogger('IPC:Files:BatchLock') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('IPC:Files:BatchLock');
}

// Global batch operation lock to prevent concurrent batch operations
let batchOperationLock = null;
const BATCH_LOCK_TIMEOUT = 5 * 60 * 1000; // 5 minutes max lock hold time
const BATCH_LOCK_ACQUIRE_TIMEOUT = 15000; // 15 seconds per attempt
const BATCH_LOCK_ACQUIRE_MAX_WAIT = 5 * 60 * 1000; // 5 minutes total wait
const BATCH_LOCK_RETRY_BASE_MS = 1000;
const BATCH_LOCK_RETRY_MAX_MS = 10000;

// Promise-based mutex for atomic lock acquisition (prevents race conditions)
let lockMutex = Promise.resolve();

// Promise-based waiters queue to avoid busy-wait polling
const batchLockWaiters = [];

/**
 * Acquire the global batch operation lock
 * Uses promise-based mutex for ATOMIC check-and-set to prevent race conditions
 * @param {string} batchId - Unique identifier for the batch
 * @param {number} timeout - Maximum time to wait for lock (ms)
 * @returns {Promise<boolean>} True if lock acquired, false if timeout
 */
async function acquireBatchLockOnce(batchId, timeout = BATCH_LOCK_ACQUIRE_TIMEOUT) {
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  const current = lockMutex;
  lockMutex = next;

  // Wait for previous mutex holder to release (with timeout)
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('Lock acquisition mutex timeout'));
    }, timeout);
  });

  try {
    await Promise.race([current, timeoutPromise]);
    clearTimeout(timeoutId);
  } catch (error) {
    // Mutex timeout - release our slot and return false
    release();
    return false;
  }

  try {
    // Check and handle stale lock
    if (batchOperationLock !== null) {
      if (Date.now() - batchOperationLock.acquiredAt > BATCH_LOCK_TIMEOUT) {
        logger.warn('[FILE-OPS] Force-releasing stale batch lock', {
          staleBatchId: batchOperationLock.batchId,
          heldFor: Date.now() - batchOperationLock.acquiredAt
        });
        batchOperationLock = null;
      }
    }

    // If lock is free, acquire immediately
    if (batchOperationLock === null) {
      batchOperationLock = { batchId, acquiredAt: Date.now() };
      release(); // Release mutex
      return true;
    }

    // Lock is held by another batch - add to waiters queue
    release(); // Release mutex before waiting

    // Wait for lock to be released using promise-based approach (no polling)
    return new Promise((resolve) => {
      let timeoutId;
      const waiter = {
        batchId,
        resolve,
        clearTimeout: () => clearTimeout(timeoutId)
      };

      batchLockWaiters.push(waiter);

      timeoutId = setTimeout(() => {
        const index = batchLockWaiters.indexOf(waiter);
        if (index !== -1) {
          batchLockWaiters.splice(index, 1);
          resolve(false);
        }
      }, timeout);

      waiter.timeoutId = timeoutId;
    });
  } catch (error) {
    release();
    throw error;
  }
}

async function acquireBatchLock(batchId, timeout = BATCH_LOCK_ACQUIRE_TIMEOUT) {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < BATCH_LOCK_ACQUIRE_MAX_WAIT) {
    const acquired = await acquireBatchLockOnce(batchId, timeout);
    if (acquired) return true;
    attempt += 1;
    const backoff = Math.min(BATCH_LOCK_RETRY_BASE_MS * 2 ** attempt, BATCH_LOCK_RETRY_MAX_MS);
    await new Promise((resolve) => setTimeout(resolve, backoff));
  }
  return false;
}

/**
 * Release the global batch operation lock
 * Notifies waiting batch operations that the lock is available
 * @param {string} batchId - Batch ID that should hold the lock
 */
function releaseBatchLock(batchId) {
  if (batchOperationLock && batchOperationLock.batchId === batchId) {
    batchOperationLock = null;

    if (batchLockWaiters.length > 0) {
      const waiter = batchLockWaiters.shift();
      if (waiter.clearTimeout) {
        waiter.clearTimeout();
      } else if (waiter.timeoutId) {
        clearTimeout(waiter.timeoutId);
      }
      batchOperationLock = { batchId: waiter.batchId, acquiredAt: Date.now() };
      waiter.resolve(true);
    }
  }
}

module.exports = {
  acquireBatchLock,
  releaseBatchLock
};
