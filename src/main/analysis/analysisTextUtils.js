const { CHUNKING } = require('../../shared/performanceConstants');

function getMaxChunkableTextLength() {
  const chunkSize = Number.isFinite(CHUNKING.CHUNK_SIZE)
    ? Math.max(200, CHUNKING.CHUNK_SIZE)
    : 1000;
  const overlap = Number.isFinite(CHUNKING.OVERLAP) ? Math.max(0, CHUNKING.OVERLAP) : 200;
  const maxChunks = Number.isFinite(CHUNKING.MAX_CHUNKS) ? Math.max(1, CHUNKING.MAX_CHUNKS) : 80;
  const step = Math.max(1, chunkSize - Math.min(overlap, chunkSize - 1));
  return chunkSize + step * (maxChunks - 1);
}

function normalizeExtractedTextForStorage(text) {
  if (typeof text !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\u0000/g, '').trim();
  if (!cleaned) return null;
  const maxLen = getMaxChunkableTextLength();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen);
}

module.exports = {
  getMaxChunkableTextLength,
  normalizeExtractedTextForStorage
};
