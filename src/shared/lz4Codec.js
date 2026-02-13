/**
 * LZ4 codec wrapper with graceful fallback when native bindings are unavailable.
 *
 * Some packaged environments (notably certain macOS/Electron distributions)
 * can fail to load `lz4-napi` native bindings. This module prevents hard
 * startup crashes by falling back to identity passthrough buffers.
 */

const toBuffer = (input) => {
  if (Buffer.isBuffer(input)) return input;
  if (input == null) return Buffer.alloc(0);
  if (ArrayBuffer.isView(input)) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  return Buffer.from(input);
};

let lz4Binding = null;
let lz4BindingError = null;

try {
  lz4Binding = require('lz4-napi');
} catch (error) {
  lz4BindingError = error;
}

const compressSync = (input) => {
  const buffer = toBuffer(input);
  if (lz4Binding && typeof lz4Binding.compressSync === 'function') {
    return lz4Binding.compressSync(buffer);
  }
  if (lz4Binding && typeof lz4Binding.compress === 'function') {
    // No sync API available; preserve behavior by returning original buffer.
    return buffer;
  }
  return buffer;
};

const uncompressSync = (input) => {
  const buffer = toBuffer(input);
  if (lz4Binding && typeof lz4Binding.uncompressSync === 'function') {
    return lz4Binding.uncompressSync(buffer);
  }
  if (lz4Binding && typeof lz4Binding.uncompress === 'function') {
    // No sync API available; preserve behavior by returning original buffer.
    return buffer;
  }
  return buffer;
};

const compress = async (input) => {
  const buffer = toBuffer(input);
  if (lz4Binding && typeof lz4Binding.compress === 'function') {
    return lz4Binding.compress(buffer);
  }
  if (lz4Binding && typeof lz4Binding.compressSync === 'function') {
    return lz4Binding.compressSync(buffer);
  }
  return buffer;
};

const uncompress = async (input) => {
  const buffer = toBuffer(input);
  if (lz4Binding && typeof lz4Binding.uncompress === 'function') {
    return lz4Binding.uncompress(buffer);
  }
  if (lz4Binding && typeof lz4Binding.uncompressSync === 'function') {
    return lz4Binding.uncompressSync(buffer);
  }
  return buffer;
};

module.exports = {
  compress,
  uncompress,
  compressSync,
  uncompressSync,
  isLz4BindingAvailable: Boolean(lz4Binding),
  lz4BindingError
};
