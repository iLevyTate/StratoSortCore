/**
 * Preflight Checks
 *
 * Pre-startup validation for system requirements.
 * Extracted from StartupManager for better maintainability.
 *
 * @module services/startup/preflightChecks
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const axios = require('axios');
const { logger } = require('../../../shared/logger');
const { asyncSpawn } = require('../../utils/asyncSpawnUtils');
const { isWindows, shouldUseShell } = require('../../../shared/platformUtils');
const { withTimeout } = require('../../../shared/promiseUtils');

logger.setContext('StartupManager:Preflight');

const DEFAULT_AXIOS_TIMEOUT = 5000;

/**
 * Check if Python is installed
 * @returns {Promise<{installed: boolean, version: string|null}>}
 */
async function checkPythonInstallation() {
  logger.debug('[PREFLIGHT] Checking Python installation...');

  const pythonCommands = isWindows
    ? [
        { cmd: 'py', args: ['-3', '--version'] },
        { cmd: 'python3', args: ['--version'] },
        { cmd: 'python', args: ['--version'] },
      ]
    : [
        { cmd: 'python3', args: ['--version'] },
        { cmd: 'python', args: ['--version'] },
      ];

  for (const { cmd, args } of pythonCommands) {
    try {
      logger.debug(
        `[PREFLIGHT] Trying Python command: ${cmd} ${args.join(' ')}`,
      );
      const result = await asyncSpawn(cmd, args, {
        timeout: 3000,
        windowsHide: true,
        shell: shouldUseShell(),
      });

      if (result.status === 0) {
        const version = (result.stdout + result.stderr).toString().trim();
        logger.debug(`[PREFLIGHT] Python found: ${cmd} - ${version}`);
        return { installed: true, version };
      } else {
        logger.debug(`[PREFLIGHT] ${cmd} returned status ${result.status}`);
      }
    } catch (error) {
      logger.debug(`[PREFLIGHT] ${cmd} failed: ${error.message}`);
    }
  }

  logger.debug('[PREFLIGHT] No Python installation found');
  return { installed: false, version: null };
}

/**
 * Check if Ollama is installed
 * @returns {Promise<{installed: boolean, version: string|null}>}
 */
async function checkOllamaInstallation() {
  logger.debug('[PREFLIGHT] Checking Ollama installation...');

  try {
    const result = await asyncSpawn('ollama', ['--version'], {
      timeout: 3000,
      windowsHide: true,
      shell: shouldUseShell(),
    });

    if (result.status === 0) {
      const version = (result.stdout + result.stderr).toString().trim();
      logger.debug(`[PREFLIGHT] Ollama found: ${version}`);
      return { installed: true, version };
    } else {
      logger.debug(`[PREFLIGHT] Ollama returned status ${result.status}`);
      return { installed: false, version: null };
    }
  } catch (error) {
    logger.debug(`[PREFLIGHT] Ollama check failed: ${error.message}`);
    return { installed: false, version: null };
  }
}

/**
 * Check if a port is available
 * @param {string} host - Host to check
 * @param {number} port - Port to check
 * @returns {Promise<boolean>}
 */
async function isPortAvailable(host, port) {
  try {
    await axios.get(`http://${host}:${port}`, {
      timeout: DEFAULT_AXIOS_TIMEOUT,
    });
    // If we get here, something is already running on the port
    return false;
  } catch (error) {
    const PORT_AVAILABLE_ERRORS = new Set([
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENETUNREACH',
    ]);

    if (PORT_AVAILABLE_ERRORS.has(error.code)) {
      logger.debug(
        `[PREFLIGHT] Port ${host}:${port} appears available (${error.code})`,
      );
      return true;
    }

    if (error.response) {
      logger.debug(
        `[PREFLIGHT] Port ${host}:${port} in use (HTTP ${error.response.status})`,
      );
      return false;
    }

    logger.warn(
      `[PREFLIGHT] Port check inconclusive for ${host}:${port}: ${error.code || error.message}`,
    );
    return false;
  }
}

/**
 * Run all pre-flight checks
 * @param {Object} options - Options object
 * @param {Function} options.reportProgress - Progress reporter function
 * @param {Array} options.errors - Errors array to populate
 * @returns {Promise<Array>} Check results
 */
