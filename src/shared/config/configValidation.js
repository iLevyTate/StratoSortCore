/**
 * Configuration Validation Module
 *
 * Validation functions for configuration values.
 *
 * @module config/configValidation
 */

const { validateServiceUrl } = require('../configDefaults');

/**
 * Configuration validation errors
 */
class ConfigValidationError extends Error {
  constructor(key, value, message) {
    super(`Configuration error for '${key}': ${message} (got: ${JSON.stringify(value)})`);
    this.name = 'ConfigValidationError';
    this.key = key;
    this.value = value;
  }
}

/**
 * Parse environment variable value based on type
 * @param {string} value - Raw environment variable value
 * @param {Object} schemaDef - Schema definition for the config key
 * @returns {*} Parsed value
 */
function parseEnvValue(value, schemaDef) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  switch (schemaDef.type) {
    case 'boolean':
      return ['true', '1', 'yes'].includes(String(value).toLowerCase().trim());
    case 'number': {
      const num = Number(value);
      return isNaN(num) ? undefined : num;
    }
    case 'url':
      return String(value).trim();
    case 'enum': {
      const enumVal = String(value).toLowerCase().trim();
      return schemaDef.values.includes(enumVal) ? enumVal : undefined;
    }
    case 'array':
      try {
        return JSON.parse(value);
      } catch {
        return value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    case 'string':
    default:
      return String(value).trim();
  }
}

/**
 * Get environment variable value, supporting array of env var names
 * @param {string|string[]} envVars - Environment variable name(s)
 * @returns {string|undefined} Environment variable value
 */
function getEnvVar(envVars) {
  if (!envVars) return undefined;

  const vars = Array.isArray(envVars) ? envVars : [envVars];
  for (const varName of vars) {
    const value = process.env[varName];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Validate a configuration value against its schema
 * @param {string} key - Configuration key
 * @param {*} value - Value to validate
 * @param {Object} schemaDef - Schema definition
 * @returns {Object} Validation result { valid, value, error }
 */
function validateValue(key, value, schemaDef) {
  // Use default if value is undefined
  if (value === undefined || value === null) {
    if (schemaDef.required) {
      return { valid: false, error: 'Required value is missing' };
    }
    return { valid: true, value: schemaDef.default };
  }

  // Type validation
  switch (schemaDef.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        return { valid: false, error: `Expected boolean, got ${typeof value}` };
      }
      break;

    case 'number':
      if (typeof value !== 'number' || isNaN(value)) {
        return { valid: false, error: `Expected number, got ${typeof value}` };
      }
      if (schemaDef.min !== undefined && value < schemaDef.min) {
        return {
          valid: false,
          error: `Value ${value} is below minimum ${schemaDef.min}`
        };
      }
      if (schemaDef.max !== undefined && value > schemaDef.max) {
        return {
          valid: false,
          error: `Value ${value} exceeds maximum ${schemaDef.max}`
        };
      }
      break;

    case 'string':
      if (typeof value !== 'string') {
        return { valid: false, error: `Expected string, got ${typeof value}` };
      }
      if (schemaDef.pattern && !schemaDef.pattern.test(value)) {
        return { valid: false, error: 'Value does not match required pattern' };
      }
      break;

    case 'url': {
      if (typeof value !== 'string') {
        return {
          valid: false,
          error: `Expected URL string, got ${typeof value}`
        };
      }
      const urlValidation = validateServiceUrl(value);
      if (!urlValidation.valid) {
        return { valid: false, error: urlValidation.error };
      }
      break;
    }

    case 'enum':
      if (!schemaDef.values.includes(value)) {
        return {
          valid: false,
          error: `Value must be one of: ${schemaDef.values.join(', ')}`
        };
      }
      break;

    case 'array':
      if (!Array.isArray(value)) {
        return { valid: false, error: `Expected array, got ${typeof value}` };
      }
      break;
  }

  return { valid: true, value };
}

module.exports = {
  ConfigValidationError,
  parseEnvValue,
  getEnvVar,
  validateValue
};
