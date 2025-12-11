/**
 * Cross-Platform Utilities
 *
 * Provides consistent cross-platform command spawning and abstracts OS-specific logic.
 * This module centralizes all platform-specific code to ensure reliable behavior
 * across Windows, macOS, and Linux.
 *
 * Key features:
 * - Safe cross-platform command spawning with proper PATH resolution
 * - Executable name resolution (adds .cmd/.bat suffix on Windows)
 * - Platform-specific accelerator key handling
 * - Consistent shell behavior across platforms
 * - UNC path support on Windows
 *
 * @module crossPlatformUtils
 */

const { spawn: nodeSpawn } = require('child_process');
const path = require('path');
const os = require('os');

// ============================================================================
// Platform Detection
// ============================================================================

/**
 * Current platform identifier
 * @type {string}
 */
const PLATFORM = process.platform;

/**
 * Check if running on Windows
 * @type {boolean}
 */
const isWindows = PLATFORM === 'win32';

/**
 * Check if running on macOS
 * @type {boolean}
 */
const isMacOS = PLATFORM === 'darwin';

/**
 * Check if running on Linux
 * @type {boolean}
 */
const isLinux = PLATFORM === 'linux';

/**
 * Check if running on a Unix-like system (macOS or Linux)
 * @type {boolean}
 */
const isUnix = isMacOS || isLinux;

// ============================================================================
// Executable Name Resolution
// ============================================================================

/**
 * Map of common executables and their Windows-specific variants
 * @type {Object.<string, string>}
 */
const WINDOWS_EXECUTABLE_EXTENSIONS = {
  npm: '.cmd',
  npx: '.cmd',
  yarn: '.cmd',
  pnpm: '.cmd',
  chromadb: '.cmd',
  pip: '.exe',
  pip3: '.exe'
  // Most Python-related tools installed via pip
};

/**
 * Get the executable name with proper extension for the current platform
 *
 * On Windows, many executables from package managers (npm, yarn) are actually
 * .cmd files. This function automatically adds the correct extension.
 *
 * @param {string} baseName - The base name of the executable (e.g., 'npm', 'python')
 * @param {Object} [options={}] - Options
 * @param {string} [options.windowsExtension] - Override the Windows extension (.cmd, .exe, .bat)
 * @returns {string} The executable name with proper extension
 *
 * @example
 * getExecutableName('npm')  // Windows: 'npm.cmd', Unix: 'npm'
 * getExecutableName('python')  // 'python' on all platforms
 * getExecutableName('myapp', { windowsExtension: '.exe' })  // Windows: 'myapp.exe', Unix: 'myapp'
 */
function getExecutableName(baseName, options = {}) {
  if (!isWindows) {
    return baseName;
  }

  // Check if custom extension is provided
  if (options.windowsExtension) {
    return baseName + options.windowsExtension;
  }

  // Check if this is a known executable that needs an extension
  const knownExtension = WINDOWS_EXECUTABLE_EXTENSIONS[baseName.toLowerCase()];
  if (knownExtension) {
    return baseName + knownExtension;
  }

  return baseName;
}

/**
 * Get Python command candidates for the current platform
 *
 * On Windows, the 'py' launcher is preferred as it handles multiple Python versions.
 * On Unix, python3 is preferred for explicit Python 3 usage.
 *
 * @returns {Array<{command: string, args: string[]}>} Array of Python command candidates
 *
 * @example
 * const candidates = getPythonCandidates();
 * // Windows: [{ command: 'py', args: ['-3'] }, { command: 'python3', args: [] }, ...]
 * // Unix: [{ command: 'python3', args: [] }, { command: 'python', args: [] }]
 */
function getPythonCandidates() {
  if (isWindows) {
    return [
      { command: 'py', args: ['-3'] },
      { command: 'python3', args: [] },
      { command: 'python', args: [] }
    ];
  }
  return [
    { command: 'python3', args: [] },
    { command: 'python', args: [] }
  ];
}

/**
 * Get the NVIDIA SMI executable name for GPU detection
 * @returns {string} nvidia-smi executable name
 */
function getNvidiaSmiExecutable() {
  return isWindows ? 'nvidia-smi.exe' : 'nvidia-smi';
}

// ============================================================================
// Cross-Platform Spawn
// ============================================================================

/**
 * Default spawn options with platform-appropriate settings
 * @type {Object}
 */
const DEFAULT_SPAWN_OPTIONS = {
  windowsHide: true, // Hide console window on Windows
  timeout: 30000, // 30 second default timeout
  encoding: 'utf8'
};

