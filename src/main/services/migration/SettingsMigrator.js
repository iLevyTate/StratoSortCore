/**
 * SettingsMigrator - Migrates settings schema versions
 *
 * This service normalizes settings keys and fills defaults when schema changes.
 *
 * @module services/migration/SettingsMigrator
 */

const { createLogger } = require('../../../shared/logger');
const { AI_DEFAULTS, SETTINGS_SCHEMA_VERSION } = require('../../../shared/constants');

const logger = createLogger('SettingsMigrator');

// Current settings schema version
const CURRENT_SCHEMA_VERSION = SETTINGS_SCHEMA_VERSION;

// Setting key migrations: old key -> new key (null = remove)
const KEY_MIGRATIONS = {
  llamaTextModel: 'textModel',
  llamaVisionModel: 'visionModel',
  llamaEmbeddingModel: 'embeddingModel',
  // Legacy Ollama/ChromaDB keys (replaced by in-process node-llama-cpp + Orama)
  ollamaHost: null,
  autoUpdateOllama: null,
  autoUpdateChromaDb: null,
  enableChromaLearningSync: null,
  enableChromaLearningDryRun: null
};

// Default values for new settings
const NEW_DEFAULTS = {
  textModel: AI_DEFAULTS.TEXT?.MODEL || 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  visionModel: AI_DEFAULTS.IMAGE?.MODEL || 'llava-v1.6-mistral-7b-Q4_K_M.gguf',
  embeddingModel: AI_DEFAULTS.EMBEDDING?.MODEL || 'nomic-embed-text-v1.5-Q8_0.gguf',
  llamaGpuLayers: -1, // Auto-detect
  llamaContextSize: 8192,
  vectorDbPersistPath: 'vector-db', // Relative to userData
  settingsSchemaVersion: CURRENT_SCHEMA_VERSION
};

class SettingsMigrator {
  constructor(settingsService) {
    this._settingsService = settingsService;
    this._migrationLog = [];
  }

  async _loadSettings() {
    if (typeof this._settingsService?._loadRaw === 'function') {
      return this._settingsService._loadRaw();
    }
    return this._settingsService.load();
  }

  /**
   * Check if migration is needed
   * @returns {Promise<boolean>}
   */
  async needsMigration() {
    try {
      const settings = await this._loadSettings();
      const version = settings?.settingsSchemaVersion || 1;

      // Check for old keys that need migration
      const hasOldKeys = Object.keys(KEY_MIGRATIONS).some((key) => {
        return settings?.[key] !== undefined && KEY_MIGRATIONS[key] !== null;
      });

      // Check for Ollama-era model names (contain ':' tag separator)
      const modelKeys = ['textModel', 'visionModel', 'embeddingModel'];
      const hasOllamaNames = modelKeys.some((key) => {
        const val = settings?.[key];
        return typeof val === 'string' && val.includes(':') && !val.endsWith('.gguf');
      });

      return version < CURRENT_SCHEMA_VERSION || hasOldKeys || hasOllamaNames;
    } catch (error) {
      logger.warn('[SettingsMigrator] Error checking migration status:', error.message);
      return false;
    }
  }

