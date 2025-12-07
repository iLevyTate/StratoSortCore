/**
 * Ollama Service Startup
 *
 * Ollama startup and health checking functions.
 * Extracted from StartupManager for better maintainability.
 *
 * @module services/startup/ollamaService
 */

const { spawn } = require('child_process');
const axios = require('axios');
const { logger } = require('../../../shared/logger');
const { axiosWithRetry } = require('../../utils/ollamaApiRetry');
const { TIMEOUTS } = require('../../../shared/performanceConstants');
const { shouldUseShell } = require('../../../shared/platformUtils');

logger.setContext('StartupManager:Ollama');

/**
 * Check Ollama health
 * @returns {Promise<boolean>}
 */
async function checkOllamaHealth() {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const response = await axios.get(`${baseUrl}/api/tags`, {
      timeout: 2000,
    });
    return response.status === 200;
  } catch (error) {
    logger.debug('[HEALTH] Ollama health check failed:', error.message);
    return false;
  }
}

/**
 * Check if Ollama is running
 * @returns {Promise<boolean>}
 */
async function isOllamaRunning() {
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    const response = await axiosWithRetry(
      () => axios.get(`${baseUrl}/api/tags`, { timeout: 1000 }),
      {
        operation: 'Ollama health check',
        maxRetries: 2,
        initialDelay: 500,
        maxDelay: 2000,
      },
    );
    return response.status === 200;
  } catch {
    return false;
  }
}

/**
 * Start Ollama service
 * @param {Object} options - Options
 * @param {Object} options.serviceStatus - Service status object
 * @returns {Promise<Object>} Start result
 */
async function startOllama({ serviceStatus }) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

  // Check if Ollama is already running
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, {
      timeout: 1000,
      validateStatus: () => true,
    });

    if (response.status === 200) {
      logger.info(
        '[STARTUP] Ollama is already running externally, skipping startup',
      );
      return { process: null, external: true };
    }
  } catch (error) {
    if (error.code !== 'ECONNREFUSED') {
      logger.debug(
        '[STARTUP] Ollama pre-check error (non-critical):',
        error.message,
      );
    }
  }

  logger.info('[STARTUP] Starting Ollama server...');
  let ollamaProcess;
  try {
    ollamaProcess = spawn('ollama', ['serve'], {
      detached: false,
      stdio: 'pipe',
      shell: shouldUseShell(),
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(`Failed to spawn Ollama binary: ${error.message}`);
  }

  let startupError = null;

  ollamaProcess.stdout?.on('data', (data) => {
    const message = data.toString().trim();
    logger.debug(`[Ollama] ${message}`);
  });

  ollamaProcess.stderr?.on('data', (data) => {
    const message = data.toString().trim();
    logger.debug(`[Ollama stderr] ${message}`);

    // Detect port binding error
    if (
      message.includes('bind: Only one usage of each socket address') ||
      message.includes('address already in use') ||
      (message.includes('listen tcp') && message.includes('11434'))
    ) {
      startupError = 'PORT_IN_USE';
      logger.info(
        '[STARTUP] Ollama port already in use, assuming external instance is running',
      );
    }
  });

  ollamaProcess.on('error', (error) => {
    logger.error('[Ollama] Process error:', error);
    startupError = error.message;
  });

  ollamaProcess.on('exit', (code, signal) => {
    logger.warn(`[Ollama] Process exited with code ${code}, signal ${signal}`);
    serviceStatus.ollama.status = 'stopped';
  });

  // Wait briefly to check for immediate failures
  await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_MEDIUM));

  // If we got a port-in-use error, treat as external instance
  if (startupError === 'PORT_IN_USE') {
    try {
      ollamaProcess.kill();
    } catch {
      // Process may have already exited
    }
    return { process: null, external: true, portInUse: true };
  }

  if (startupError) {
    throw new Error(`Failed to start Ollama: ${startupError}`);
  }

  return { process: ollamaProcess };
}

module.exports = {
  checkOllamaHealth,
  isOllamaRunning,
  startOllama,
};
