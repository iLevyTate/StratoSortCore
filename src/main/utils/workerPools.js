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
const EMBEDDING_WORKER_ENABLED =
  String(process.env.STRATOSORT_ENABLE_EMBEDDING_WORKER || '').toLowerCase() === 'true';

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

  // Dev fallback: source worker location
  const devCandidate = path.join(__dirname, '..', 'workers', `${name}.js`);
  if (fs.existsSync(devCandidate)) return devCandidate;

  if (app && app.isPackaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', `${name}.js`);
    if (fs.existsSync(unpacked)) return unpacked;
    const appPath = app.getAppPath?.() || '';
    const packaged = path.join(appPath, 'dist', `${name}.js`);
    if (fs.existsSync(packaged)) return packaged;
  }

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
  });
  logger.info('[WorkerPools] OCR pool initialized', { maxThreads });
  return ocrPool;
}

function getEmbeddingPool() {
  if (!shouldUsePiscina()) return null;
  if (!EMBEDDING_WORKER_ENABLED) return null;
  if (embeddingPool) return embeddingPool;

  // Embedding model loading is heavy; keep a single worker
  const filename = resolveWorkerPath('embeddingWorker');
  if (!filename) {
    logger.warn('[WorkerPools] Embedding worker not found, disabling pool');
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
  });
  logger.info('[WorkerPools] Embedding pool initialized', { maxThreads: 1 });
  return embeddingPool;
}

async function destroyOcrPool() {
  if (ocrPool) {
    await ocrPool.destroy();
    ocrPool = null;
  }
}

async function destroyEmbeddingPool() {
  if (embeddingPool) {
    await embeddingPool.destroy();
    embeddingPool = null;
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
