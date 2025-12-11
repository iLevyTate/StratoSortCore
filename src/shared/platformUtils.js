/**
 * Platform Utilities
 *
 * Centralized module for platform-specific logic to improve cross-platform reliability.
 * Consolidates scattered process.platform checks into reusable functions.
 *
 * This module re-exports utilities from crossPlatformUtils.js and provides
 * additional legacy-compatible APIs for existing code.
 *
 * @see crossPlatformUtils.js for the comprehensive cross-platform implementation
 */

// Import core utilities from crossPlatformUtils
const {
  // Platform Detection
  PLATFORM,
  isWindows,
  isMacOS,
  isLinux,
  isUnix,

  // Executable Resolution
  getExecutableName,
  getPythonCandidates,
  getNvidiaSmiExecutable,

  // Cross-Platform Spawn
  crossSpawn,

  // Accelerator Keys
  getModifierKey,
  getAccelerator,
  getQuitAccelerator: crossGetQuitAccelerator,
  getSettingsAccelerator,

  // Path Handling
  normalizePath: crossNormalizePath,
  joinPath,
  resolvePath,
  isUNCPath,
  safePathJoin,
  getHomeDirectory,
  getPathSeparator: crossGetPathSeparator,

  // Process Management
  getKillCommand: crossGetKillCommand,
  getSleepCommand: crossGetSleepCommand,

  // Feature Detection
  isFeatureSupported,
  getFeatureDocumentation
} = require('./crossPlatformUtils');

// ============================================================================
// Legacy-Compatible APIs
// ============================================================================

/**
 * Get npm executable name for the current platform
 * @returns {string} npm executable
 */
function getNpmCommand() {
  return getExecutableName('npm');
}

/**
 * Get ChromaDB CLI executable name from node_modules
 * @returns {string} chromadb executable
 */
function getChromaDbBinName() {
  return getExecutableName('chromadb');
}

/**
 * Get NVIDIA SMI executable for GPU detection
 * @returns {string} nvidia-smi executable
 */
function getNvidiaSmiCommand() {
  return getNvidiaSmiExecutable();
}

/**
 * Get sleep/delay command for the current platform
 * @param {number} seconds - Seconds to sleep
 * @returns {Object} Command configuration { cmd, args }
 */
function getSleepCommand(seconds) {
  const result = crossGetSleepCommand(seconds);
  return { cmd: result.command, args: result.args };
}

/**
 * Get process kill command for the current platform
 * @param {number} pid - Process ID to kill
 * @param {boolean} [force=false] - Force kill
 * @returns {Object} Command configuration { cmd, args }
 */
function getKillCommand(pid, force = false) {
  const result = crossGetKillCommand(pid, force);
  return { cmd: result.command, args: result.args };
}

/**
 * Check if shell: true should be used for spawn
 *
 * SECURITY NOTE: This returns true on Windows for backward compatibility,
 * but new code should use crossSpawn() which handles executable resolution
 * without requiring shell: true.
 *
 * @param {boolean} [forceShell=false] - Force shell usage
 * @returns {boolean}
 * @deprecated Use crossSpawn() which handles PATH resolution safely without shell
 */
function shouldUseShell(forceShell = false) {
  // Note: With crossSpawn and getExecutableName, shell is no longer needed
  // for most cases. This is kept for backward compatibility.
  return forceShell || isWindows;
}

/**
 * Get keyboard shortcut modifier for the current platform
 * @returns {string} 'Cmd' for macOS, 'Ctrl' for others
 */
function getShortcutModifier() {
  return getModifierKey();
}

/**
 * Get quit accelerator for the current platform
 * @returns {string} Keyboard accelerator string
 */
function getQuitAccelerator() {
  return crossGetQuitAccelerator();
}

/**
 * Get home directory for the current user
 * @returns {string} Home directory path
 */
function getHomeDir() {
  return getHomeDirectory();
}

/**
 * Get platform-specific path separator
 * @returns {string} Path separator
 */
function getPathSeparator() {
  return crossGetPathSeparator();
}

/**
 * Normalize a path for the current platform
 * @param {string} inputPath - Path to normalize
 * @returns {string} Normalized path
 */
function normalizePath(inputPath) {
  return crossNormalizePath(inputPath);
}

/**
 * Get spawn options with platform-appropriate defaults
 * @param {Object} [options={}] - Additional options
 * @returns {Object} Spawn options
 */
function getSpawnOptions(options = {}) {
  return {
    windowsHide: true,
    shell: shouldUseShell(options.forceShell),
    ...options
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  // Platform detection
  PLATFORM,
  isWindows,
  isMacOS,
  isLinux,
  isUnix,

  // Command helpers (legacy API)
  getNpmCommand,
  getChromaDbBinName,
  getNvidiaSmiCommand,
  getSleepCommand,
  getKillCommand,

  // Process helpers
  shouldUseShell,
  getSpawnOptions,

  // UI helpers
  getShortcutModifier,
  getQuitAccelerator,

  // Path helpers
  getHomeDir,
  getPathSeparator,
  normalizePath,

  // New cross-platform utilities (recommended for new code)
  crossSpawn,
  getExecutableName,
  getPythonCandidates,
  getAccelerator,
  getSettingsAccelerator,
  getModifierKey,
  joinPath,
  resolvePath,
  isUNCPath,
  safePathJoin,
  isFeatureSupported,
  getFeatureDocumentation
};
