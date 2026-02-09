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
// Track whether worker initialization has permanently failed
let workerFailed = false;

async function getWorker() {
  // If a previous init permanently failed, don't retry inside the same thread
  if (workerFailed) {
    throw new Error('OCR worker initialization previously failed in this thread');
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
      return worker;
    } catch (error) {
      // Mark permanently failed so we don't retry in a tight loop
      workerFailed = true;
      workerPromise = null;
      workerLang = null;
      logger.error('[OcrWorker] Failed to initialize tesseract.js worker', {
        error: error.message
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
