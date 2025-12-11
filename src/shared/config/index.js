/**
 * Configuration Module Index
 *
 * Main entry point for the configuration system.
 * Creates singleton instance and exports convenience methods.
 *
 * @module config
 */

const { logger } = require('../logger');
const ConfigurationManager = require('./ConfigurationManager');
const { CONFIG_SCHEMA, SENSITIVE_KEYS, DEPRECATED_MAPPINGS } = require('./configSchema');
const { ConfigValidationError } = require('./configValidation');

// Singleton instance
const configManager = new ConfigurationManager();

// Load configuration on module import
configManager.load();

// Log any warnings
if (configManager.getDeprecationWarnings().length > 0) {
  logger.warn('[Config] Deprecation warnings:', configManager.getDeprecationWarnings());
}

if (configManager.getValidationErrors().length > 0) {
  logger.warn('[Config] Validation errors (using defaults):', configManager.getValidationErrors());
}

// Export both the manager instance and convenience methods
module.exports = {
  // Configuration manager instance
  config: configManager,

  // Convenience methods
  get: (path, defaultValue) => configManager.get(path, defaultValue),
  getCategory: (category) => configManager.getCategory(category),
  getAll: () => configManager.getAll(),
  isDevelopment: () => configManager.isDevelopment(),
  isProduction: () => configManager.isProduction(),
  isTest: () => configManager.isTest(),
  isCI: () => configManager.isCI(),
  validate: () => configManager.validate(),
  dump: (options) => configManager.dump(options),
  getSchema: () => configManager.getSchema(),
  override: (path, value) => configManager.override(path, value),
  reset: () => configManager.reset(),

  // Schema and types for reference
  CONFIG_SCHEMA,
  ConfigValidationError,
  SENSITIVE_KEYS,
  DEPRECATED_MAPPINGS
};
