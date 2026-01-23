/**
 * Batch Progress Reporter
 *
 * Handles IPC progress updates and chunked result delivery.
 */

const { safeSend } = require('../ipcWrappers');

function sendOperationProgress(getMainWindow, payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    safeSend(win.webContents, 'operation-progress', payload);
  }
}

async function sendChunkedResults(getMainWindow, batchId, results, maxPerChunk) {
  const win = getMainWindow();
  if (!win || win.isDestroyed()) {
    return { sent: false, totalChunks: 0 };
  }

  if (!Array.isArray(results)) {
    return { sent: false, totalChunks: 0 };
  }

  if (!Number.isInteger(maxPerChunk) || maxPerChunk <= 0) {
    return { sent: false, totalChunks: 0 };
  }

  if (results.length === 0) {
    return { sent: true, totalChunks: 0 };
  }

  const totalChunks = Math.ceil(results.length / maxPerChunk);

  for (let i = 0; i < results.length; i += maxPerChunk) {
    const chunk = results.slice(i, i + maxPerChunk);
    const chunkIndex = Math.floor(i / maxPerChunk);

    safeSend(win.webContents, 'batch-results-chunk', {
      batchId,
      chunk,
      chunkIndex,
      totalChunks,
      isLast: chunkIndex === totalChunks - 1
    });

    await new Promise((resolve) => setImmediate(resolve));
  }

  return { sent: true, totalChunks };
}

module.exports = {
  sendOperationProgress,
  sendChunkedResults
};
