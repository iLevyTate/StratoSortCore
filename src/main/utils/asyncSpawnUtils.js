const { spawn } = require('child_process');
const { logger } = require('../../shared/logger');
const { isWindows, shouldUseShell } = require('../../shared/platformUtils');

logger.setContext('AsyncSpawnUtils');

/**
 * Async utilities to replace blocking spawnSync calls
 * Prevents UI freezing during startup checks
 */

/**
 * Execute a command asynchronously with timeout protection
 * @param {string} command - Command to execute
 * @param {string[]} args - Arguments for the command
 * @param {object} options - Spawn options
 * @returns {Promise<{status: number, stdout: string, stderr: string, error?: Error}>}
 */
async function asyncSpawn(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const timeout = options.timeout || 5000;
    const encoding = options.encoding || 'utf8';

    // Remove timeout from options to pass to spawn
    const spawnOptions = { ...options };
    delete spawnOptions.timeout;
    delete spawnOptions.encoding;

    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timeoutId = null;

    try {
      let child;
      try {
        child = spawn(command, args, spawnOptions);
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
      if (timeout) {
        timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            try {
              child.kill('SIGTERM');
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
 * Check if Python module is available (async version)
 * @param {string} moduleName - Python module to check
 * @returns {Promise<boolean>}
 */
async function hasPythonModuleAsync(moduleName) {
  // Use centralized platform utils for Python commands
  const pythonCommands = isWindows
    ? [
        { cmd: 'py', args: ['-3'] },
        { cmd: 'python3', args: [] },
        { cmd: 'python', args: [] }
      ]
    : [
        { cmd: 'python3', args: [] },
        { cmd: 'python', args: [] }
      ];

  for (const { cmd, args } of pythonCommands) {
    try {
      const result = await asyncSpawn(
        cmd,
        [...args, '-c', `import importlib; importlib.import_module("${moduleName}")`],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: 5000,
          windowsHide: true
        }
      );

      if (result.status === 0) {
        logger.debug(`[STARTUP] Python module "${moduleName}" found using ${cmd}`);
        return true;
      }

      const stderr = result.stderr?.trim();
      if (stderr && !stderr.includes('No module named')) {
        logger.debug(`[STARTUP] ${cmd} error checking "${moduleName}": ${stderr}`);
      }
    } catch (error) {
      // Command not found or failed, try next one
      logger.debug(`[STARTUP] ${cmd} not available: ${error.message}`);
    }
  }

  logger.warn(`[STARTUP] Python module "${moduleName}" not found with any Python interpreter`);
  return false;
}

/**
 * Find Python launcher (async version)
 * @returns {Promise<{command: string, args: string[]} | null>}
 */
async function findPythonLauncherAsync() {
  // Use centralized platform utils for Python commands
  const candidates = isWindows
    ? [
        { command: 'py', args: ['-3'] },
        { command: 'python3', args: [] },
        { command: 'python', args: [] }
      ]
    : [
        { command: 'python3', args: [] },
        { command: 'python', args: [] }
      ];

  for (const candidate of candidates) {
    try {
      const result = await asyncSpawn(candidate.command, [...candidate.args, '--version'], {
        stdio: 'pipe',
        windowsHide: true,
        timeout: 2000
      });

      if (result.status === 0) {
        return candidate;
      }
    } catch {
      // Ignore and continue checking other candidates
    }
  }

  return null;
}

/**
 * Check if chroma executable exists (async version)
 * @returns {Promise<boolean>}
 */
async function checkChromaExecutableAsync() {
  // System-installed chroma binary is just 'chroma' on all platforms
  const chromaExecutable = 'chroma';

  try {
    const result = await asyncSpawn(chromaExecutable, ['--help'], {
      stdio: 'pipe',
      windowsHide: true,
      timeout: 5000,
      shell: shouldUseShell()
    });

    // Handle timeout case separately from "not found"
    if (result.status === 0) {
      logger.info('[ChromaDB] Found system chroma executable');
      return true;
    } else if (result.timedOut) {
      // Command timed out during --help check, but it exists
      logger.warn('[ChromaDB] chroma --help timed out, but executable exists');
      return true;
    } else if (result.error && result.error.code !== 'ENOENT') {
      // Some other error (not "command not found")
      logger.warn('[ChromaDB] chroma executable check failed:', result.error.code);
      return true; // Assume it exists
    }

    return false;
  } catch (error) {
    logger.debug('[ChromaDB] System chroma executable not found:', error.message);
    return false;
  }
}

module.exports = {
  asyncSpawn,
  hasPythonModuleAsync,
  findPythonLauncherAsync,
  checkChromaExecutableAsync
};
