const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { logger: baseLogger, createLogger } = require('../../shared/logger');
const { resolveRuntimePath } = require('./runtimePaths');
const { getOcrPool, destroyOcrPool, shouldUsePiscina } = require('./workerPools');

const execFileAsync = promisify(execFile);

const logger = typeof createLogger === 'function' ? createLogger('TesseractUtils') : baseLogger;
if (typeof createLogger !== 'function' && logger?.setContext) {
  logger.setContext('TesseractUtils');
}

const CHECK_TIMEOUT_MS = 2000;
const AVAILABILITY_CACHE_TTL_MS = 30000;
let availabilityCache = null;
let availabilityCheck = null;
let warnedUnavailable = false;

let jsWorkerPromise = null;
let jsWorkerLang = null;
let jsWorkerQueue = Promise.resolve();

function getEmbeddedTesseractPath() {
  const exe = process.platform === 'win32' ? 'tesseract.exe' : 'tesseract';
  return resolveRuntimePath('tesseract', exe);
}

function ensureTessdataPrefix(binaryPath) {
  if (process.env.TESSDATA_PREFIX) return;
  if (!binaryPath) return;
  const tessdata = path.join(path.dirname(binaryPath), 'tessdata');
  if (fs.existsSync(tessdata)) {
    process.env.TESSDATA_PREFIX = tessdata;
  }
}

function getTesseractBinaryPath() {
  const override = process.env.TESSERACT_PATH;
  if (override && override.trim()) return override.trim();
  const embedded = getEmbeddedTesseractPath();
  if (embedded && fs.existsSync(embedded)) {
    ensureTessdataPrefix(embedded);
    return embedded;
  }
  return 'tesseract';
}

function getTesseractOptions(baseOptions = {}) {
  const tesseractPath = getTesseractBinaryPath();
  if (!tesseractPath || tesseractPath === 'tesseract') return baseOptions;
  return { ...baseOptions, binary: tesseractPath };
}

function getAvailabilityFromCache() {
  if (!availabilityCache) return null;
  if (availabilityCache.value === true) return true;
  if (Date.now() - availabilityCache.checkedAt < AVAILABILITY_CACHE_TTL_MS) {
    return false;
  }
  availabilityCache = null;
  return null;
}

async function isTesseractAvailable() {
  const cached = getAvailabilityFromCache();
  if (cached !== null) {
    return cached;
  }
  if (availabilityCheck) {
    return availabilityCheck;
  }

  availabilityCheck = (async () => {
    const binaryPath = getTesseractBinaryPath();
    try {
      await execFileAsync(binaryPath, ['--version'], {
        windowsHide: true,
        timeout: CHECK_TIMEOUT_MS
      });
      availabilityCache = { value: true, checkedAt: Date.now() };
      return true;
    } catch (error) {
      logger?.debug?.('[OCR] Native tesseract unavailable, will try tesseract.js', {
        binaryPath,
        error: error.message
      });
      try {
        if (shouldUsePiscina()) {
          getOcrPool();
          availabilityCache = { value: true, checkedAt: Date.now() };
          return true;
        }
      } catch (poolError) {
        logger?.warn?.('[OCR] OCR worker pool unavailable, falling back', {
          error: poolError.message
        });
      }
      try {
        await getJsWorker();
        availabilityCache = { value: true, checkedAt: Date.now() };
        return true;
      } catch (jsError) {
        availabilityCache = { value: false, checkedAt: Date.now() };
        if (!warnedUnavailable) {
          warnedUnavailable = true;
          logger?.warn?.('[OCR] Tesseract not available, OCR disabled', {
            binaryPath,
            error: jsError.message
          });
        }
        return false;
      }
    } finally {
      availabilityCheck = null;
    }
  })();

  return availabilityCheck;
}

async function getTesseractBinaryInfo() {
  const override = process.env.TESSERACT_PATH;
  if (override && override.trim()) {
    const info = await verifyTesseractBinary(override.trim(), 'env');
    if (info.installed) return info;
  }

  const embedded = getEmbeddedTesseractPath();
  if (embedded && fs.existsSync(embedded)) {
    ensureTessdataPrefix(embedded);
    const info = await verifyTesseractBinary(embedded, 'embedded');
    if (info.installed) return info;
  }

  return verifyTesseractBinary('tesseract', 'system');
}

