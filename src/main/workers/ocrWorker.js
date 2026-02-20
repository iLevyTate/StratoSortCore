const { createLogger } = require('../../shared/logger');
const { resolveTesseractJsOptions } = require('../utils/tesseractJsPaths');

// In Node worker_threads, WorkerGlobalScope may exist and mislead tesseract.js
// into using browser worker code. Force node mode by clearing it.
if (typeof WorkerGlobalScope !== 'undefined' && typeof process !== 'undefined') {
  try {
    global.WorkerGlobalScope = undefined;
  } catch {
    // Best-effort only
  }
}

const logger = createLogger('OcrWorker');

let workerPromise = null;
let workerLang = null;
// Track init failure count (allow up to 3 retries before permanent failure)
let workerFailCount = 0;
const MAX_WORKER_INIT_RETRIES = 3;

async function getWorker() {
  if (workerFailCount >= MAX_WORKER_INIT_RETRIES) {
    throw new Error(`OCR worker initialization failed ${workerFailCount} times, giving up`);
  }
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    try {
      const { createWorker } = require('tesseract.js');
      const workerOptions = resolveTesseractJsOptions(logger);
      if (!workerOptions) {
        throw new Error('tesseract.js assets unavailable');
      }
      const worker = await createWorker('eng', 1, {
        ...workerOptions,
        errorHandler: (err) => {
          logger.warn('[OCR] Worker error', { error: err?.message || String(err) });
        }
      });
      workerLang = 'eng';
      workerFailCount = 0;
      return worker;
    } catch (error) {
      workerFailCount++;
      workerPromise = null;
      workerLang = null;
      logger.error('[OcrWorker] Failed to initialize tesseract.js worker', {
        error: error.message,
        attempt: workerFailCount,
        maxRetries: MAX_WORKER_INIT_RETRIES
      });
      throw error;
    }
  })();
  return workerPromise;
}

async function ensureLanguage(worker, lang) {
  if (workerLang === lang) return;
  if (typeof worker.reinitialize === 'function') {
    await worker.reinitialize(lang);
  } else {
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
  }
  workerLang = lang;
}

module.exports = async function runOcrTask(payload = {}) {
  const { input, options = {} } = payload || {};

  let worker;
  try {
    worker = await getWorker();
  } catch (initError) {
    // Return structured error so the caller (tesseractUtils) can fall back
    // instead of letting the error propagate as an uncaught exception
    return { text: '', error: initError.message };
  }

  const lang = options.lang || 'eng';

  try {
    await ensureLanguage(worker, lang);

    const params = {};
    if (typeof options.psm === 'number') {
      params.tessedit_pageseg_mode = String(options.psm);
    }
    if (Object.keys(params).length > 0) {
      await worker.setParameters(params);
    }

    const result = await worker.recognize(input);
    const text = result?.data?.text || '';
    logger.debug('[OcrWorker] OCR complete', { length: text.length });
    return { text };
  } catch (error) {
    logger.warn('[OcrWorker] OCR recognition failed', { error: error.message });
    return { text: '', error: error.message };
  }
};
