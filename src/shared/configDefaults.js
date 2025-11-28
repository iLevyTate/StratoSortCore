/**
 * Configuration Defaults and Environment Utilities
 * Single source of truth for environment variables, ports, and service URLs
 */

// Default service ports
const PORTS = {
  CHROMA_DB: 8000,
  OLLAMA: 11434,
  DEV_SERVER: 3000,
};

// Default service URLs
const SERVICE_URLS = {
  OLLAMA_HOST: 'http://127.0.0.1:11434',
  CHROMA_SERVER_URL: 'http://127.0.0.1:8000',
};

// Default timeout values (in milliseconds)
const TIMEOUTS = {
  STARTUP: 60000,
  HEALTH_CHECK_INTERVAL: 120000,
  ANALYSIS: 60000,
  FILE_OPERATION: 10000,
  IMAGE_ANALYSIS: 120000,
};

/**
 * Get environment variable with fallback to default
 * @param {string} key - Environment variable name
 * @param {*} defaultValue - Default value if env var is not set
 * @returns {string} The env value or default
 */
function getEnvOrDefault(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value;
}

/**
 * Parse environment variable as boolean
 * Treats 'true', '1', 'yes' (case-insensitive) as true
 * @param {string} key - Environment variable name
 * @param {boolean} defaultValue - Default value if env var is not set
 * @returns {boolean}
 */
function getEnvBool(key, defaultValue = false) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return ['true', '1', 'yes'].includes(String(value).toLowerCase().trim());
}

/**
 * Parse environment variable as integer with validation
 * @param {string} key - Environment variable name
 * @param {number} defaultValue - Default value if env var is not set or invalid
 * @returns {number}
 */
function getEnvInt(key, defaultValue) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    return defaultValue;
  }
  return parsed;
}

/**
 * Get Ollama host from environment or default
 * @returns {string} Ollama host URL
 */
function getOllamaHost() {
  return getEnvOrDefault('OLLAMA_HOST', SERVICE_URLS.OLLAMA_HOST);
}

/**
 * Get ChromaDB server URL from environment or default
 * @returns {string} ChromaDB server URL
 */
function getChromaServerUrl() {
  return getEnvOrDefault('CHROMA_SERVER_URL', SERVICE_URLS.CHROMA_SERVER_URL);
}

/**
 * Get ChromaDB port from environment or default
 * @returns {number} ChromaDB port
 */
function getChromaPort() {
  return getEnvInt('CHROMA_SERVER_PORT', PORTS.CHROMA_DB);
}

/**
 * Get Ollama port from environment or default
 * @returns {number} Ollama port
 */
function getOllamaPort() {
  return getEnvInt('OLLAMA_PORT', PORTS.OLLAMA);
}

/**
 * Check if running in development mode
 * @returns {boolean}
 */
function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

module.exports = {
  PORTS,
  SERVICE_URLS,
  TIMEOUTS,
  getEnvOrDefault,
  getEnvBool,
  getEnvInt,
  getOllamaHost,
  getChromaServerUrl,
  getChromaPort,
  getOllamaPort,
  isDevelopment,
};
