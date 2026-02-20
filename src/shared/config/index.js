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

// NOTE: Synchronous load at require() time is intentional for startup config.
// All config values must be available before service initialization.
// If startup time becomes an issue, consider lazy-loading on first .get() call.
// Load configuration on module import
try {
  configManager.load();
} catch (loadError) {
  // Config will use schema defaults - log but don't crash
  logger.error('[Config] Failed to load configuration, using defaults:', {
    error: loadError.message
  });
}

// Log any warnings
try {
  if (configManager.getDeprecationWarnings().length > 0) {
    logger.warn('[Config] Deprecation warnings:', configManager.getDeprecationWarnings());
  }

  const validationReport =
    typeof configManager.validate === 'function' ? configManager.validate() : null;
  if (validationReport && validationReport.valid === false) {
    logger.warn('[Config] Validation errors (using defaults):', validationReport.errors);
  } else if (!validationReport && configManager.getValidationErrors().length > 0) {
    logger.warn(
      '[Config] Validation errors (using defaults):',
      configManager.getValidationErrors()
    );
  }
} catch (validationError) {
  // Non-fatal: validation warnings are informational only
  logger.debug('[Config] Validation check failed:', { error: validationError.message });
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
  validateAndLog: () => {
    const report = configManager.validate();
    if (!report.valid) {
      logger.warn('[Config] Validation errors (using defaults):', report.errors);
    }
    if (report.warnings?.length) {
      logger.warn('[Config] Deprecation warnings:', report.warnings);
    }
    return report;
  },
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
