/**
 * ChromaDB Service Startup
 *
 * ChromaDB startup and health checking functions.
 * Extracted from StartupManager for better maintainability.
 *
 * @module services/startup/chromaService
 */

const { spawn } = require('child_process');
const axios = require('axios');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { logger } = require('../../../shared/logger');
const { axiosWithRetry } = require('../../utils/ollamaApiRetry');
const { hasPythonModuleAsync } = require('../../utils/asyncSpawnUtils');
const { container, ServiceIds } = require('../ServiceContainer');
const {
  getChromaDataDir,
  parseChromaConfig,
  CHROMA_HEALTH_ENDPOINTS,
  CHROMA_ERROR_MESSAGES
} = require('../../../shared/config/chromaDefaults');

logger.setContext('StartupManager:ChromaDB');

// Construct a minimal, side-effect-free ChromaDB server config when the service
// container is not yet populated during startup.
function buildDefaultChromaConfig() {
  const config = parseChromaConfig();
  // FIX: Use configurable data path for production/container deployments
  // Falls back to userData for standard desktop installs
  const defaultDbPath = path.join(app.getPath('userData'), 'chromadb');
  const dbPath = getChromaDataDir(defaultDbPath);

  // FIX Issue 3.3: Ensure database directory exists before spawning ChromaDB
  // This prevents startup failures when the directory hasn't been created yet
  if (!fs.existsSync(dbPath)) {
    try {
      fs.mkdirSync(dbPath, { recursive: true });
      logger.debug('[STARTUP] Created ChromaDB data directory:', dbPath);
    } catch (mkdirError) {
      // FIX 2.2: Propagate directory creation errors with clear error code
      // Instead of continuing silently, throw a clear error so caller knows why startup failed
      const error = new Error(
        `Failed to create ChromaDB data directory at ${dbPath}: ${mkdirError.message}`
      );
      error.code = 'CHROMA_DIR_CREATE_FAILED';
      error.path = dbPath;
      error.originalError = mkdirError;
      logger.error('[STARTUP] ChromaDB data directory creation failed:', {
        path: dbPath,
        error: mkdirError.message,
        code: mkdirError.code
      });
      throw error;
    }
  }

  return {
    ...config,
    dbPath
  };
}

/**
 * Check ChromaDB health
 * @returns {Promise<boolean>}
 */
async function checkChromaDBHealth() {
  try {
    const { url: baseUrl } = parseChromaConfig();

    for (const endpoint of CHROMA_HEALTH_ENDPOINTS) {
      try {
        const response = await axios.get(`${baseUrl}${endpoint}`, {
          timeout: 5000 // Increased from 2000ms to 5000ms for robustness
        });
        if (response.status === 200) {
          return true;
        }
      } catch {
        // Try next endpoint
      }
    }
    return false;
  } catch (error) {
    logger.debug('[HEALTH] ChromaDB health check failed:', error.message);
    return false;
  }
}

/**
 * Quick check if ChromaDB is running (no retries, for fast initial detection)
 * FIX: Added for faster startup - saves 2-6 seconds by avoiding retry delays
 * @returns {Promise<boolean>}
 */
