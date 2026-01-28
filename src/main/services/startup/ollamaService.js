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
const { axiosWithRetry, checkOllamaHealth } = require('../../utils/ollamaApiRetry');
const { TIMEOUTS } = require('../../../shared/performanceConstants');
const { getValidatedOllamaHost } = require('../../../shared/configDefaults');
const { getRecommendedEnvSettings } = require('../PerformanceService');

logger.setContext('StartupManager:Ollama');

// Note: checkOllamaHealth is imported from shared ollamaApiRetry module

/**
 * Check if Ollama is running
 * @returns {Promise<boolean>}
 */
async function isOllamaRunning() {
  try {
    // FIX: Use centralized env var resolution (supports both OLLAMA_BASE_URL and OLLAMA_HOST)
    const { url: baseUrl } = getValidatedOllamaHost();
    const response = await axiosWithRetry(
      () => axios.get(`${baseUrl}/api/tags`, { timeout: 1000 }),
      {
        operation: 'Ollama health check',
        maxRetries: 2,
        initialDelay: 500,
        maxDelay: 2000
      }
    );
    return response.status === 200;
  } catch (error) {
    logger.debug('[STARTUP] Ollama is not running', { error: error.message });
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
  // FIX: Use centralized env var resolution (supports both OLLAMA_BASE_URL and OLLAMA_HOST)
  const { url: baseUrl } = getValidatedOllamaHost();

  // Check if Ollama is already running
  try {
    const response = await axios.get(`${baseUrl}/api/tags`, {
      timeout: 1000,
      validateStatus: () => true
    });

    // FIX Issue 3.6: Validate response is actually from Ollama, not another service
    // Ollama returns { models: [...] } from /api/tags endpoint
    if (response.status === 200 && Array.isArray(response.data?.models)) {
      logger.info('[STARTUP] Ollama is already running externally, skipping startup');
      return { process: null, external: true };
    } else if (response.status === 200) {
      // Port is in use but response doesn't match Ollama - warn and try to start anyway
      logger.warn('[STARTUP] Port 11434 responds but does not appear to be Ollama', {
        hasModelsArray: Array.isArray(response.data?.models),
        dataType: typeof response.data
      });
    }
  } catch (error) {
    if (error.code !== 'ECONNREFUSED') {
      logger.debug('[STARTUP] Ollama pre-check error (non-critical):', error.message);
    }
  }

  logger.info('[STARTUP] Starting Ollama server...');

  // FIX: Apply performance tuning variables
  const { recommendations } = await getRecommendedEnvSettings();

  // Filter out any undefined/null values
  const envVars = Object.entries(recommendations).reduce((acc, [key, value]) => {
    if (value !== undefined && value !== null) {
      acc[key] = String(value);
    }
    return acc;
  }, {});

  logger.info('[STARTUP] Ollama performance tuning applied:', {
    parallel: envVars.OLLAMA_NUM_PARALLEL,
    gpu: envVars.OLLAMA_NUM_GPU,
    batch: envVars.OLLAMA_NUM_BATCH,
    threads: envVars.OLLAMA_NUM_THREAD,
    maxLoadedModels: envVars.OLLAMA_MAX_LOADED_MODELS,
    loadTimeout: envVars.OLLAMA_LOAD_TIMEOUT
  });

  let ollamaProcess;
  try {
    ollamaProcess = spawn('ollama', ['serve'], {
      detached: false,
      stdio: 'pipe',
      windowsHide: true,
      env: {
        ...process.env,
        ...envVars
      }
    });
  } catch (error) {
    throw new Error(`Failed to spawn Ollama binary: ${error.message}`);
  }

  let startupError = null;

  // FIX: Store event handler references for cleanup to prevent memory leaks
  const handlers = {
    stdout: null,
    stderr: null,
    error: null,
    exit: null
  };

  // FIX: Cleanup function to remove all event listeners
  const cleanupListeners = () => {
    try {
      if (handlers.stdout && ollamaProcess.stdout) {
        ollamaProcess.stdout.removeListener('data', handlers.stdout);
      }
      if (handlers.stderr && ollamaProcess.stderr) {
        ollamaProcess.stderr.removeListener('data', handlers.stderr);
      }
      if (handlers.error) {
        ollamaProcess.removeListener('error', handlers.error);
      }
      if (handlers.exit) {
        ollamaProcess.removeListener('exit', handlers.exit);
      }
    } catch (e) {
      logger.debug('[Ollama] Cleanup error (non-fatal):', e?.message);
    }
  };

  handlers.stdout = (data) => {
    const message = data.toString().trim();
    logger.debug(`[Ollama] ${message}`);
  };

  handlers.stderr = (data) => {
    const message = data.toString().trim();
    logger.debug(`[Ollama stderr] ${message}`);

    // Detect port binding error
    if (
      message.includes('bind: Only one usage of each socket address') ||
      message.includes('address already in use') ||
      (message.includes('listen tcp') && message.includes('11434'))
    ) {
      startupError = 'PORT_IN_USE';
      logger.info('[STARTUP] Ollama port already in use, assuming external instance is running');
    }
  };

  handlers.error = (error) => {
    logger.error('[Ollama] Process error:', error);
    startupError = error.message;
  };

  handlers.exit = (code, signal) => {
    logger.warn(`[Ollama] Process exited with code ${code}, signal ${signal}`);
    serviceStatus.ollama.status = 'stopped';
    // FIX: Also update health status to reflect service is not running
    serviceStatus.ollama.health = 'unhealthy';

    // FIX: Clean up event listeners on exit to prevent memory leaks
    cleanupListeners();

    // FIX: Emit status change to notify renderer
    try {
      const { emitServiceStatusChange } = require('../../ipc/serviceStatusEvents');
      emitServiceStatusChange({
        service: 'ollama',
        status: 'stopped',
        health: 'unhealthy',
        details: { exitCode: code, signal, reason: 'process_exited' }
      });
    } catch (e) {
      logger.debug('[Ollama] Could not emit status change', { error: e?.message });
    }
  };

  // Register event handlers
  ollamaProcess.stdout?.on('data', handlers.stdout);
  ollamaProcess.stderr?.on('data', handlers.stderr);
  ollamaProcess.on('error', handlers.error);
  ollamaProcess.on('exit', handlers.exit);

  // Wait briefly to check for immediate failures
  await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.DELAY_MEDIUM));

  // If we got a port-in-use error, treat as external instance
  if (startupError === 'PORT_IN_USE') {
    // FIX: Clean up event listeners before returning to prevent memory leaks
    cleanupListeners();
    try {
      ollamaProcess.kill();
    } catch (killError) {
      logger.debug('[Ollama] Process kill failed (likely already dead)', {
        error: killError.message
      });
      // Process may have already exited
    }
    return { process: null, external: true, portInUse: true };
  }

  if (startupError) {
    cleanupListeners();
    try {
      ollamaProcess?.kill();
    } catch (killError) {
      logger.debug('[Ollama] Process kill failed (non-fatal)', { error: killError.message });
    }
    throw new Error(`Failed to start Ollama: ${startupError}`);
  }

  // FIX M1: Return cleanup function for caller to invoke on app shutdown
  // This prevents event listener persistence when Ollama runs successfully until shutdown
  return { process: ollamaProcess, cleanup: cleanupListeners };
}

module.exports = {
  checkOllamaHealth,
  isOllamaRunning,
  startOllama
};
