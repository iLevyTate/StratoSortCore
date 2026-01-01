/**
 * Settings Validation
 * Validates user settings to prevent invalid configurations
 */

const { DEFAULT_SETTINGS } = require('./defaultSettings');
const { PROTOTYPE_POLLUTION_KEYS } = require('./securityConfig');
const {
  THEME_VALUES,
  LENIENT_URL_PATTERN,
  LOGGING_LEVELS,
  NUMERIC_LIMITS
} = require('./validationConstants');
const {
  normalizeSlashes,
  normalizeProtocolCase,
  extractBaseUrl,
  hasProtocol
} = require('./urlUtils');
const { isValidEmbeddingModel } = require('./modelCategorization');

/**
 * Shared URL validation regex (from validationConstants)
 * Matches URLs with optional protocol (http/https), hostname/IP, optional port, optional path
 * Examples: "localhost:11434", "http://127.0.0.1:11434", "https://ollama.example.com/api"
 */
const URL_PATTERN = LENIENT_URL_PATTERN;

/**
 * Validation rules for settings
 */
const VALIDATION_RULES = {
  theme: {
    type: 'string',
    enum: THEME_VALUES,
    required: false
  },
  notifications: {
    type: 'boolean',
    required: false
  },
  defaultSmartFolderLocation: {
    type: 'string',
    minLength: 1,
    maxLength: 500,
    required: false
  },
  lastBrowsedPath: {
    type: 'string',
    maxLength: 1000,
    required: false
  },
  maxConcurrentAnalysis: {
    type: 'number',
    min: 1,
    max: 10,
    integer: true,
    required: false
  },
  autoOrganize: {
    type: 'boolean',
    required: false
  },
  backgroundMode: {
    type: 'boolean',
    required: false
  },
  launchOnStartup: {
    type: 'boolean',
    required: false
  },
  confidenceThreshold: {
    type: 'number',
    min: 0,
    max: 1,
    required: false
  },
  ollamaHost: {
    type: 'string',
    // Uses shared URL_PATTERN - allows URLs with or without protocol
    pattern: URL_PATTERN,
    maxLength: 500,
    required: false
  },
  textModel: {
    type: 'string',
    minLength: 1,
    maxLength: 200,
    required: false
  },
  visionModel: {
    type: 'string',
    minLength: 1,
    maxLength: 200,
    required: false
  },
  embeddingModel: {
    type: 'string',
    minLength: 1,
    maxLength: 200,
    required: false,
    // Pattern-based validation using modelCategorization.js
    // NOTE: changing models requires re-embedding (dimension mismatch)
    // Common models: embeddinggemma (768), mxbai-embed-large (1024), nomic-embed-text (768)
    validator: isValidEmbeddingModel,
    validatorMessage:
      'embeddingModel must be a valid embedding model (e.g., embeddinggemma, mxbai-embed-large, nomic-embed-text)'
  },
  autoUpdateOllama: {
    type: 'boolean',
    required: false
  },
  autoUpdateChromaDb: {
    type: 'boolean',
    required: false
  },
  dependencyWizardShown: {
    type: 'boolean',
    required: false
  },
  dependencyWizardLastPromptAt: {
    // ISO string (or null) — keep validation loose to avoid breaking old settings.
    type: 'string',
    maxLength: 100,
    required: false
  },
  dependencyWizardPromptIntervalDays: {
    type: 'number',
    min: 1,
    max: 365,
    integer: true,
    required: false
  },
  maxFileSize: {
    type: 'number',
    min: 1024 * 1024, // 1MB minimum
    max: 1024 * 1024 * 1024, // 1GB maximum
    integer: true,
    required: false
  },
  maxImageFileSize: {
    type: 'number',
    min: 1024 * 1024, // 1MB minimum
    max: 500 * 1024 * 1024, // 500MB maximum
    integer: true,
    required: false
  },
  maxDocumentFileSize: {
    type: 'number',
    min: 1024 * 1024, // 1MB minimum
    max: 500 * 1024 * 1024, // 500MB maximum
    integer: true,
    required: false
  },
  maxTextFileSize: {
    type: 'number',
    min: 1024 * 1024, // 1MB minimum
    max: 200 * 1024 * 1024, // 200MB maximum
    integer: true,
    required: false
  },
  analysisTimeout: {
    type: 'number',
    min: 10000, // 10 seconds minimum
    max: 600000, // 10 minutes maximum
    integer: true,
    required: false
  },
  fileOperationTimeout: {
    type: 'number',
    min: 1000, // 1 second minimum
    max: 60000, // 60 seconds maximum
    integer: true,
    required: false
  },
  maxBatchSize: {
    type: 'number',
    min: 1,
    max: 1000,
    integer: true,
    required: false
  },
  retryAttempts: {
    type: 'number',
    min: 0,
    max: 10,
    integer: true,
    required: false
  },
  workflowRestoreMaxAge: {
    type: 'number',
    min: 60000, // 1 minute minimum
    max: 24 * 60 * 60 * 1000, // 24 hours maximum
    integer: true,
    required: false
  },
  saveDebounceMs: {
    type: 'number',
    min: 100,
    max: 5000,
    integer: true,
    required: false
  },
  // Additional settings from securityConfig.allowedKeys
  language: {
    type: 'string',
    maxLength: 20,
    required: false
  },
  loggingLevel: {
    type: 'string',
    enum: LOGGING_LEVELS,
    required: false
  },
  cacheSize: {
    type: 'number',
    min: NUMERIC_LIMITS.cacheSize.min,
    max: NUMERIC_LIMITS.cacheSize.max,
    integer: true,
    required: false
  },
  autoUpdateCheck: {
    type: 'boolean',
    required: false
  },
  telemetryEnabled: {
    type: 'boolean',
    required: false
  }
};

