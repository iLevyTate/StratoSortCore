const {
  sanitizePath,
  normalizePathForIndex,
  getCanonicalFileId,
  sanitizeMetadata
} = require('../pathSanitization');
const { nowIso } = require('../timeUtils');
const { getErrorMessage, ERROR_CODES } = require('../errorHandlingUtils');
const { normalizeText, normalizeOptionalText } = require('./text');

/**
 * Sanitize and normalize a path value.
 * Unlike a plain normalizePath (which only resolves separators/dots), this
 * runs full security sanitization (null-byte removal, traversal rejection).
 *
 * Named distinctly to avoid confusion with the basic normalizePath in
 * crossPlatformUtils which only calls path.normalize().
 */
function sanitizePathValue(value) {
  if (typeof value !== 'string') return '';
  try {
    return sanitizePath(value);
  } catch {
    return '';
  }
}

function normalizePathKey(value) {
  return normalizePathForIndex(value);
}

/**
 * @deprecated Use {@link getCanonicalFileId} from pathSanitization or
 * {@link getSemanticFileId} from fileIdUtils directly.
 */
function normalizeFileId(filePath, isImage = false) {
  return getCanonicalFileId(filePath, isImage);
}

/**
 * Classify error by message string for the analysis pipeline.
 * Covers AI-specific categories (MODEL_NOT_FOUND, AI_ENGINE_ERROR, OUT_OF_MEMORY)
 * that the OS-level errorClassifier.js does not handle.
 *
 * For system/OS error classification by error code, use
 * {@link module:shared/errorClassifier.getErrorCategory} instead.
 */
function classifyErrorType(message) {
  if (!message) return 'UNKNOWN';
  const msg = String(message).toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('network') || msg.includes('connection') || msg.includes('econnrefused'))
    return 'NETWORK';
  if (msg.includes('not found') || msg.includes('enoent')) return 'FILE_NOT_FOUND';
  if (msg.includes('model') && (msg.includes('not found') || msg.includes('unknown')))
    return 'MODEL_NOT_FOUND';
  if (msg.includes('llama') || msg.includes('ai engine')) return 'AI_ENGINE_ERROR';
  if (msg.includes('memory') || msg.includes('oom')) return 'OUT_OF_MEMORY';
  if (msg.includes('too large') || msg.includes('size limit')) return 'FILE_TOO_LARGE';
  if (msg.includes('permission') || msg.includes('access denied')) return 'PERMISSION_DENIED';
  if (msg.includes('unsupported') || msg.includes('invalid format')) return 'UNSUPPORTED_FORMAT';
  return 'UNKNOWN';
}

function isRetryableErrorType(errorType) {
  return ['TIMEOUT', 'NETWORK', 'AI_ENGINE_ERROR'].includes(errorType);
}

function normalizeError(error, context = {}) {
  const message = getErrorMessage(error);
  const errorType = context.errorType || classifyErrorType(message);
  const isRetryable =
    context.isRetryable !== undefined
      ? Boolean(context.isRetryable)
      : isRetryableErrorType(errorType);
  const code = error?.code || context.code || ERROR_CODES.UNKNOWN_ERROR;
  return {
    message,
    code,
    errorType,
    isRetryable,
    details: context.details
  };
}

function normalizeKeywords(keywords, options = {}) {
  if (!Array.isArray(keywords)) return [];
  const { max = 15 } = options;
  const normalized = [];
  const seen = new Set();
  for (const entry of keywords) {
    const cleaned = normalizeText(entry, { maxLength: 50, collapseWhitespace: true, trim: true });
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(cleaned);
    if (normalized.length >= max) break;
  }
  return normalized;
}

function normalizeEmbeddingMetadata(meta = {}) {
  if (!meta || typeof meta !== 'object') return {};
  const normalized = {
    ...meta,
    path: sanitizePathValue(meta.path),
    name: normalizeText(meta.name, { maxLength: 255 }),
    category: normalizeText(meta.category, { maxLength: 100 }),
    subject: normalizeText(meta.subject, { maxLength: 200 }),
    summary: normalizeText(meta.summary, { maxLength: 1000 }),
    tags: normalizeKeywords(meta.tags, { max: 15 }),
    keywords: normalizeKeywords(meta.keywords, { max: 15 }),
    keyEntities: normalizeKeywords(meta.keyEntities, { max: 20 }),
    type: normalizeText(meta.type, { maxLength: 100 }),
    model: normalizeText(meta.model, { maxLength: 100 }),
    fileExtension: normalizeText(meta.fileExtension, { maxLength: 20 }),
    fileSize: Number.isFinite(meta.fileSize) ? meta.fileSize : undefined,
    updatedAt: meta.updatedAt || nowIso()
  };

  return sanitizeMetadata(normalized);
}

function normalizeChunkMetadata(meta = {}) {
  if (!meta || typeof meta !== 'object') return {};
  const normalized = {
    ...meta,
    fileId: normalizeText(meta.fileId, { maxLength: 2048 }),
    path: sanitizePathValue(meta.path),
    name: normalizeText(meta.name, { maxLength: 255 }),
    chunkIndex: Number.isInteger(meta.chunkIndex) ? meta.chunkIndex : undefined,
    charStart: Number.isFinite(meta.charStart) ? meta.charStart : undefined,
    charEnd: Number.isFinite(meta.charEnd) ? meta.charEnd : undefined,
    snippet: normalizeText(meta.snippet, { maxLength: 500 }),
    model: normalizeText(meta.model, { maxLength: 100 }),
    updatedAt: meta.updatedAt || nowIso()
  };

  return sanitizeMetadata(normalized);
}

module.exports = {
  normalizeText,
  normalizeOptionalText,
  sanitizePathValue,
  /** @deprecated Use sanitizePathValue — this alias will be removed. */
  normalizePath: sanitizePathValue,
  normalizePathKey,
  normalizeFileId,
  normalizeError,
  classifyErrorType,
  isRetryableErrorType,
  normalizeKeywords,
  normalizeEmbeddingMetadata,
  normalizeChunkMetadata
};