/**
 * Spawn a command with cross-platform compatibility
 *
 * This function provides several improvements over Node's built-in spawn:
 * - Automatically handles executable extensions on Windows
 * - Provides consistent shell behavior (defaults to shell: false for security)
 * - Handles PATH resolution correctly on all platforms
 * - Returns a Promise with stdout, stderr, and exit code
 *
 * SECURITY NOTE: shell: false is the default for security. Only use shell: true
 * when absolutely necessary and never with user-provided input.
 *
 * @param {string} command - The command to execute
 * @param {string[]} [args=[]] - Arguments for the command
 * @param {Object} [options={}] - Spawn options
 * @param {number} [options.timeout] - Timeout in milliseconds (default: 30000)
 * @param {boolean} [options.shell] - Use shell (default: false for security)
 * @param {string} [options.encoding] - Output encoding (default: 'utf8')
 * @param {string} [options.cwd] - Working directory
 * @param {Object} [options.env] - Environment variables
 * @param {boolean} [options.windowsHide] - Hide console window on Windows (default: true)
 * @param {boolean} [options.resolveExecutable] - Auto-resolve executable extension (default: true)
 * @returns {Promise<{status: number|null, stdout: string, stderr: string, error?: Error, timedOut?: boolean}>}
 *
 * @example
 * // Simple command
 * const result = await crossSpawn('node', ['--version']);
 *
 * // With options
 * const result = await crossSpawn('npm', ['install'], {
 *   cwd: '/path/to/project',
 *   timeout: 60000
 * });
 */
async function crossSpawn(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const {
      timeout = DEFAULT_SPAWN_OPTIONS.timeout,
      encoding = DEFAULT_SPAWN_OPTIONS.encoding,
      shell = false, // SECURITY: Default to false
      resolveExecutable = true,
      ...spawnOptions
    } = options;

    // Resolve executable name if needed (adds .cmd on Windows)
    let resolvedCommand = command;
    if (resolveExecutable && !shell) {
      // Only resolve if not using shell (shell handles PATH resolution itself)
      resolvedCommand = getExecutableName(command);
    }

    // Set platform-appropriate defaults
    const finalOptions = {
      windowsHide: DEFAULT_SPAWN_OPTIONS.windowsHide,
      shell,
      ...spawnOptions
    };

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timeoutId = null;

    try {
      let child;
      try {
        child = nodeSpawn(resolvedCommand, args, finalOptions);
      } catch (spawnError) {
        // spawn() itself failed (command not found, etc.)
        if (!resolved) {
          resolved = true;
          resolve({
            status: null,
            stdout: '',
            stderr: '',
            error: spawnError
          });
        }
        return;
      }

      // Set up timeout
      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try {
              // On Windows, killing a process tree requires taskkill
              if (isWindows) {
                try {
                  const { spawnSync } = require('child_process');
                  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                    windowsHide: true,
                    timeout: 1000
                  });
                } catch (e) {
                  child.kill('SIGTERM');
                }
              } else {
                child.kill('SIGTERM');
              }
            } catch (e) {
              // Process may have already exited
            }
            resolve({
              status: null,
              stdout,
              stderr,
              error: new Error(`Command timed out after ${timeout}ms`),
              timedOut: true
            });
          }
        }, timeout);
      }

      // Capture stdout
      if (child.stdout) {
        child.stdout.on('data', (data) => {
          if (encoding) {
            stdout += data.toString(encoding);
          } else {
            stdout += data;
          }
        });
      }

      // Capture stderr
      if (child.stderr) {
        child.stderr.on('data', (data) => {
          if (encoding) {
            stderr += data.toString(encoding);
          } else {
            stderr += data;
          }
        });
      }

      // Handle process exit
      child.on('close', (code, signal) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          resolve({
            status: code,
            stdout,
            stderr,
            signal
          });
        }
      });

      // Handle process error
      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          if (timeoutId) clearTimeout(timeoutId);
          resolve({
            status: null,
            stdout,
            stderr,
            error
          });
        }
      });
    } catch (error) {
      if (!resolved) {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        resolve({
          status: null,
          stdout: '',
          stderr: '',
          error
        });
      }
    }
  });
}

/**
 * Get spawn options with platform-appropriate defaults
 *
 * @param {Object} [options={}] - Additional options
 * @param {boolean} [options.useShell] - Force shell usage
 * @returns {Object} Spawn options
 */
function getSpawnOptions(options = {}) {
  const { useShell = false, ...rest } = options;

  return {
    windowsHide: true,
    shell: useShell,
    ...rest
  };
}

// ============================================================================
// Accelerator Key Helpers
// ============================================================================

