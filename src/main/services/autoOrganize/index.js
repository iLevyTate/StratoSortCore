/**
 * Auto Organize Service
 *
 * Main export for the decomposed AutoOrganizeService.
 * Provides backward-compatible API.
 *
 * @module autoOrganize
 */

const AutoOrganizeServiceCore = require('./AutoOrganizeServiceCore');

/**
 * Create an AutoOrganizeService instance with default dependencies
 *
 * This factory function creates an AutoOrganizeService with the default
 * singleton services. Use for simple cases where manual DI is not needed.
 *
 * @returns {AutoOrganizeServiceCore} A new service instance
 */
function createWithDefaults() {
  const { container, ServiceIds } = require('../ServiceContainer');
  const AutoOrganizeServiceCore = require('./AutoOrganizeServiceCore');

  // Try to resolve from container first
  try {
    return container.resolve(ServiceIds.AUTO_ORGANIZE);
  } catch {
    // Fallback if not registered yet (e.g. during early init or tests)
    const settingsService = container.resolve(ServiceIds.SETTINGS);
    const folderMatchingService = container.resolve(ServiceIds.FOLDER_MATCHING);
    const suggestionService = container.resolve(ServiceIds.ORGANIZATION_SUGGESTION);
    const undoRedoService = container.resolve(ServiceIds.UNDO_REDO);

    return new AutoOrganizeServiceCore({
      suggestionService,
      settingsService,
      folderMatchingService,
      undoRedoService,
    });
  }
}

// Export both the class and factory function for backward compatibility
module.exports = AutoOrganizeServiceCore;
module.exports.AutoOrganizeService = AutoOrganizeServiceCore;
module.exports.createWithDefaults = createWithDefaults;
