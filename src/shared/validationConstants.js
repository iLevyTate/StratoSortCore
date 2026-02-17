/**
 * Validation Constants - Single Source of Truth
 *
 * This module provides centralized validation rules used across:
 * - IPC validation schemas (validationSchemas.js)
 * - Settings validation (settingsValidation.js)
 * - Security config (securityConfig.js)
 * - Config schema (configSchema.js)
 * - Settings IPC handlers (settings.js)
 *
 * @module shared/validationConstants
 */

/**
 * Valid logging level values
 * Used for application logging verbosity
 */
const LOGGING_LEVELS = ['error', 'warn', 'info', 'debug'];

/**
 * Numeric field constraints
 * Used for settings that accept numeric values
 */
const NUMERIC_LIMITS = {
  cacheSize: { min: 0, max: 100000 },
  maxBatchSize: { min: 1, max: 1000 }
};

/**
 * Notification mode values
 */
const NOTIFICATION_MODES = ['both', 'ui', 'tray', 'none'];

/**
 * File naming conventions
 */
const NAMING_CONVENTIONS = [
  'subject-date',
  'date-subject',
  'project-subject-date',
  'category-subject',
  'keep-original'
];

/**
 * Case conventions for filenames
 */
const CASE_CONVENTIONS = [
  'kebab-case',
  'snake_case',
  'camelCase',
  'PascalCase',
  'lowercase',
  'UPPERCASE'
];

/**
 * Smart folder routing modes
 */
const SMART_FOLDER_ROUTING_MODES = ['auto', 'llm', 'embedding', 'hybrid'];

/**
 * Filename separator pattern (reject unsafe path characters)
 */
const SEPARATOR_PATTERN = /^[^/\\:*?"<>|]+$/;

/**
 * URL validation pattern
 * Matches: http://127.0.0.1:8080, https://localhost:3000, http://hostname:port/path
 * Supports IP addresses, localhost, and hostnames with optional port and path
 */
const URL_PATTERN =
  /^https?:\/\/(?:\[[0-9a-f:]+\]|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:\d{1,5})?(\/.*)?$/i;

/**
 * Lenient URL pattern (allows missing protocol)
 * Used for user input that may omit http://
 */
const LENIENT_URL_PATTERN =
  /^(?:https?:\/\/)?(?:\[[0-9a-f:]+\]|[\w.-]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/i;

/**
 * Model name validation pattern
 * Accepts common local GGUF filename characters (including spaces, +, and parentheses)
 * while still blocking traversal and dangerous shell/path metacharacters.
 *
 * Allowed examples:
 * - "Llama-3.2-3B-Instruct-Q4_K_M.gguf"
 * - "Qwen2.5 7B Instruct (Q4_K_M).gguf"
 * - "nomic-embed-text-v1.5.gguf"
 *
 * Rejected examples:
 * - "../evil.gguf" (path traversal)
 * - "model;rm -rf /" (shell metacharacters)
 */
// eslint-disable-next-line no-control-regex
const MODEL_NAME_PATTERN = /^(?!.*\.\.)(?!.*[<>"|?*\x00-\x1f])[a-zA-Z0-9][a-zA-Z0-9\-_.@:/+() ]*$/;

/**
 * Maximum model name length
 */
const MAX_MODEL_NAME_LENGTH = 100;

/**
 * Validate a logging level value
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid
 */
function isValidLoggingLevel(value) {
  return typeof value === 'string' && LOGGING_LEVELS.includes(value);
}

/**
 * Validate a numeric value against defined limits
 * @param {string} field - Field name (e.g., 'cacheSize', 'maxBatchSize')
 * @param {number} value - Value to validate
 * @returns {boolean} True if valid
 */
function isValidNumericSetting(field, value) {
  const limits = NUMERIC_LIMITS[field];
  if (!limits) return false;
  return Number.isInteger(value) && value >= limits.min && value <= limits.max;
}

/**
 * Validate a URL string
 * @param {string} url - URL to validate
 * @param {boolean} [lenient=false] - Allow missing protocol
 * @returns {boolean} True if valid
 */
function isValidUrl(url, lenient = false) {
  if (!url || typeof url !== 'string') return false;
  const pattern = lenient ? LENIENT_URL_PATTERN : URL_PATTERN;
  return pattern.test(url.trim());
}

/**
 * Validate a model name
 * @param {string} name - Model name to validate
 * @returns {boolean} True if valid
 */
function isValidModelName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length > MAX_MODEL_NAME_LENGTH) return false;
  return MODEL_NAME_PATTERN.test(name);
}

module.exports = {
  // Enum values
  LOGGING_LEVELS,
  NOTIFICATION_MODES,
  NAMING_CONVENTIONS,
  CASE_CONVENTIONS,
  SMART_FOLDER_ROUTING_MODES,

  // Numeric limits
  NUMERIC_LIMITS,

  // Patterns
  URL_PATTERN,
  LENIENT_URL_PATTERN,
  MODEL_NAME_PATTERN,
  MAX_MODEL_NAME_LENGTH,
  SEPARATOR_PATTERN,

  // Validation functions
  isValidLoggingLevel,
  isValidNumericSetting,
  isValidUrl,
  isValidModelName
};
