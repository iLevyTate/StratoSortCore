const os = require('os');
const path = require('path');
const fs = require('fs');
const Piscina = require('piscina');
const { createLogger } = require('../../shared/logger');

let app = null;
try {
  ({ app } = require('electron'));
} catch (err) {
  // electron require failed – running in test/worker context
  void err;
  app = null;
}

const logger = createLogger('WorkerPools');

let ocrPool = null;
let embeddingPool = null;
let _embeddingWorkerMissing = false;
const EMBEDDING_WORKER_ENABLED =
  String(process.env.STRATOSORT_ENABLE_EMBEDDING_WORKER || 'true').toLowerCase() === 'true';

async function drainPool(pool, label) {
  if (!pool) return;
  if (typeof pool.drain === 'function') {
    await pool.drain();
    return;
  }

  const start = Date.now();
  const timeoutMs = 5000;
  let pending = typeof pool.pending === 'number' ? pool.pending : 0;
  let queueSize = typeof pool.queueSize === 'number' ? pool.queueSize : 0;

  while (pending + queueSize > 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 50);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    pending = typeof pool.pending === 'number' ? pool.pending : 0;
    queueSize = typeof pool.queueSize === 'number' ? pool.queueSize : 0;
  }

  if (pending + queueSize > 0) {
    logger.warn('[WorkerPools] Timed out waiting for pool to drain', {
      label,
      pending,
      queueSize
    });
  }
}

function _getAppRoot() {
  try {
    const appPath = app?.getAppPath?.() || '';
    if (appPath.endsWith('src/main') || appPath.endsWith('src\\main')) {
      return path.resolve(appPath, '../..');
    }
    if (appPath.endsWith('dist') || appPath.endsWith('dist\\')) {
      return path.resolve(appPath, '..');
    }
    return appPath || process.cwd();
  } catch {
    return process.cwd();
  }
}

function shouldUsePiscina() {
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
    return false;
  }
  if (String(process.env.STRATOSORT_DISABLE_PISCINA || '').toLowerCase() === 'true') {
    return false;
  }
  return true;
}

function resolveWorkerPath(name) {
  // Webpack emits worker bundles alongside main.js in dist
  const candidate = path.join(__dirname, `${name}.js`);
  if (fs.existsSync(candidate)) return candidate;

  // Dev fallback: resolve from app root (handles __dirname !== dist after bundling)
  const distCandidate = path.join(_getAppRoot(), 'dist', `${name}.js`);
  if (fs.existsSync(distCandidate)) return distCandidate;

  // Dev fallback: source worker location
  const devCandidate = path.join(_getAppRoot(), 'src', 'main', 'workers', `${name}.js`);
  if (fs.existsSync(devCandidate)) return devCandidate;

  if (app && app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', `${name}.js`);
    if (fs.existsSync(unpacked)) return unpacked;
    const appPath = app.getAppPath?.() || '';
    const packaged = path.join(appPath, 'dist', `${name}.js`);
    if (fs.existsSync(packaged)) return packaged;
  }

  logger.error(`[WorkerPools] Could not resolve ${name} in any known location`, {
    __dirname,
    appRoot: _getAppRoot(),
    candidates: [candidate, distCandidate, devCandidate]
  });
  return null;
}

function getOcrPool() {
  if (!shouldUsePiscina()) return null;
  if (ocrPool) return ocrPool;

  const maxThreads = Math.max(1, Math.min(2, os.cpus().length - 1));
  const filename = resolveWorkerPath('ocrWorker');
  if (!filename) {
    logger.warn('[WorkerPools] OCR worker not found, disabling pool');
    return null;
  }
  ocrPool = new Piscina({
    filename,
    maxThreads,
    minThreads: 1,
    idleTimeout: 60000
  });
  ocrPool.on('error', (error) => {
    logger.error('[WorkerPools] OCR worker thread error:', { error: error?.message });
    // FIX: Drain the pool before nulling to prevent orphaned worker threads.
    // The previous code nulled the reference immediately, leaking the Piscina
    // threads which kept the process alive during shutdown.
    const dyingPool = ocrPool;
    ocrPool = null;
    drainPool(dyingPool, 'ocr-error-cleanup')
      .then(() => dyingPool.destroy?.())
      .catch(() => {});
  });
  logger.info('[WorkerPools] OCR pool initialized', { maxThreads });
  return ocrPool;
}

function getEmbeddingPool() {
  if (!shouldUsePiscina()) return null;
  if (!EMBEDDING_WORKER_ENABLED) return null;
  if (embeddingPool) return embeddingPool;
  if (_embeddingWorkerMissing) return null;

  // Embedding model loading is heavy; keep a single worker
  const filename = resolveWorkerPath('embeddingWorker');
  if (!filename) {
    logger.warn('[WorkerPools] Embedding worker not found, disabling pool');
    _embeddingWorkerMissing = true;
    return null;
  }
  embeddingPool = new Piscina({
    filename,
    maxThreads: 1,
    minThreads: 1,
    idleTimeout: 60000
  });
  embeddingPool.on('error', (error) => {
    logger.error('[WorkerPools] Embedding worker thread error:', { error: error?.message });
    // FIX: Drain the pool before nulling to prevent orphaned worker threads.
    const dyingPool = embeddingPool;
    embeddingPool = null;
    drainPool(dyingPool, 'embedding-error-cleanup')
      .then(() => dyingPool.destroy?.())
      .catch(() => {});
  });
  logger.info('[WorkerPools] Embedding pool initialized', { maxThreads: 1 });
  return embeddingPool;
}

async function destroyOcrPool() {
  if (ocrPool) {
    try {
      await drainPool(ocrPool, 'ocr');
    } catch (error) {
      logger.warn('[WorkerPools] Error draining OCR pool:', { error: error?.message });
    }
    try {
      await ocrPool.destroy();
    } catch (error) {
      logger.warn('[WorkerPools] Error destroying OCR pool:', { error: error?.message });
    } finally {
      ocrPool = null;
    }
  }
}

async function destroyEmbeddingPool() {
  if (embeddingPool) {
    try {
      await drainPool(embeddingPool, 'embedding');
    } catch (error) {
      logger.warn('[WorkerPools] Error draining embedding pool:', { error: error?.message });
    }
    try {
      await embeddingPool.destroy();
    } catch (error) {
      logger.warn('[WorkerPools] Error destroying embedding pool:', { error: error?.message });
    } finally {
      embeddingPool = null;
    }
  }
}

async function destroyPools() {
  await destroyOcrPool();
  await destroyEmbeddingPool();
}

module.exports = {
  getOcrPool,
  getEmbeddingPool,
  destroyPools,
  destroyOcrPool,
  destroyEmbeddingPool,
  shouldUsePiscina,
  resolveWorkerPath // Export for testing
};
