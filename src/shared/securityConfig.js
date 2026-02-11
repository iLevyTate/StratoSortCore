/**
 * Centralized Security Configuration
 *
 * This file consolidates all security-related constants and configurations
 * that were previously hard-coded across multiple files.
 *
 * Centralizing these allows for:
 * - Easier updates without code changes across multiple files
 * - Consistent security policies across the application
 * - Potential future support for environment-based overrides
 */

// Avoid pulling Node-only deps (e.g., child_process) into the renderer bundle.
// We only need the platform string here, so read it directly from process.
const PLATFORM = typeof process !== 'undefined' && process.platform ? process.platform : 'browser';

// Import shared validation constants
const {
  LOGGING_LEVELS,
  NUMERIC_LIMITS,
  URL_PATTERN,
  MODEL_NAME_PATTERN
} = require('./validationConstants');

/**
 * Path length limits by platform
 * These are OS-imposed limits that shouldn't change
 */
const MAX_PATH_LENGTHS = {
  win32: 260, // Windows MAX_PATH
  linux: 4096, // Linux PATH_MAX
  darwin: 1024 // macOS PATH_MAX
};

/**
 * Maximum path depth to prevent deep nesting attacks
 */
const MAX_PATH_DEPTH = 100;

/**
 * Reserved Windows filenames (case-insensitive)
 * These names cannot be used as file/folder names on Windows
 */
const RESERVED_WINDOWS_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
]);

/**
 * System directories that should never be accessed
 * These paths represent sensitive system areas that could be dangerous to modify
 */
const DANGEROUS_PATHS = {
  // Unix/Linux system directories
  unix: ['/etc', '/sys', '/proc', '/dev', '/boot', '/sbin', '/bin', '/usr/sbin'],
  // Windows system directories
  windows: [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\System Volume Information',
    'C:\\Users\\All Users',
    'C:\\Boot',
    'C:\\Recovery'
  ],
  // macOS system directories
  darwin: ['/System', '/Library/System', '/private/etc', '/private/var', '/Library/Preferences']
};

/**
 * Get dangerous paths for the current platform
 * @param {string} [platform] - Platform override (defaults to PLATFORM from crossPlatformUtils)
 * @returns {string[]} Array of dangerous paths for the platform
 */
function getDangerousPaths(platform = PLATFORM) {
  const paths = [];

  // Add common Unix paths for darwin and linux
  if (platform === 'darwin' || platform === 'linux') {
    paths.push(...DANGEROUS_PATHS.unix);
  }

  // Add platform-specific paths
  if (platform === 'darwin') {
    paths.push(...DANGEROUS_PATHS.darwin);
  } else if (platform === 'win32') {
    // FIX Bug 18: Generate dangerous paths for all detected drive letters,
    // not just the hardcoded C: drive. Systems commonly have D:, E:, etc.
    const driveLetters = _getWindowsDriveLetters();
    const windowsSubPaths = [
      'Windows',
      'Program Files',
      'Program Files (x86)',
      'ProgramData',
      'System Volume Information',
      'Users\\All Users',
      'Boot',
      'Recovery'
    ];
    for (const drive of driveLetters) {
      for (const sub of windowsSubPaths) {
        paths.push(`${drive}\\${sub}`);
      }
    }
  }

  return paths;
}

/**
 * Get available Windows drive letters.
 * Uses environment variables for the primary and home drives, and always includes C:.
 * @private
 * @returns {string[]} Array of drive letter prefixes like ['C:', 'D:']
 */
function _getWindowsDriveLetters() {
  const drives = new Set();

  // Always include C: as a baseline
  drives.add('C:');

  if (typeof process !== 'undefined' && process.env) {
    // SYSTEMDRIVE is the OS installation drive (usually C:)
    const systemDrive = process.env.SYSTEMDRIVE;
    if (systemDrive) {
      drives.add(systemDrive.toUpperCase().replace(/\\$/, ''));
    }
    // HOMEDRIVE can differ from SYSTEMDRIVE on domain-joined machines
    const homeDrive = process.env.HOMEDRIVE;
    if (homeDrive) {
      drives.add(homeDrive.toUpperCase().replace(/\\$/, ''));
    }
  }

  // FIX: Enumerate all mounted drive letters so dangerous paths on D:, E:, etc.
  // are also blocked. Previous code only covered C: and env-based drives.
  try {
    const fs = require('fs');
    for (let code = 65; code <= 90; code++) {
      const letter = `${String.fromCharCode(code)}:`;
      try {
        fs.accessSync(`${letter}\\`);
        drives.add(letter);
      } catch {
        // Drive not mounted, skip
      }
    }
  } catch {
    // fs not available (browser context), fall back to env-based detection
  }

  return Array.from(drives);
}

/**
 * Keys that should never appear in user-provided objects (prototype pollution prevention)
 */
const PROTOTYPE_POLLUTION_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Allowed Electron app paths for file operations
 * Used to determine what user directories are safe to access
 */
const ALLOWED_APP_PATHS = [
  'userData', // App data directory
  'documents', // User documents
  'downloads', // Downloads
  'desktop', // Desktop
  'pictures', // Pictures
  'videos', // Videos
  'music', // Music
  'home' // Home directory
];

