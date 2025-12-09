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
const { logger } = require('../../../shared/logger');
const { axiosWithRetry } = require('../../utils/ollamaApiRetry');
const { hasPythonModuleAsync } = require('../../utils/asyncSpawnUtils');
const { container, ServiceIds } = require('../ServiceContainer');
const { app } = require('electron');
const path = require('path');

logger.setContext('StartupManager:ChromaDB');

// Construct a minimal, side-effect-free ChromaDB server config when the service
// container is not yet populated during startup.
function buildDefaultChromaConfig() {
  const DEFAULT_PROTOCOL = 'http';
  const DEFAULT_HOST = '127.0.0.1';
  const DEFAULT_PORT = 8000;

  let protocol = DEFAULT_PROTOCOL;
  let host = DEFAULT_HOST;
  let port = DEFAULT_PORT;

  const url = process.env.CHROMA_SERVER_URL;
  if (url) {
    try {
      const parsed = new URL(url);
      protocol = parsed.protocol?.replace(':', '') || DEFAULT_PROTOCOL;
      host = parsed.hostname || DEFAULT_HOST;
      port =
        Number(parsed.port) ||
        (protocol === 'https' ? 443 : 80) ||
        DEFAULT_PORT;
    } catch (err) {
      logger.warn('[STARTUP] Invalid CHROMA_SERVER_URL, using defaults', {
        url,
        message: err?.message,
      });
    }
  } else {
    protocol = process.env.CHROMA_SERVER_PROTOCOL || DEFAULT_PROTOCOL;
    host = process.env.CHROMA_SERVER_HOST || DEFAULT_HOST;
    port = Number(process.env.CHROMA_SERVER_PORT) || DEFAULT_PORT;
  }

  const dbPath = path.join(app.getPath('userData'), 'chromadb');

  return {
    host,
    port,
    protocol,
    url: `${protocol}://${host}:${port}`,
    dbPath,
  };
}

/**
 * Check ChromaDB health
 * @returns {Promise<boolean>}
 */
async function checkChromaDBHealth() {
  try {
    const baseUrl =
      process.env.CHROMA_SERVER_URL ||
      `${process.env.CHROMA_SERVER_PROTOCOL || 'http'}://${process.env.CHROMA_SERVER_HOST || '127.0.0.1'}:${process.env.CHROMA_SERVER_PORT || 8000}`;

    const endpoints = ['/api/v2/heartbeat', '/api/v1/heartbeat', '/api/v1'];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${baseUrl}${endpoint}`, {
          timeout: 2000,
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
 * Check if ChromaDB is running
 * @returns {Promise<boolean>}
 */
async function isChromaDBRunning() {
  try {
    const baseUrl =
      process.env.CHROMA_SERVER_URL ||
      `${process.env.CHROMA_SERVER_PROTOCOL || 'http'}://${process.env.CHROMA_SERVER_HOST || '127.0.0.1'}:${process.env.CHROMA_SERVER_PORT || 8000}`;

    const endpoints = ['/api/v2/heartbeat', '/api/v1/heartbeat', '/api/v1'];

    for (const endpoint of endpoints) {
      try {
        const response = await axiosWithRetry(
          () => axios.get(`${baseUrl}${endpoint}`, { timeout: 1000 }),
          {
            operation: `ChromaDB health check ${endpoint}`,
            maxRetries: 2,
            initialDelay: 500,
            maxDelay: 2000,
          },
        );
        if (response.status === 200) {
          if (response.data && typeof response.data === 'object') {
            if (response.data.error) {
              logger.debug(
                `[STARTUP] ChromaDB ${endpoint} returned error: ${response.data.error}`,
              );
              continue;
            }
          }
          logger.info(
            `[STARTUP] ChromaDB heartbeat successful on ${baseUrl}${endpoint}`,
          );
          return true;
        }
      } catch (error) {
        logger.debug(
          `[STARTUP] ChromaDB heartbeat failed on ${endpoint}: ${error.message}`,
        );
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
  setCachedSpawnPlan,
}) {
  // Check if ChromaDB is disabled
  if (process.env.STRATOSORT_DISABLE_CHROMADB === '1') {
    logger.info('[STARTUP] ChromaDB is disabled via environment variable');
    serviceStatus.chromadb.status = 'disabled';
    serviceStatus.chromadb.health = 'disabled';
    return { success: true, disabled: true };
  }

  if (chromadbDependencyMissing) {
    logger.info(
      '[STARTUP] ChromaDB dependency previously marked missing. Skipping startup.',
    );
    serviceStatus.chromadb.status = 'disabled';
    serviceStatus.chromadb.health = 'missing_dependency';
    return { success: false, disabled: true, reason: 'missing_dependency' };
  }

  const moduleAvailable = await hasPythonModuleAsync('chromadb');
  if (!moduleAvailable) {
    serviceStatus.chromadb.status = 'disabled';
    serviceStatus.chromadb.health = 'missing_dependency';
    errors.push({
      service: 'chromadb',
      error:
        'Python module "chromadb" is not installed. Semantic search disabled.',
      critical: false,
    });
    logger.warn(
      '[STARTUP] Python module "chromadb" not available. Disabling ChromaDB features.',
    );
    return {
      success: false,
      disabled: true,
      reason: 'missing_dependency',
      setDependencyMissing: true,
    };
  }

  // Use cached spawn plan if available
  let plan = cachedChromaSpawnPlan;

  if (!plan) {
    const { buildChromaSpawnPlan } = require('../../utils/chromaSpawnUtils');
    // Chroma service might not be registered yet during early startup.
    // Prefer registered service config when available; otherwise fall back to env/defaults.
    const serverConfig = container.has(ServiceIds.CHROMA_DB)
      ? container.resolve(ServiceIds.CHROMA_DB).getServerConfig()
      : buildDefaultChromaConfig();

    plan = await buildChromaSpawnPlan(serverConfig);

    if (!plan) {
      throw new Error('No viable ChromaDB startup plan found');
    }

    // Only cache if it's the system chroma executable
    if (plan.command === 'chroma' || plan.source === 'local-cli') {
      setCachedSpawnPlan(plan);
      logger.info('[STARTUP] Cached ChromaDB spawn plan for future restarts');
    } else {
      logger.warn('[STARTUP] Not caching spawn plan - using fallback method');
    }
  } else {
    logger.info('[STARTUP] Using cached ChromaDB spawn plan for restart');
  }

  logger.info(
    `[STARTUP] ChromaDB spawn plan: ${plan.command} ${plan.args.join(' ')}`,
  );
  const chromaProcess = spawn(plan.command, plan.args, plan.options);

  chromaProcess.stdout?.on('data', (data) => {
    logger.debug(`[ChromaDB] ${data.toString().trim()}`);
  });

  chromaProcess.stderr?.on('data', (data) => {
    logger.debug(`[ChromaDB stderr] ${data.toString().trim()}`);
  });

  chromaProcess.on('error', (error) => {
    logger.error('[ChromaDB] Process error:', error);
  });

  chromaProcess.on('exit', (code, signal) => {
    logger.warn(
      `[ChromaDB] Process exited with code ${code}, signal ${signal}`,
    );
    serviceStatus.chromadb.status = 'stopped';
  });

  return { process: chromaProcess };
}

module.exports = {
  checkChromaDBHealth,
  isChromaDBRunning,
  startChromaDB,
};