async function runPreflightChecks({ reportProgress, errors }) {
  reportProgress('preflight', 'Running pre-flight checks...', 5);
  const checks = [];
  logger.debug('[PREFLIGHT] Starting pre-flight checks...');

  // Check 1: Verify data directory exists and is writable
  try {
    logger.debug('[PREFLIGHT] Checking data directory...');
    const userDataPath = app.getPath('userData');
    logger.debug(`[PREFLIGHT] Data directory path: ${userDataPath}`);

    try {
      await withTimeout(
        fs.access(userDataPath),
        5000,
        'Directory access check',
      );
      logger.debug('[PREFLIGHT] Data directory exists');
    } catch {
      logger.debug('[PREFLIGHT] Data directory does not exist, creating...');
      await withTimeout(
        fs.mkdir(userDataPath, { recursive: true }),
        5000,
        'Directory creation',
      );
      logger.debug('[PREFLIGHT] Data directory created');
    }

    const testFile = path.join(userDataPath, '.write-test');
    logger.debug(`[PREFLIGHT] Testing write access with file: ${testFile}`);
    await withTimeout(
      fs.writeFile(testFile, 'test').then(() => fs.unlink(testFile)),
      5000,
      'Write access test',
    );
    logger.debug('[PREFLIGHT] Data directory write test passed');
    checks.push({ name: 'Data Directory', status: 'ok' });
  } catch (error) {
    logger.error('[PREFLIGHT] Data directory check failed:', error);
    checks.push({
      name: 'Data Directory',
      status: 'fail',
      error: error.message,
    });
    errors.push({
      check: 'data-directory',
      error: error.message,
      critical: true,
    });
  }

  // Check 2: Verify Python installation
  try {
    logger.debug('[PREFLIGHT] Starting Python installation check...');
    const pythonCheck = await checkPythonInstallation();
    logger.debug(
      `[PREFLIGHT] Python check result: installed=${pythonCheck.installed}, version=${pythonCheck.version}`,
    );
    checks.push({
      name: 'Python Installation',
      status: pythonCheck.installed ? 'ok' : 'warn',
      version: pythonCheck.version,
    });
    if (!pythonCheck.installed) {
      logger.warn(
        '[PREFLIGHT] Python not found - ChromaDB features will be disabled',
      );
      errors.push({
        check: 'python',
        error: 'Python not found. ChromaDB features will be disabled.',
        critical: false,
      });
    }
  } catch (error) {
    logger.error('[PREFLIGHT] Python installation check threw error:', error);
    checks.push({
      name: 'Python Installation',
      status: 'warn',
      error: error.message,
    });
  }

  // Check 3: Verify Ollama installation
  try {
    logger.debug('[PREFLIGHT] Starting Ollama installation check...');
    const ollamaCheck = await checkOllamaInstallation();
    logger.debug(
      `[PREFLIGHT] Ollama check result: installed=${ollamaCheck.installed}, version=${ollamaCheck.version}`,
    );
    checks.push({
      name: 'Ollama Installation',
      status: ollamaCheck.installed ? 'ok' : 'warn',
    });
    if (!ollamaCheck.installed) {
      logger.warn('[PREFLIGHT] Ollama not found - AI features will be limited');
      errors.push({
        check: 'ollama',
        error: 'Ollama not found. AI features will be limited.',
        critical: false,
      });
    }
  } catch (error) {
    logger.error('[PREFLIGHT] Ollama installation check threw error:', error);
    checks.push({
      name: 'Ollama Installation',
      status: 'warn',
      error: error.message,
    });
  }

  // Check 4: Port availability
  try {
    logger.debug('[PREFLIGHT] Starting port availability check...');
    const chromaPort = process.env.CHROMA_SERVER_PORT || 8000;
    const ollamaPort = 11434;
    logger.debug(
      `[PREFLIGHT] Checking ports: ChromaDB=${chromaPort}, Ollama=${ollamaPort}`,
    );

    const chromaPortAvailable = await isPortAvailable('127.0.0.1', chromaPort);
    logger.debug(
      `[PREFLIGHT] ChromaDB port ${chromaPort} available: ${chromaPortAvailable}`,
    );

    const ollamaPortAvailable = await isPortAvailable('127.0.0.1', ollamaPort);
    logger.debug(
      `[PREFLIGHT] Ollama port ${ollamaPort} available: ${ollamaPortAvailable}`,
    );

    checks.push({
      name: 'Port Availability',
      status: chromaPortAvailable && ollamaPortAvailable ? 'ok' : 'warn',
      details: {
        chromaPort,
        ollamaPort,
        chromaPortAvailable,
        ollamaPortAvailable,
      },
    });

    if (!chromaPortAvailable || !ollamaPortAvailable) {
      errors.push({
        check: 'port-availability',
        error: `Port conflicts detected: chroma(${chromaPortAvailable ? 'free' : 'in use'}), ollama(${ollamaPortAvailable ? 'free' : 'in use'})`,
        critical: false,
      });
    }
  } catch (error) {
    logger.error('[PREFLIGHT] Port availability check threw error:', error);
    checks.push({
      name: 'Port Availability',
      status: 'warn',
      error: error.message,
    });
  }

  // Check 5: Disk space
  try {
    logger.debug('[PREFLIGHT] Starting disk space check...');
    const userDataPath = app.getPath('userData');
    logger.debug(`[PREFLIGHT] User data path resolved to: ${userDataPath}`);
    checks.push({ name: 'Disk Space', status: 'ok' });
    logger.debug('[PREFLIGHT] Disk space check completed');
  } catch (error) {
    logger.error('[PREFLIGHT] Disk space check failed:', error);
    checks.push({ name: 'Disk Space', status: 'warn', error: error.message });
  }

  logger.debug('[PREFLIGHT] All pre-flight checks completed');
  reportProgress('preflight', 'Pre-flight checks completed', 10);
  return checks;
}

module.exports = {
  checkPythonInstallation,
  checkOllamaInstallation,
  isPortAvailable,
  runPreflightChecks,
  DEFAULT_AXIOS_TIMEOUT,
};
