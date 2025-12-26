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
 * Valid theme values
 * Used for application color theme setting
 */
const THEME_VALUES = ['light', 'dark', 'auto', 'system'];

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
 * URL validation pattern
 * Matches: http://127.0.0.1:11434, https://localhost:11434, http://hostname:port/path
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
 * Allows alphanumeric with hyphens, underscores, dots, @, colons, slashes
 * Updated to allow single-char names and trailing special chars (e.g., "llama3:")
 */
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9\-_.@:/]*$/;

/**
 * Maximum model name length
 */
const MAX_MODEL_NAME_LENGTH = 100;

/**
 * Validate a theme value
 * @param {string} value - Value to validate
 * @returns {boolean} True if valid
 */
function isValidTheme(value) {
  return typeof value === 'string' && THEME_VALUES.includes(value);
}

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
  THEME_VALUES,
  LOGGING_LEVELS,

  // Numeric limits
  NUMERIC_LIMITS,

  // Patterns
  URL_PATTERN,
  LENIENT_URL_PATTERN,
  MODEL_NAME_PATTERN,
  MAX_MODEL_NAME_LENGTH,

  // Validation functions
  isValidTheme,
  isValidLoggingLevel,
  isValidNumericSetting,
  isValidUrl,
  isValidModelName
};