async function verifyTesseractBinary(binaryPath, source) {
  try {
    const res = await execFileAsync(binaryPath, ['--version'], {
      windowsHide: true,
      timeout: CHECK_TIMEOUT_MS
    });
    const raw = (res.stdout || res.stderr || '').toString().trim();
    const version = raw.split(/\r?\n/)[0] || null;
    return { installed: true, version, source, path: binaryPath };
  } catch {
    return { installed: false, version: null, source, path: binaryPath };
  }
}

async function getJsWorker() {
  if (jsWorkerPromise) return jsWorkerPromise;

  jsWorkerPromise = (async () => {
    try {
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker('eng');
      jsWorkerLang = 'eng';
      return worker;
    } catch (error) {
      jsWorkerPromise = null;
      jsWorkerLang = null;
      throw error;
    }
  })();

  return jsWorkerPromise;
}

async function ensureJsWorkerLanguage(worker, lang = 'eng') {
  if (jsWorkerLang === lang) return;
  if (typeof worker.reinitialize === 'function') {
    await worker.reinitialize(lang);
  } else {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
  }
  jsWorkerLang = lang;
}

async function recognizeWithTesseractJs(input, options = {}) {
  const pool = getOcrPool();
  if (pool) {
    try {
      const result = await pool.run({ input, options });
      // FIX: ocrWorker now returns { text, error? } instead of throwing
      // to prevent uncaught exceptions in the Piscina thread
      if (result?.error) {
        throw new Error(result.error);
      }
      return result?.text || '';
    } catch (error) {
      logger?.warn?.('[OCR] Worker pool failed, falling back to local worker', {
        error: error.message
      });
    }
  }

  const task = async () => {
    const worker = await getJsWorker();
    const lang = options.lang || 'eng';
    await ensureJsWorkerLanguage(worker, lang);

    const params = {};
    if (typeof options.psm === 'number') {
      params.tessedit_pageseg_mode = String(options.psm);
    }
    if (Object.keys(params).length > 0) {
      await worker.setParameters(params);
    }

    const result = await worker.recognize(input);
    return result?.data?.text || '';
  };

  // Swallow errors from previous tasks cleanly (queue is just for serialization)
  // so current task's errors propagate correctly to its caller
  const current = jsWorkerQueue.catch(() => {}).then(task);
  jsWorkerQueue = current.catch(() => {}); // Keep queue alive even if task fails
  return current;
}

async function recognizeIfAvailable(tesseract, input, options = {}) {
  let nativeError = null;
  if (tesseract?.recognize) {
    try {
      const text = await tesseract.recognize(input, getTesseractOptions(options));
      return { success: true, text };
    } catch (error) {
      const message = error?.message || 'OCR failed';
      nativeError = error instanceof Error ? error : new Error(message);
      if (message.toLowerCase().includes('write eof')) {
        logger?.debug?.('[OCR] Native tesseract write EOF, falling back', { error: message });
      } else {
        logger?.warn?.('[OCR] Native tesseract failed, falling back', { error: message });
      }
    }
  }

  const available = await isTesseractAvailable();
  if (!available) {
    return {
      success: false,
      error: nativeError?.message || 'Tesseract not available',
      cause: nativeError || null
    };
  }

  try {
    const text = await recognizeWithTesseractJs(input, options);
    return { success: true, text };
  } catch (error) {
    const message = nativeError?.message || error?.message || 'OCR failed';
    logger?.warn?.('[OCR] Tesseract.js OCR failed', { error: message });
    return { success: false, error: message, cause: nativeError || error };
  }
}

/**
 * Terminate the tesseract.js worker if one is active.
 * Safe to call even if no worker was created.
 */
async function terminateJsWorker() {
  await destroyOcrPool();
  if (!jsWorkerPromise) return;
  try {
    const worker = await jsWorkerPromise;
    if (worker && typeof worker.terminate === 'function') {
      await worker.terminate();
    }
  } catch {
    // Ignore errors during termination
  }
  jsWorkerPromise = null;
  jsWorkerLang = null;
  jsWorkerQueue = Promise.resolve();
}

function resetTesseractAvailability() {
  // FIX: Terminate the worker before dropping the reference to prevent process leak
  // Use fire-and-forget since callers expect a sync function
  terminateJsWorker().catch(() => {});
  availabilityCache = null;
  availabilityCheck = null;
  warnedUnavailable = false;
}

module.exports = {
  getTesseractBinaryPath,
  getTesseractOptions,
  isTesseractAvailable,
  getTesseractBinaryInfo,
  recognizeIfAvailable,
  resetTesseractAvailability,
  terminateJsWorker
};