  /**
   * Perform settings migration
   * @returns {Promise<{success: boolean, migrated: string[], errors: string[]}>}
   */
  async migrate() {
    this._migrationLog = [];
    const errors = [];
    const migrated = [];

    try {
      logger.info('[SettingsMigrator] Starting settings migration...');

      const settings = await this._loadSettings();
      const currentVersion = settings?.settingsSchemaVersion || 1;

      // Check if Ollama-era model names need cleanup (even at current version)
      const modelKeys = ['textModel', 'visionModel', 'embeddingModel'];
      const hasOllamaNames = modelKeys.some((key) => {
        const val = settings?.[key];
        return typeof val === 'string' && val.includes(':') && !val.endsWith('.gguf');
      });

      if (currentVersion >= CURRENT_SCHEMA_VERSION && !hasOllamaNames) {
        logger.info('[SettingsMigrator] Settings already at current version');
        return { success: true, migrated: [], errors: [] };
      }

      const newSettings = { ...settings };

      // Migrate keys
      for (const [oldKey, newKey] of Object.entries(KEY_MIGRATIONS)) {
        if (settings?.[oldKey] !== undefined) {
          if (newKey === null) {
            // Remove deprecated key
            delete newSettings[oldKey];
            migrated.push(`Removed deprecated setting: ${oldKey}`);
            this._log(`Removed: ${oldKey}`);
          } else if (newSettings[newKey] === undefined) {
            // Migrate to new key
            newSettings[newKey] = settings[oldKey];
            delete newSettings[oldKey];
            migrated.push(`Migrated: ${oldKey} -> ${newKey}`);
            this._log(`Migrated: ${oldKey} -> ${newKey} = ${settings[oldKey]}`);
          }
        }
      }

      // Replace Ollama-era model names (contain ':' tag separator) with GGUF defaults.
      // e.g. 'llama3.2:latest' → 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf'
      const modelDefaults = {
        textModel: NEW_DEFAULTS.textModel,
        visionModel: NEW_DEFAULTS.visionModel,
        embeddingModel: NEW_DEFAULTS.embeddingModel
      };
      for (const [key, defaultValue] of Object.entries(modelDefaults)) {
        const current = newSettings[key];
        if (typeof current === 'string' && current.includes(':') && !current.endsWith('.gguf')) {
          newSettings[key] = defaultValue;
          migrated.push(`Replaced Ollama-era model name: ${key} (${current} → ${defaultValue})`);
          this._log(`Ollama cleanup: ${key} = ${current} → ${defaultValue}`);
        }
      }

      // Add new defaults for missing settings
      for (const [key, value] of Object.entries(NEW_DEFAULTS)) {
        if (newSettings[key] === undefined) {
          newSettings[key] = value;
          migrated.push(`Added default: ${key}`);
          this._log(`Added default: ${key} = ${value}`);
        }
      }

      // Update schema version
      newSettings.settingsSchemaVersion = CURRENT_SCHEMA_VERSION;

      // Save migrated settings
      await this._settingsService.save(newSettings);

      logger.info('[SettingsMigrator] Migration completed', {
        migratedCount: migrated.length,
        fromVersion: currentVersion,
        toVersion: CURRENT_SCHEMA_VERSION
      });

      return { success: true, migrated, errors };
    } catch (error) {
      logger.error('[SettingsMigrator] Migration failed:', error);
      errors.push(error.message);
      return { success: false, migrated, errors };
    }
  }

  /**
   * Get migration log
   * @returns {string[]}
   */
  getMigrationLog() {
    return [...this._migrationLog];
  }

  /**
   * Validate current settings
   * @returns {Promise<{valid: boolean, issues: string[]}>}
   */
  async validateSettings() {
    const issues = [];

    try {
      const settings = await this._loadSettings();

      // Check for deprecated settings that shouldn't exist
      const deprecatedKeys = [];
      for (const key of deprecatedKeys) {
        if (settings?.[key] !== undefined) {
          issues.push(`Deprecated setting still present: ${key}`);
        }
      }

      // Check for required new settings
      const requiredKeys = ['textModel', 'embeddingModel'];
      for (const key of requiredKeys) {
        if (!settings?.[key]) {
          issues.push(`Missing required setting: ${key}`);
        }
      }

      // Validate schema version
      if ((settings?.settingsSchemaVersion || 0) < CURRENT_SCHEMA_VERSION) {
        issues.push(`Settings schema out of date (v${settings?.settingsSchemaVersion || 1})`);
      }

      return {
        valid: issues.length === 0,
        issues
      };
    } catch (error) {
      return {
        valid: false,
        issues: [`Validation error: ${error.message}`]
      };
    }
  }

  _log(message) {
    this._migrationLog.push(`[${new Date().toISOString()}] ${message}`);
  }
}

// Singleton
let instance = null;

function getInstance(settingsService) {
  if (!instance) {
    if (!settingsService) {
      const { getInstance: getSettingsService } = require('../SettingsService');
      settingsService = getSettingsService();
    }
    instance = new SettingsMigrator(settingsService);
  }
  return instance;
}

function createInstance(settingsService) {
  return new SettingsMigrator(settingsService);
}

module.exports = {
  SettingsMigrator,
  getInstance,
  createInstance,
  CURRENT_SCHEMA_VERSION
};