/**
 * Get the primary modifier key for the current platform
 *
 * @returns {string} 'Cmd' for macOS, 'Ctrl' for Windows/Linux
 */
function getModifierKey() {
  return isMacOS ? 'Cmd' : 'Ctrl';
}

/**
 * Get an accelerator key combination for the current platform
 *
 * Electron supports 'CmdOrCtrl' which is recommended for most cases.
 * Use this function when you need explicit platform-specific accelerators.
 *
 * @param {string} key - The key (e.g., 'Q', 'S', 'Z')
 * @param {Object} [options={}] - Options
 * @param {boolean} [options.shift] - Include Shift modifier
 * @param {boolean} [options.alt] - Include Alt modifier
 * @param {boolean} [options.useCmdOrCtrl] - Use Electron's CmdOrCtrl (default: false)
 * @returns {string} The accelerator string (e.g., 'Cmd+Q', 'Ctrl+Shift+S')
 *
 * @example
 * getAccelerator('Q')  // macOS: 'Cmd+Q', Windows/Linux: 'Ctrl+Q'
 * getAccelerator('S', { shift: true })  // macOS: 'Cmd+Shift+S', Windows/Linux: 'Ctrl+Shift+S'
 * getAccelerator('S', { useCmdOrCtrl: true })  // 'CmdOrCtrl+S'
 */
function getAccelerator(key, options = {}) {
  const { shift = false, alt = false, useCmdOrCtrl = false } = options;

  const parts = [];

  if (useCmdOrCtrl) {
    parts.push('CmdOrCtrl');
  } else {
    parts.push(getModifierKey());
  }

  if (shift) {
    parts.push('Shift');
  }

  if (alt) {
    parts.push('Alt');
  }

  parts.push(key);

  return parts.join('+');
}

/**
 * Get the quit accelerator for the current platform
 * @returns {string} 'Cmd+Q' for macOS, 'Ctrl+Q' for Windows/Linux
 */
function getQuitAccelerator() {
  return getAccelerator('Q');
}

/**
 * Get the settings accelerator for the current platform
 * @returns {string} 'Cmd+,' for macOS, 'Ctrl+,' for Windows/Linux
 */
function getSettingsAccelerator() {
  return getAccelerator(',');
}

// ============================================================================
// Path Handling
// ============================================================================

/**
 * Normalize a path for the current platform
 *
 * Handles:
 * - Forward/backward slash conversion
 * - Removal of redundant separators
 * - Resolution of . and .. components
 *
 * @param {string} inputPath - Path to normalize
 * @returns {string} Normalized path
 */
function normalizePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return inputPath;
  }
  return path.normalize(inputPath);
}

/**
 * Join path segments using the platform's path separator
 *
 * IMPORTANT: Always use this instead of string concatenation for paths.
 *
 * @param {...string} segments - Path segments to join
 * @returns {string} Joined path
 */
function joinPath(...segments) {
  return path.join(...segments);
}

/**
 * Resolve a path to an absolute path
 *
 * @param {...string} segments - Path segments to resolve
 * @returns {string} Absolute path
 */
function resolvePath(...segments) {
  return path.resolve(...segments);
}

/**
 * Check if a path is a Windows UNC path
 *
 * UNC paths start with \\\\ or // and reference network shares.
 *
 * @param {string} inputPath - Path to check
 * @returns {boolean} True if path is a UNC path
 */
function isUNCPath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return false;
  }
  // UNC paths start with \\ or //
  return /^[/\\]{2}[^/\\]/.test(inputPath);
}

/**
 * Safely join paths handling UNC paths on Windows
 *
 * Regular path.join() can break UNC paths by removing leading slashes.
 * This function preserves UNC path prefixes.
 *
 * @param {string} basePath - Base path (may be UNC)
 * @param {...string} segments - Additional path segments
 * @returns {string} Joined path with UNC prefix preserved
 */
function safePathJoin(basePath, ...segments) {
  if (!basePath || typeof basePath !== 'string') {
    return path.join(...segments);
  }

  // Check for UNC path
  const uncMatch = basePath.match(/^([/\\]{2}[^/\\]+[/\\][^/\\]+)/);
  if (uncMatch) {
    // Preserve UNC prefix
    const uncPrefix = uncMatch[1];
    const remainingPath = basePath.slice(uncPrefix.length);
    const joined = path.join(remainingPath, ...segments);
    return uncPrefix + joined;
  }

  return path.join(basePath, ...segments);
}

/**
 * Get the home directory for the current user
 * @returns {string} Home directory path
 */
function getHomeDirectory() {
  return os.homedir();
}

