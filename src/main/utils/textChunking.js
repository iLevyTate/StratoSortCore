/**
 * Deterministic text chunking utility for semantic search.
 *
 * Produces overlapping, bounded chunks suitable for embedding and retrieval.
 * Char-based chunking keeps implementation simple and avoids heavy tokenizers.
 *
 * @module main/utils/textChunking
 */

/**
 * @typedef {Object} TextChunk
 * @property {number} index
 * @property {number} charStart
 * @property {number} charEnd
 * @property {string} text
 */

/**
 * Chunk text with overlap.
 *
 * @param {string} input
 * @param {Object} [options]
 * @param {number} [options.chunkSize=1000]
 * @param {number} [options.overlap=200]
 * @param {number} [options.maxChunks=80]
 * @returns {TextChunk[]}
 */
function chunkText(input, options = {}) {
  const { chunkSize = 1000, overlap = 200, maxChunks = 80 } = options;

  if (input == null) return [];
  if (typeof input !== 'string') {
    throw new TypeError('chunkText: input must be a string');
  }
  const text = input;
  if (!text) return [];

  const size = Number.isFinite(chunkSize) ? Math.max(200, Math.floor(chunkSize)) : 1000;
  const ov = Number.isFinite(overlap) ? Math.max(0, Math.floor(overlap)) : 200;
  const step = Math.max(1, size - Math.min(ov, size - 1));
  const max = Number.isFinite(maxChunks) ? Math.max(1, Math.floor(maxChunks)) : 80;

  const chunks = [];
  let idx = 0;
  for (let start = 0; start < text.length && idx < max; start += step) {
    const end = Math.min(text.length, start + size);
    const slice = text.slice(start, end);

    // Preserve deterministic offsets even when trimming whitespace
    const trimmed = slice.trim();
    if (trimmed) {
      const leadingWhitespace = slice.length - slice.trimStart().length;
      const charStart = start + leadingWhitespace;
      const charEnd = charStart + trimmed.length;

      chunks.push({
        index: idx,
        charStart,
        charEnd,
        text: trimmed
      });
      idx += 1;
    }

    if (end >= text.length) break;
  }

  return chunks;
}

module.exports = {
  chunkText
};