async function isChromaDBRunningQuick() {
  try {
    const { url: baseUrl } = parseChromaConfig();

    for (const endpoint of CHROMA_HEALTH_ENDPOINTS) {
      try {
        const response = await axios.get(`${baseUrl}${endpoint}`, { timeout: 3000 }); // Increased from 1000ms
        if (response.status === 200) {
          logger.debug(`[STARTUP] ChromaDB quick check successful on ${baseUrl}${endpoint}`);
          return true;
        }
      } catch {
        // Try next endpoint
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if ChromaDB is running (with retries for reliability)
 * @returns {Promise<boolean>}
 */
async function isChromaDBRunning() {
  try {
    const { url: baseUrl } = parseChromaConfig();

    for (const endpoint of CHROMA_HEALTH_ENDPOINTS) {
      try {
        const response = await axiosWithRetry(
          () => axios.get(`${baseUrl}${endpoint}`, { timeout: 5000 }), // Increased from 1000ms
          {
            operation: `ChromaDB health check ${endpoint}`,
            maxRetries: 3, // Increased from 2
            initialDelay: 1000, // Increased from 500
            maxDelay: 3000
          }
        );
        if (response.status === 200) {
          if (response.data && typeof response.data === 'object') {
            if (response.data.error) {
              logger.debug(`[STARTUP] ChromaDB ${endpoint} returned error: ${response.data.error}`);
              continue;
            }
          }
          logger.info(`[STARTUP] ChromaDB heartbeat successful on ${baseUrl}${endpoint}`);
          return true;
        }
      } catch (error) {
        logger.debug(`[STARTUP] ChromaDB heartbeat failed on ${endpoint}: ${error.message}`);
      }
    }

    return false;
  } catch (error) {
    logger.debug(`[STARTUP] ChromaDB heartbeat check failed: ${error.message}`);
    return false;
  }
}

/**
 * Start ChromaDB service
 * @param {Object} options - Options
 * @param {Object} options.serviceStatus - Service status object
 * @param {Array} options.errors - Errors array
 * @param {boolean} options.chromadbDependencyMissing - Whether dependency is missing
 * @param {Object|null} options.cachedChromaSpawnPlan - Cached spawn plan
 * @param {Function} options.setCachedSpawnPlan - Function to cache spawn plan
 * @returns {Promise<Object>} Start result
 */
async function startChromaDB({
  serviceStatus,
  errors,
  chromadbDependencyMissing,
  cachedChromaSpawnPlan,
  setCachedSpawnPlan
}) {
  // Check if ChromaDB is disabled
  if (process.env.STRATOSORT_DISABLE_CHROMADB === '1') {
    logger.info('[STARTUP] ChromaDB is disabled via environment variable');
    serviceStatus.chromadb.status = 'disabled';
    serviceStatus.chromadb.health = 'disabled';
    return { success: true, disabled: true };
  }

  if (chromadbDependencyMissing) {
    logger.info('[STARTUP] ChromaDB dependency previously marked missing. Skipping startup.');
    serviceStatus.chromadb.status = 'disabled';
    serviceStatus.chromadb.health = 'missing_dependency';
    return { success: false, disabled: true, reason: 'missing_dependency' };
  }

  // External ChromaDB mode (e.g. running in Docker): if CHROMA_SERVER_URL is provided,
  // we do NOT require the local Python module or local spawn.
  if (process.env.CHROMA_SERVER_URL) {
    const reachable = await isChromaDBRunning();
    if (reachable) {
      serviceStatus.chromadb.status = 'running';
      serviceStatus.chromadb.health = 'healthy';
      serviceStatus.chromadb.external = true;
      logger.info('[STARTUP] Using external ChromaDB server', {
        url: process.env.CHROMA_SERVER_URL
      });
      return { success: true, external: true };
    }

    serviceStatus.chromadb.status = 'failed';
    serviceStatus.chromadb.health = 'unhealthy';
    errors.push({
      service: 'chromadb',
      error: CHROMA_ERROR_MESSAGES.EXTERNAL_UNREACHABLE(process.env.CHROMA_SERVER_URL),
      critical: false
    });
    logger.warn('[STARTUP] External ChromaDB server not reachable', {
      url: process.env.CHROMA_SERVER_URL
    });
    return { success: false, external: true, reason: 'unreachable' };
  }

  // FIX: Use quick check (no retries) for initial detection - saves 2-6 seconds
  // If a ChromaDB server is already reachable, don't try to spawn a second instance.
  // This avoids noisy failures when a previous run (or another service) already started ChromaDB.
  if (await isChromaDBRunningQuick()) {
    serviceStatus.chromadb.status = 'running';
    serviceStatus.chromadb.health = 'healthy';
    serviceStatus.chromadb.external = false;
    logger.info('[STARTUP] ChromaDB is already running; skipping spawn');
    return { success: true, alreadyRunning: true };
  }

  // Use cached spawn plan if available
  let plan = cachedChromaSpawnPlan;

  if (!plan) {
    const { buildChromaSpawnPlan } = require('../../utils/chromaSpawnUtils');
    // Chroma service might not be registered yet during early startup.
    // Prefer registered service config when available; otherwise fall back to env/defaults.
    let serverConfig;
    try {
      const hasServiceResolver =
        container && typeof container.has === 'function' && typeof container.resolve === 'function';
      if (hasServiceResolver && container.has(ServiceIds.CHROMA_DB)) {
        // FIX: Wrap container resolution in try-catch to handle startup failures gracefully
        serverConfig = container.resolve(ServiceIds.CHROMA_DB).getServerConfig();
      } else {
        serverConfig = buildDefaultChromaConfig();
      }
    } catch (resolveError) {
      // FIX Issue 3.4: Log at WARN level since this is a significant fallback scenario
      logger.warn('[STARTUP] Failed to resolve ChromaDB service, using default config', {
        error: resolveError?.message
      });
      serverConfig = buildDefaultChromaConfig();
    }

    plan = await buildChromaSpawnPlan(serverConfig);

    // IMPORTANT:
    // Do not hard-require `python -c "import chromadb"` to succeed.
    // On Windows, users can have a working `chroma.exe` on PATH (different Python install)
    // while `py -3` cannot import the module. The spawn plan resolver already supports:
    // - system chroma executable
    // - python user scripts chroma.exe
    // - local CLI under node_modules/.bin
    // - python -m chromadb fallback
    if (!plan) {
      const moduleAvailable = await hasPythonModuleAsync('chromadb');
      serviceStatus.chromadb.status = 'disabled';
      serviceStatus.chromadb.health = 'missing_dependency';
      errors.push({
        service: 'chromadb',
        error: CHROMA_ERROR_MESSAGES.MISSING_DEPENDENCY,
        critical: false
      });
      logger.warn('[STARTUP] No viable ChromaDB startup plan found. Disabling ChromaDB features.', {
        pythonModuleAvailable: Boolean(moduleAvailable)
      });
      return {
        success: false,
        disabled: true,
        reason: 'missing_dependency',
        setDependencyMissing: true
      };
    }

    // FIX: Cache ALL successful spawn plans to save 3-6 seconds on restarts
    // Previously only cached system chroma, but python -m chromadb is equally cacheable
    setCachedSpawnPlan(plan);
    logger.info('[STARTUP] Cached ChromaDB spawn plan for future restarts', {
      command: plan.command,
      source: plan.source
    });
  } else {
    logger.info('[STARTUP] Using cached ChromaDB spawn plan for restart');
  }

  // FIX: Check if port is available before attempting spawn
  // This prevents wasted time when an existing ChromaDB is occupying the port
  const serverConfig = buildDefaultChromaConfig();
  const { isPortAvailable } = require('./preflightChecks');
  const portAvailable = await isPortAvailable(serverConfig.host, serverConfig.port);

  if (!portAvailable) {
    logger.info(
      `[STARTUP] Port ${serverConfig.port} is occupied, checking if ChromaDB is responding...`
    );

    // Wait a moment for any starting ChromaDB to become responsive
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check with retries if an existing ChromaDB is running
    const existingRunning = await isChromaDBRunning();
    if (existingRunning) {
      serviceStatus.chromadb.status = 'running';
      serviceStatus.chromadb.health = 'healthy';
      logger.info(
        `[STARTUP] Existing ChromaDB instance detected on port ${serverConfig.port}, using it`
      );
      return { success: true, alreadyRunning: true, portInUse: true };
    }

    // Port is occupied by something else
    logger.warn('[STARTUP] Port 8000 occupied by non-ChromaDB process');
    errors.push({
      service: 'chromadb',
      error: CHROMA_ERROR_MESSAGES.PORT_IN_USE(serverConfig.port),
      critical: false
    });
    return { success: false, reason: 'port_in_use' };
  }

  logger.info(`[STARTUP] ChromaDB spawn plan: ${plan.command} ${plan.args.join(' ')}`);
  const chromaProcess = spawn(plan.command, plan.args, plan.options);

  // FIX: Track spawn failure from stderr to enable early exit from polling
  let spawnFailed = false;
  let spawnFailureReason = null;

  chromaProcess.stdout?.on('data', (data) => {
    logger.debug(`[ChromaDB] ${data.toString().trim()}`);
  });

  chromaProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    logger.debug(`[ChromaDB stderr] ${msg}`);

    // FIX: Detect address-in-use failures immediately
    // Expanded patterns for Windows/Unix compatibility
    if (
      /address.*not available/i.test(msg) ||
      /EADDRINUSE/i.test(msg) ||
      /bind.*failed/i.test(msg) ||
      /address already in use/i.test(msg) ||
      /Only one usage of each socket address/i.test(msg) ||
      /WinError 10048/i.test(msg) ||
      /port.*already.*bound/i.test(msg)
    ) {
      spawnFailed = true;
      spawnFailureReason = 'address_in_use';
      logger.warn('[STARTUP] ChromaDB spawn failed: port already in use');
    }
  });

  chromaProcess.on('error', (error) => {
    logger.error('[ChromaDB] Process error:', error);
    spawnFailed = true;
    spawnFailureReason = error.message;
  });

  chromaProcess.on('exit', (code, signal) => {
    logger.warn(`[ChromaDB] Process exited with code ${code}, signal ${signal}`);

    // If process exits immediately with code 0 but we saw address-in-use error, mark as failed
    if (code === 0 && spawnFailed) {
      logger.warn(
        '[STARTUP] ChromaDB exited cleanly but failed to bind - checking for existing instance'
      );
    }

    serviceStatus.chromadb.status = 'stopped';
    // FIX: Also update health status to reflect service is not running
    serviceStatus.chromadb.health = 'unhealthy';

    // FIX: Emit status change to notify renderer
    try {
      const { emitServiceStatusChange } = require('../../ipc/serviceStatusEvents');
      emitServiceStatusChange({
        service: 'chromadb',
        status: 'stopped',
        health: 'unhealthy',
        details: { exitCode: code, signal, reason: 'process_exited' }
      });
    } catch (e) {
      logger.debug('[ChromaDB] Could not emit status change', { error: e?.message });
    }
  });

  return {
    process: chromaProcess,
    // Expose spawn failure state for early exit from polling
    isSpawnFailed: () => spawnFailed,
    getSpawnFailureReason: () => spawnFailureReason
  };
}

module.exports = {
  checkChromaDBHealth,
  isChromaDBRunning,
  isChromaDBRunningQuick,
  startChromaDB
};