/**
 * Validate a single setting value
 */
function validateSetting(key, value, rule) {
  const errors = [];

  // Type validation
  if (rule.type && typeof value !== rule.type) {
    errors.push(`${key} must be of type ${rule.type}, got ${typeof value}`);
    return errors;
  }

  // Custom validator function (takes precedence over enum)
  if (rule.validator && typeof rule.validator === 'function') {
    if (!rule.validator(value)) {
      const message = rule.validatorMessage || `${key} failed custom validation`;
      errors.push(message);
    }
  }
  // Enum validation (only if no custom validator)
  else if (rule.enum && !rule.enum.includes(value)) {
    errors.push(`${key} must be one of [${rule.enum.join(', ')}], got "${value}"`);
  }

  // Number validations
  if (rule.type === 'number') {
    if (rule.min !== undefined && value < rule.min) {
      errors.push(`${key} must be at least ${rule.min}, got ${value}`);
    }
    if (rule.max !== undefined && value > rule.max) {
      errors.push(`${key} must be at most ${rule.max}, got ${value}`);
    }
    if (rule.integer && !Number.isInteger(value)) {
      errors.push(`${key} must be an integer, got ${value}`);
    }
  }

  // String validations
  if (rule.type === 'string') {
    if (rule.minLength !== undefined && value.length < rule.minLength) {
      errors.push(`${key} must be at least ${rule.minLength} characters, got ${value.length}`);
    }
    if (rule.maxLength !== undefined && value.length > rule.maxLength) {
      errors.push(`${key} must be at most ${rule.maxLength} characters, got ${value.length}`);
    }
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(`${key} does not match the required pattern: ${rule.pattern}`);
    }
  }

  return errors;
}

/**
 * Validate settings object
 */