/**
 * Get the platform-specific path separator
 * @returns {string} Path separator ('\\' on Windows, '/' on Unix)
 */
function getPathSeparator() {
  return path.sep;
}

// ============================================================================
// Process Management
// ============================================================================

/**
 * Get the kill command configuration for the current platform
 *
 * @param {number} pid - Process ID to kill
 * @param {boolean} [force=false] - Force kill (SIGKILL on Unix, /f on Windows)
 * @returns {{command: string, args: string[]}} Kill command configuration
 */
function getKillCommand(pid, force = false) {
  if (isWindows) {
    return {
      command: 'taskkill',
      args: force ? ['/pid', String(pid), '/f', '/t'] : ['/pid', String(pid), '/t']
    };
  }
  return {
    command: 'kill',
    args: force ? ['-KILL', String(pid)] : ['-TERM', String(pid)]
  };
}

/**
 * Get the sleep/delay command for the current platform
 *
 * @param {number} seconds - Duration to sleep
 * @returns {{command: string, args: string[]}} Sleep command configuration
 */
function getSleepCommand(seconds) {
  if (isWindows) {
    return {
      command: 'timeout',
      args: ['/t', String(Math.ceil(seconds)), '/nobreak']
    };
  }
  return {
    command: 'sleep',
    args: [String(seconds)]
  };
}

// ============================================================================
// Tray and Icon Configuration
// ============================================================================

/**
 * Get platform-specific tray icon configuration
 *
 * @param {string} iconsBasePath - Base path to the icons directory
 * @returns {{iconPath: string, isTemplate: boolean}} Tray icon configuration
 */
function getTrayIconConfig(iconsBasePath) {
  if (isWindows) {
    return {
      iconPath: path.join(iconsBasePath, 'win', 'icon.ico'),
      isTemplate: false
    };
  }

  if (isMacOS) {
    return {
      // macOS template images for menu bar
      iconPath: path.join(iconsBasePath, 'png', '24x24.png'),
      isTemplate: true
    };
  }

  // Linux
  return {
    iconPath: path.join(iconsBasePath, 'png', '16x16.png'),
    isTemplate: false
  };
}

// ============================================================================
// Platform Feature Detection
// ============================================================================

/**
 * Check if the platform supports a specific feature
 *
 * @param {string} feature - Feature name to check
 * @returns {boolean} True if feature is supported
 *
 * Features:
 * - 'jumpList': Windows Jump List
 * - 'dockMenu': macOS Dock menu
 * - 'templateImage': macOS template images
 * - 'appIndicator': Linux app indicator
 * - 'unity': Unity desktop integration
 * - 'iconutil': macOS iconutil for .icns generation
 */
function isFeatureSupported(feature) {
  const featureMap = {
    jumpList: isWindows,
    dockMenu: isMacOS,
    templateImage: isMacOS,
    appIndicator: isLinux,
    unity: isLinux,
    iconutil: isMacOS,
    // Windows-specific features
    taskbarProgress: isWindows,
    flashFrame: isWindows,
    // macOS-specific features
    vibrancy: isMacOS,
    trafficLightPosition: isMacOS,
    // Cross-platform with platform-specific behavior
    tray: true,
    autoUpdater: true
  };

  return featureMap[feature] ?? false;
}

/**
 * Get platform-specific documentation for a feature
 *
 * @param {string} feature - Feature name
 * @returns {string} Documentation or warning about platform support
 */
function getFeatureDocumentation(feature) {
  const docs = {
    jumpList: isWindows
      ? 'Windows Jump List is supported.'
      : 'Windows Jump List is not available on this platform.',
    iconutil: isMacOS
      ? 'macOS iconutil is available for .icns generation.'
      : 'macOS iconutil is not available. Use alternative icon generation for this platform.',
    dockMenu: isMacOS
      ? 'macOS Dock menu is supported.'
      : 'macOS Dock menu is not available on this platform.'
  };

  return docs[feature] || `No documentation available for feature: ${feature}`;
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
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
  getSpawnOptions,
  DEFAULT_SPAWN_OPTIONS,

  // Accelerator Keys
  getModifierKey,
  getAccelerator,
  getQuitAccelerator,
  getSettingsAccelerator,

  // Path Handling
  normalizePath,
  joinPath,
  resolvePath,
  isUNCPath,
  safePathJoin,
  getHomeDirectory,
  getPathSeparator,

  // Process Management
  getKillCommand,
  getSleepCommand,

  // Tray and Icons
  getTrayIconConfig,

  // Feature Detection
  isFeatureSupported,
  getFeatureDocumentation
};
