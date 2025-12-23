/**
 * Files IPC Handlers
 *
 * This file has been decomposed into focused modules in the ./files/ directory.
 * This wrapper maintains backward compatibility.
 *
 * Structure:
 * - files/index.js - Main composition
 * - files/batchOrganizeHandler.js - Batch operations (~400 lines)
 * - files/fileOperationHandlers.js - Move, copy, delete (~250 lines)
 * - files/fileSelectionHandlers.js - File selection dialog (~150 lines)
 * - files/folderHandlers.js - Folder operations (~130 lines)
 * - files/shellHandlers.js - Shell operations (~50 lines)
 *
 * Note: Validation schemas are centralized in ../validationSchemas.js
 *
 * @module ipc/files
 */

// Re-export from decomposed module
module.exports = require('./files/index');
