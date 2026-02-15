/**
 * Redux State Migrations
 *
 * Handles migrating persisted Redux state between versions.
 * Ensure all migrations are idempotent and safe.
 */

import { logger } from '../../shared/logger';

// Current schema version – bump this when adding a new migration
export const CURRENT_STATE_VERSION = 2;

/**
 * Migration functions map
 * Key: Version to migrate FROM (e.g., 0 means migrate from v0 to v1)
 * Value: Function(state) => newState
 *
 * All migrations MUST be idempotent – running them twice on the same state
 * should produce the same result.
 */
const migrations = {
  // v0 → v1: Validate baseline state shape (no-op for well-formed state)
  0: (state) => {
    const migrated = { ...state };

    // Ensure top-level slices exist
    if (!migrated.ui || typeof migrated.ui !== 'object') migrated.ui = {};
    if (!migrated.files || typeof migrated.files !== 'object') migrated.files = {};
    if (!migrated.analysis || typeof migrated.analysis !== 'object') migrated.analysis = {};
    // System slice is not persisted (uses initialState defaults), but validate
    // defensively in case stale data exists from an earlier version.
    if (migrated.system && typeof migrated.system !== 'object') delete migrated.system;

    // Ensure critical arrays are arrays
    if (!Array.isArray(migrated.files.selectedFiles)) migrated.files.selectedFiles = [];
    if (!Array.isArray(migrated.files.smartFolders)) migrated.files.smartFolders = [];
    if (!Array.isArray(migrated.files.organizedFiles)) migrated.files.organizedFiles = [];
    if (!Array.isArray(migrated.analysis.results)) migrated.analysis.results = [];

    return migrated;
  },

  // v1 → v2: Remove deprecated ui.isAnalyzing (canonical source is analysisSlice)
  1: (state) => {
    const migrated = { ...state };

    if (migrated.ui) {
      migrated.ui = { ...migrated.ui };
      delete migrated.ui.isAnalyzing;
    }

    return migrated;
  }
};

/**
 * Migrate state to the latest version
 * @param {Object} state - The persisted state object
 * @returns {Object} - Migrated state object
 */
export function migrateState(state) {
  if (!state) return state;

  let migratedState = { ...state };
  let currentVersion = migratedState._version || 0;

  // If no version tag, assume version 0 (legacy)
  if (typeof currentVersion !== 'number') {
    currentVersion = 0;
  }

  if (currentVersion >= CURRENT_STATE_VERSION) {
    return migratedState;
  }

  logger.info(
    `[StateMigration] Migrating state from v${currentVersion} to v${CURRENT_STATE_VERSION}`
  );

  try {
    while (currentVersion < CURRENT_STATE_VERSION) {
      const migrationFn = migrations[currentVersion];
      if (migrationFn) {
        logger.info(
          `[StateMigration] Applying migration v${currentVersion} -> v${currentVersion + 1}`
        );
        migratedState = migrationFn(migratedState);
      }
      currentVersion++;
    }

    // Update version tag
    migratedState._version = CURRENT_STATE_VERSION;
    logger.info('[StateMigration] Migration complete');

    return migratedState;
  } catch (error) {
    logger.error('[StateMigration] Migration failed:', error);
    // In case of fatal migration error, return null to force a state reset
    // rather than loading corrupted data
    return null;
  }
}
