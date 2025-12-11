/**
 * Configuration Defaults and Environment Utilities
 * Single source of truth for environment variables, ports, and service URLs
 */

const { logger } = require('./logger');

// Default service ports
const PORTS = {
  CHROMA_DB: 8000,
  OLLAMA: 11434,
  DEV_SERVER: 3000
};

// Default service URLs
// Note: Using 127.0.0.1 instead of localhost for cross-platform IPv4/IPv6 consistency
const SERVICE_URLS = {
  OLLAMA_HOST: 'http://127.0.0.1:11434',
  CHROMA_SERVER_URL: 'http://127.0.0.1:8000'
};

// Default timeout values (in milliseconds)
const TIMEOUTS = {
  STARTUP: 60000,
  HEALTH_CHECK_INTERVAL: 120000,
  ANALYSIS: 60000,
  FILE_OPERATION: 10000,
  IMAGE_ANALYSIS: 120000
};

// Valid protocols for service URLs
const VALID_PROTOCOLS = ['http', 'https'];

// Port number validation range
const PORT_RANGE = {
  MIN: 1,
  MAX: 65535
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

/**
 * Check if running in production mode
 * @returns {boolean}
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validate a URL string for service configuration
 * @param {string} urlString - The URL to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.requireHttps - Require HTTPS protocol (default: false)
 * @param {number[]} options.allowedPorts - List of allowed ports (optional)
 * @returns {Object} Validation result with { valid, url, error }
 */
function validateServiceUrl(urlString, options = {}) {
  if (!urlString || typeof urlString !== 'string') {
    return {
      valid: false,
      url: null,
      error: 'URL is required and must be a string'
    };
  }

  try {
    const parsed = new URL(urlString.trim());

    // Validate protocol
    const protocol = parsed.protocol.replace(':', '');
    if (!VALID_PROTOCOLS.includes(protocol)) {
      return {
        valid: false,
        url: null,
        error: `Invalid protocol "${protocol}". Must be http or https.`
      };
    }

    if (options.requireHttps && protocol !== 'https') {
      return {
        valid: false,
        url: null,
        error: 'HTTPS protocol is required for this service.'
      };
    }

    // Validate hostname
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { valid: false, url: null, error: 'Hostname is required.' };
    }

    // Validate hostname length (RFC 1123)
    if (parsed.hostname.length > 253) {
      return {
        valid: false,
        url: null,
        error: 'Hostname exceeds maximum length of 253 characters.'
      };
    }

    // Validate port if specified
    if (parsed.port) {
      const port = parseInt(parsed.port, 10);
      if (isNaN(port) || port < PORT_RANGE.MIN || port > PORT_RANGE.MAX) {
        return {
          valid: false,
          url: null,
          error: `Port must be between ${PORT_RANGE.MIN} and ${PORT_RANGE.MAX}.`
        };
      }

      if (options.allowedPorts && !options.allowedPorts.includes(port)) {
        return {
          valid: false,
          url: null,
          error: `Port ${port} is not in the list of allowed ports.`
        };
      }
    }

    // Return normalized URL
    return {
      valid: true,
      url: parsed.href,
      protocol,
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : protocol === 'https' ? 443 : 80
    };
  } catch (error) {
    return {
      valid: false,
      url: null,
      error: `Invalid URL format: ${error.message}`
    };
  }
}

/**
 * Get and validate ChromaDB server URL from environment
 * Returns validated URL or default with validation result
 * @returns {Object} { url, valid, error, isDefault }
 */
function getValidatedChromaServerUrl() {
  const envUrl = process.env.CHROMA_SERVER_URL;

  if (!envUrl) {
    return {
      url: SERVICE_URLS.CHROMA_SERVER_URL,
      valid: true,
      error: null,
      isDefault: true
    };
  }

  const result = validateServiceUrl(envUrl);

  if (!result.valid) {
    // Log warning but return default
    logger.warn(`[Config] Invalid CHROMA_SERVER_URL: ${result.error}. Using default.`);
    return {
      url: SERVICE_URLS.CHROMA_SERVER_URL,
      valid: false,
      error: result.error,
      isDefault: true
    };
  }

  return {
    url: result.url,
    valid: true,
    error: null,
    isDefault: false,
    protocol: result.protocol,
    hostname: result.hostname,
    port: result.port
  };
}

/**
 * Get and validate Ollama host URL from environment
 * Returns validated URL or default with validation result
 * @returns {Object} { url, valid, error, isDefault }
 */
function getValidatedOllamaHost() {
  const envUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST;

  if (!envUrl) {
    return {
      url: SERVICE_URLS.OLLAMA_HOST,
      valid: true,
      error: null,
      isDefault: true
    };
  }

  const result = validateServiceUrl(envUrl);

  if (!result.valid) {
    // Log warning but return default
    logger.warn(`[Config] Invalid OLLAMA_BASE_URL: ${result.error}. Using default.`);
    return {
      url: SERVICE_URLS.OLLAMA_HOST,
      valid: false,
      error: result.error,
      isDefault: true
    };
  }

  return {
    url: result.url,
    valid: true,
    error: null,
    isDefault: false,
    protocol: result.protocol,
    hostname: result.hostname,
    port: result.port
  };
}

/**
 * Validate all critical environment variables and return a report
 * Useful for startup diagnostics
 * @returns {Object} Validation report for all critical env vars
 */
function validateEnvironment() {
  const report = {
    valid: true,
    warnings: [],
    errors: [],
    config: {}
  };

  // Check NODE_ENV
  const nodeEnv = process.env.NODE_ENV;
  if (!nodeEnv) {
    report.warnings.push('NODE_ENV is not set. Defaulting to development behavior.');
  } else if (!['development', 'production', 'test'].includes(nodeEnv)) {
    report.warnings.push(
      `NODE_ENV="${nodeEnv}" is not a standard value. Expected: development, production, or test.`
    );
  }
  report.config.nodeEnv = nodeEnv || 'undefined';

  // Check ChromaDB URL
  const chromaResult = getValidatedChromaServerUrl();
  report.config.chromaServerUrl = chromaResult.url;
  report.config.chromaIsDefault = chromaResult.isDefault;
  if (!chromaResult.valid) {
    report.warnings.push(`ChromaDB URL validation failed: ${chromaResult.error}`);
  }

  // Check Ollama URL
  const ollamaResult = getValidatedOllamaHost();
  report.config.ollamaHost = ollamaResult.url;
  report.config.ollamaIsDefault = ollamaResult.isDefault;
  if (!ollamaResult.valid) {
    report.warnings.push(`Ollama URL validation failed: ${ollamaResult.error}`);
  }

  // Set overall validity
  report.valid = report.errors.length === 0;

  return report;
}

module.exports = {
  PORTS,
  SERVICE_URLS,
  TIMEOUTS,
  VALID_PROTOCOLS,
  PORT_RANGE,
  getEnvOrDefault,
  getEnvBool,
  getEnvInt,
  getOllamaHost,
  getChromaServerUrl,
  getChromaPort,
  getOllamaPort,
  isDevelopment,
  isProduction,
  validateServiceUrl,
  getValidatedChromaServerUrl,
  getValidatedOllamaHost,
  validateEnvironment
};
