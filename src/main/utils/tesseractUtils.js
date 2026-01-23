const { execFile } = require('child_process');
const { promisify } = require('util');
const { logger: baseLogger, createLogger } = require('../../shared/logger');

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

function getTesseractBinaryPath() {
  return process.env.TESSERACT_PATH || 'tesseract';
}

function getTesseractOptions(baseOptions = {}) {
  const tesseractPath = process.env.TESSERACT_PATH;
  if (!tesseractPath) return baseOptions;
  const binary = /\s/.test(tesseractPath) ? `"${tesseractPath}"` : tesseractPath;
  return { ...baseOptions, binary };
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

  jsWorkerQueue = jsWorkerQueue.then(task, task);
  return jsWorkerQueue;
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

function resetTesseractAvailability() {
  availabilityCache = null;
  availabilityCheck = null;
  warnedUnavailable = false;
  jsWorkerPromise = null;
  jsWorkerLang = null;
  jsWorkerQueue = Promise.resolve();
}

module.exports = {
  getTesseractBinaryPath,
  getTesseractOptions,
  isTesseractAvailable,
  recognizeIfAvailable,
  resetTesseractAvailability
};