/**
 * Settings validation configuration
 */
const SETTINGS_VALIDATION = {
  // Keys that can be modified through the settings API
  allowedKeys: new Set([
    'textModel',
    'visionModel',
    'embeddingModel',
    // Embedding workflow controls
    'embeddingTiming',
    'defaultEmbeddingPolicy',
    'embeddingScope',
    // LLM engine settings
    'llamaGpuLayers',
    'llamaContextSize',
    'vectorDbPersistPath',
    // Chat settings
    'chatPersona',
    'chatResponseMode',
    'launchOnStartup',
    'autoOrganize',
    'backgroundMode',
    'language',
    'loggingLevel',
    'cacheSize',
    'maxBatchSize',
    'autoUpdateCheck',
    'telemetryEnabled',
    // UI settings
    'notifications',
    'notificationMode',
    'notifyOnAutoAnalysis',
    'notifyOnLowConfidence',
    'defaultSmartFolderLocation',
    'lastBrowsedPath',
    'confidenceThreshold',
    'smartFolderRoutingMode',
    // Naming convention settings
    'namingConvention',
    'dateFormat',
    'caseConvention',
    'separator',
    // Processing limits
    'maxConcurrentAnalysis',
    'maxFileSize',
    'maxImageFileSize',
    'maxDocumentFileSize',
    'maxTextFileSize',
    'analysisTimeout',
    'fileOperationTimeout',
    'retryAttempts',
    // Semantic search settings
    'autoChunkOnAnalysis', // Opt-in: generate chunk embeddings during file analysis
    'graphExpansionEnabled',
    'graphExpansionWeight',
    'graphExpansionMaxNeighbors',
    'chunkContextEnabled',
    'chunkContextMaxNeighbors',
    // UI limits
    'workflowRestoreMaxAge',
    'saveDebounceMs',
    // Deprecated settings (kept for backward compatibility)
    'smartFolderWatchEnabled'
  ]),

  // Valid values for enum fields (from shared validationConstants)
  enums: {
    loggingLevel: LOGGING_LEVELS
  },

  // Numeric field constraints (from shared validationConstants)
  numericLimits: NUMERIC_LIMITS,

  // Regex patterns for string validation (from shared validationConstants)
  patterns: {
    url: URL_PATTERN,
    modelName: MODEL_NAME_PATTERN
  }
};

/**
 * Allowed metadata fields for file operations
 */
const ALLOWED_METADATA_FIELDS = [
  'path',
  'name',
  'model',
  'updatedAt',
  'description',
  'summary',
  'fileSize',
  'mimeType',
  'fileExtension',
  'category',
  'type',
  'tags',
  'keywords',
  'entity',
  // 'type', // FIX HIGH-48: Removed duplicate 'type'
  'project',
  'date',
  'suggestedName',
  'purpose',
  'content_type',
  'contentType',
  'colors',
  'has_text',
  'subject',
  'confidence',
  // Extended fields for document conversations
  'documentType',
  'extractedText',
  'extractionMethod',
  'keyEntities',
  'dates',
  'reasoning'
];

/**
 * Rate limiting configuration
 */
const RATE_LIMITS = {
  // Maximum IPC requests per second
  maxRequestsPerSecond: 200,
  // Maximum retry attempts for failed operations
  maxRetries: 5,
  // Stale entry cleanup threshold (entries in rate limiter)
  staleEntryThreshold: 100,
  // Stale entry age (ms) before cleanup
  staleEntryAge: 60000 // 1 minute
};

/**
 * IPC receive channels that are safe to expose to renderer
 * Includes vector DB status tracking (legacy + current)
 */
const ALLOWED_RECEIVE_CHANNELS = [
  'system-metrics',
  'operation-progress',
  'app:error',
  'app:update',
  'menu-action',
  'open-semantic-search',
  'settings-changed-external',
  'operation-error', // Dead: schema+preload exist but no safeSend from main process
  'operation-complete', // Dead: schema+preload exist but no safeSend from main process
  'operation-failed', // Dead: schema+preload exist but no safeSend from main process
  'file-operation-complete', // File move/delete notifications for search invalidation
  'vectordb:status-changed', // Reserved: defined in constants but not yet sent from main
  'notification', // Toast notifications from main process
  'undo-redo:state-changed', // FIX: Undo/redo state change notifications
  'batch-results-chunk' // FIX: Batch results streaming for progressive UI updates
];

/**
 * IPC send channels that renderer can use
 */
const ALLOWED_SEND_CHANNELS = ['renderer-error-report', 'startup-continue', 'startup-quit'];

module.exports = {
  // Path security
  MAX_PATH_LENGTHS,
  MAX_PATH_DEPTH,
  RESERVED_WINDOWS_NAMES,
  DANGEROUS_PATHS,
  getDangerousPaths,
  PROTOTYPE_POLLUTION_KEYS,
  ALLOWED_APP_PATHS,

  // Settings security
  SETTINGS_VALIDATION,
  ALLOWED_METADATA_FIELDS,

  // Rate limiting
  RATE_LIMITS,

  // IPC security
  ALLOWED_RECEIVE_CHANNELS,
  ALLOWED_SEND_CHANNELS
};
