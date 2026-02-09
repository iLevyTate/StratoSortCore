const path = require('path');

function resolveTesseractJsOptions(logger) {
  try {
    const coreFile = require.resolve('tesseract.js-core/tesseract-core.wasm.js');
    const corePath = path.dirname(coreFile);
    const isRenderer = typeof process !== 'undefined' && process.type === 'renderer';
    if (isRenderer) {
      const workerPath = require.resolve('tesseract.js/dist/worker.min.js');
      return { workerPath, corePath };
    }
    const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js');
    return { workerPath, corePath, workerBlobURL: false };
  } catch (error) {
    logger?.warn?.('[OCR] Failed to resolve tesseract.js assets', { error: error?.message });
    return null;
  }
}

module.exports = { resolveTesseractJsOptions };