function validateSettings(settings) {
  const errors = [];
  const warnings = [];

  if (!settings || typeof settings !== 'object') {
    errors.push('Settings must be an object');
    return { valid: false, errors, warnings };
  }

  // Explicitly detect prototype-pollution keys even if they are not enumerable
  // Always warn when caller-supplied object exposes prototype-pollution keys
  const hasUnsafeProto = '__proto__' in settings;
  const hasUnsafeCtor =
    Object.prototype.hasOwnProperty.call(settings, 'constructor') &&
    settings.constructor !== Object;
  const hasUnsafePrototype = Object.prototype.hasOwnProperty.call(settings, 'prototype');
  if (hasUnsafeProto) warnings.push('Rejected unsafe key: __proto__');
  if (hasUnsafeCtor) warnings.push('Rejected unsafe key: constructor');
  if (hasUnsafePrototype) warnings.push('Rejected unsafe key: prototype');

  // Validate each setting against its rule
  for (const [key, value] of Object.entries(settings)) {
    if (PROTOTYPE_POLLUTION_KEYS.includes(key)) {
      continue;
    }
    const rule = VALIDATION_RULES[key];

    if (!rule) {
      warnings.push(`Unknown setting: ${key}`);
      continue;
    }

    if (value === undefined || value === null) {
      if (rule.required) {
        errors.push(`${key} is required but not provided`);
      }
      continue;
    }

    const fieldErrors = validateSetting(key, value, rule);
    errors.push(...fieldErrors);
  }

  // Note: Legacy cross-field threshold validations removed - now using single confidenceThreshold

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Sanitize settings by removing invalid values
 */
function sanitizeSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    return {};
  }

  const sanitized = Object.create(null);

  for (const [key, value] of Object.entries(settings)) {
    // Prevent prototype pollution
    if (PROTOTYPE_POLLUTION_KEYS.includes(key)) {
      continue;
    }

    const rule = VALIDATION_RULES[key];

    // Keep unknown settings (might be for future use)
    if (!rule) {
      sanitized[key] = value;
      continue;
    }

    // Skip null/undefined unless required
    if (value === undefined || value === null) {
      if (rule.required) {
        continue; // Will use default
      }
      sanitized[key] = value;
      continue;
    }

    // Normalize special fields before validation
    let normalizedValue = value;
    if (key === 'ollamaHost' && typeof value === 'string') {
      let s = value.trim();

      // Normalize common Windows paste mistakes (backslashes) and mixed-case protocols.
      // Examples:
      // - "HTTP://127.0.0.1:11434/" -> "http://127.0.0.1:11434"
      // - "http:\\\\127.0.0.1:11434\\api\\tags" -> "http://127.0.0.1:11434"
      s = normalizeSlashes(s);
      if (hasProtocol(s)) {
        s = normalizeProtocolCase(s);
      }

      // Remove path/query/hash and keep only protocol + host[:port]
      // (users often paste "/api/tags" or other endpoints).
      s = extractBaseUrl(s);

      normalizedValue = s;
    }

    // Validate and sanitize
    const fieldErrors = validateSetting(key, normalizedValue, rule);
    if (fieldErrors.length === 0) {
      sanitized[key] = normalizedValue;
    }
    // Invalid values are dropped (will use defaults)
  }

  // Ensure polluted keys are absent/undefined on the sanitized object
  const finalSanitized = Object.assign(Object.create(null), sanitized);
  return finalSanitized;
}

/**
 * Get default value for a setting
 */
function getDefaultValue(key) {
  // Use DEFAULT_SETTINGS directly to avoid duplication
  return DEFAULT_SETTINGS[key];
}

/**
 * Get all configurable limits with current values
 * Fixed: Use shared DEFAULT_SETTINGS to avoid duplication
 */
function getConfigurableLimits(settings) {
  // Handle null/undefined settings
  const safeSettings = settings || {};

  return {
    fileSizeLimits: {
      maxFileSize: safeSettings.maxFileSize ?? DEFAULT_SETTINGS.maxFileSize,
      maxImageFileSize: safeSettings.maxImageFileSize ?? DEFAULT_SETTINGS.maxImageFileSize,
      maxDocumentFileSize: safeSettings.maxDocumentFileSize ?? DEFAULT_SETTINGS.maxDocumentFileSize,
      maxTextFileSize: safeSettings.maxTextFileSize ?? DEFAULT_SETTINGS.maxTextFileSize
    },
    processingLimits: {
      maxConcurrentAnalysis:
        safeSettings.maxConcurrentAnalysis ?? DEFAULT_SETTINGS.maxConcurrentAnalysis,
      analysisTimeout: safeSettings.analysisTimeout ?? DEFAULT_SETTINGS.analysisTimeout,
      fileOperationTimeout:
        safeSettings.fileOperationTimeout ?? DEFAULT_SETTINGS.fileOperationTimeout,
      maxBatchSize: safeSettings.maxBatchSize ?? DEFAULT_SETTINGS.maxBatchSize,
      retryAttempts: safeSettings.retryAttempts ?? DEFAULT_SETTINGS.retryAttempts
    },
    uiLimits: {
      workflowRestoreMaxAge:
        safeSettings.workflowRestoreMaxAge ?? DEFAULT_SETTINGS.workflowRestoreMaxAge,
      saveDebounceMs: safeSettings.saveDebounceMs ?? DEFAULT_SETTINGS.saveDebounceMs
    }
  };
}

module.exports = {
  URL_PATTERN,
  VALIDATION_RULES,
  validateSettings,
  validateSetting,
  sanitizeSettings,
  getDefaultValue,
  getConfigurableLimits
};
