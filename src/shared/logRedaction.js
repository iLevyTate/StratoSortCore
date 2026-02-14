/**
 * Log redaction for troubleshooting exports
 *
 * Redacts sensitive data from log files before users upload them for support.
 * Removes/obscures: file paths, user directories, analysis content.
 *
 * @module shared/logRedaction
 */

// Windows: C:\... or UNC \\server\share
const WIN_ABS_PATH = /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g;
const WIN_UNC_PATH = /\\\\[^\\]+\\[^\\]+(?:\\[^\\]*)*/g;
// Unix: /home/..., /Users/...
const UNIX_ABS_PATH = /\/(?:[^\s\\/:*?"<>|]+\/)+[^\s\\/:*?"<>|]*/g;

// Keys whose values contain document analysis output (redact entirely - may have PII)
const ANALYSIS_KEYS = new Set([
  'subject',
  'summary',
  'extractedText',
  'extracted_text',
  'content',
  'tags',
  'category',
  'purpose',
  'reasoning',
  'entity',
  'project',
  'documentType',
  'keyEntities',
  'amounts'
]);

// Path-like keys
const PATH_KEYS = new Set([
  'path',
  'filePath',
  'file_path',
  'source',
  'destination',
  'old_path',
  'new_path',
  'originalPath',
  'logFilePath',
  'userDataPath',
  'basePath',
  'dir',
  'cwd'
]);

/**
 * Redact a string value: replace paths and sensitive patterns
 * @param {string} str
 * @param {object} [options]
 * @param {boolean} [options.keepFilename=true] - If true, keep last path segment for debugging
 * @returns {string}
 */
function redactString(str, options = {}) {
  if (typeof str !== 'string') return str;
  const { keepFilename = true } = options;

  let out = str;
  // Windows paths
  out = out.replace(WIN_ABS_PATH, (match) => {
    const parts = match.split(/[/\\]/);
    const filename = parts[parts.length - 1] || match;
    return keepFilename ? `[REDACTED_PATH]/${filename}` : '[REDACTED_PATH]';
  });
  out = out.replace(WIN_UNC_PATH, () => '[REDACTED_PATH]');
  // Unix paths
  out = out.replace(UNIX_ABS_PATH, (match) => {
    const parts = match.split('/').filter(Boolean);
    const filename = parts[parts.length - 1] || match;
    return keepFilename ? `[REDACTED_PATH]/${filename}` : '[REDACTED_PATH]';
  });
  return out;
}

/**
 * Redact a primitive or object recursively
 * @param {*} value
 * @param {string} [key] - Parent key name for context
 * @param {object} [options]
 * @returns {*}
 */
function redactValue(value, key, options = {}) {
  if (value == null) return value;

  const keyLower = typeof key === 'string' ? key.toLowerCase() : '';

  if (typeof value === 'string') {
    if (PATH_KEYS.has(keyLower)) {
      const parts = value.split(/[/\\]/);
      const filename = parts[parts.length - 1] || value;
      return options.keepFilename !== false ? `[REDACTED_PATH]/${filename}` : '[REDACTED_PATH]';
    }
    if (ANALYSIS_KEYS.has(keyLower)) {
      return '[REDACTED_ANALYSIS]';
    }
    return redactString(value, options);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, options));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactValue(v, k, options);
    }
    return out;
  }

  return value;
}

/**
 * Redact a single JSONL log line
 * @param {string} line
 * @param {object} [options]
 * @returns {string} Redacted line (or original if not valid JSON)
 */
function redactLogLine(line, options = {}) {
  const trimmed = line.trim();
  if (!trimmed) return line;

  try {
    const obj = JSON.parse(trimmed);
    const redacted = redactValue(obj, undefined, options);
    return JSON.stringify(redacted) + '\n';
  } catch {
    // Not JSON - treat as plain text and redact paths
    return redactString(trimmed, options) + '\n';
  }
}

/**
 * Redact entire log file content
 * @param {string} content - Raw log file content
 * @param {object} [options]
 * @param {boolean} [options.keepFilename=true] - Keep filename in path redaction for debugging
 * @returns {string} Redacted content
 */
function redactLogContent(content, options = {}) {
  if (typeof content !== 'string') return '';
  const lines = content.split(/\r?\n/);
  return lines.map((line) => redactLogLine(line, options)).join('');
}

module.exports = {
  redactString,
  redactValue,
  redactLogLine,
  redactLogContent,
  PATH_KEYS,
  ANALYSIS_KEYS
};
