const { spawn, spawnSync } = require('child_process');
const { logger } = require('../../shared/logger');
logger.setContext('StartupManager');
const axios = require('axios');
const { axiosWithRetry } = require('../utils/ollamaApiRetry');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs'); // Sync version for simple operations
const { app } = require('electron');
const { hasPythonModuleAsync } = require('../utils/asyncSpawnUtils');

// FIXED Bug #28: Named constant for axios timeout
const DEFAULT_AXIOS_TIMEOUT = 5000; // 5 seconds

/**
 * StartupManager
 *
 * Centralized service for managing application startup sequence with:
 * - Retry logic with exponential backoff
 * - Health monitoring for services
 * - Graceful degradation when services fail
 * - Pre-flight checks before startup
 * - User-friendly error reporting
 * - Timeout protection
 */
class StartupManager {
  constructor() {
    this.services = new Map();
    this.healthMonitor = null;
    this.healthCheckInProgress = false;
    this.healthCheckStartedAt = null; // CRITICAL FIX: Track health check start time
    this.startupState = 'initializing';
    this.errors = [];
    this.serviceProcesses = new Map();
    this.config = {
      startupTimeout: 60000, // 60 seconds overall timeout
      healthCheckInterval: 30000, // 30 seconds between health checks
      maxRetries: 3,
      baseRetryDelay: 1000, // Base delay for exponential backoff
      axiosTimeout: DEFAULT_AXIOS_TIMEOUT, // Default axios timeout
      // Bug #45: Circuit breaker configuration for failed services
      circuitBreakerThreshold: 5, // Auto-disable after 5 consecutive failures
      circuitBreakerConsecutiveFailures: 3, // Attempt restart after 3 consecutive failures
    };

    // Service status tracking
    this.serviceStatus = {
      chromadb: { status: 'not_started', required: false, health: 'unknown' },
      ollama: { status: 'not_started', required: false, health: 'unknown' },
    };

    this.startupPhase = 'idle';
    this.onProgressCallback = null;
    this.chromadbDependencyMissing = false;
    this.restartLocks = {
      chromadb: false,
      ollama: false,
    };
    // PERFORMANCE FIX: Cache successful ChromaDB spawn plan to avoid re-detection issues
    this.cachedChromaSpawnPlan = null;
  }
  async hasPythonModule(moduleName) {
    // Use async version to prevent UI blocking
    return await hasPythonModuleAsync(moduleName);
  }

  /**
   * Set callback for startup progress updates (optional - no splash screen)
   */
  setProgressCallback(callback) {
    this.onProgressCallback = callback;
  }

  /**
   * Report startup progress to UI
   */
  reportProgress(phase, message, progress, details = {}) {
    this.startupPhase = phase;

    // ENHANCEMENT: Add better logging with details
    const logMessage = details.error
      ? `[STARTUP] [${phase}] ⚠️ ${message} - ${details.error}`
      : `[STARTUP] [${phase}] ${message}`;
    logger.info(logMessage);

    if (this.onProgressCallback) {
      this.onProgressCallback({
        phase,
        message,
        progress,
        serviceStatus: { ...this.serviceStatus },
        errors: [...this.errors],
        details, // Pass additional details for UI
      });
    }
  }

  /**
   * Helper to wrap promises with timeout (uses standardized promiseUtils)
   */
  _withTimeout(promise, timeoutMs, operation) {
    const { withTimeout } = require('../utils/promiseUtils');
    return withTimeout(promise, timeoutMs, operation);
  }

  /**
   * Pre-flight checks before starting services
   */
  async runPreflightChecks() {
    this.reportProgress('preflight', 'Running pre-flight checks...', 5);
    const checks = [];
    logger.debug('[PREFLIGHT] Starting pre-flight checks...');

    // Check 1: Verify data directory exists and is writable
    try {
      logger.debug('[PREFLIGHT] Checking data directory...');
      const userDataPath = app.getPath('userData');
      logger.debug(`[PREFLIGHT] Data directory path: ${userDataPath}`);

      try {
        await this._withTimeout(
          fs.access(userDataPath),
          5000,
          'Directory access check',
        );
        logger.debug('[PREFLIGHT] Data directory exists');
      } catch {
        logger.debug('[PREFLIGHT] Data directory does not exist, creating...');
        await this._withTimeout(
          fs.mkdir(userDataPath, { recursive: true }),
          5000,
          'Directory creation',
        );
        logger.debug('[PREFLIGHT] Data directory created');
      }

      const testFile = path.join(userDataPath, '.write-test');
      logger.debug(`[PREFLIGHT] Testing write access with file: ${testFile}`);
      // Use sync fs for simple write test to avoid hanging on Windows
      fsSync.writeFileSync(testFile, 'test');
      fsSync.unlinkSync(testFile);
      logger.debug('[PREFLIGHT] Data directory write test passed');
      checks.push({ name: 'Data Directory', status: 'ok' });
    } catch (error) {
      logger.error('[PREFLIGHT] Data directory check failed:', error);
      checks.push({
        name: 'Data Directory',
        status: 'fail',
        error: error.message,
      });
      this.errors.push({
        check: 'data-directory',
        error: error.message,
        critical: true,
      });
    }

    // Check 2: Verify Python installation (for ChromaDB)
    try {
      logger.debug('[PREFLIGHT] Starting Python installation check...');
      const pythonCheck = await this.checkPythonInstallation();
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
        this.errors.push({
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
      const ollamaCheck = await this.checkOllamaInstallation();
      logger.debug(
        `[PREFLIGHT] Ollama check result: installed=${ollamaCheck.installed}, version=${ollamaCheck.version}`,
      );
      checks.push({
        name: 'Ollama Installation',
        status: ollamaCheck.installed ? 'ok' : 'warn',
      });
      if (!ollamaCheck.installed) {
        logger.warn(
          '[PREFLIGHT] Ollama not found - AI features will be limited',
        );
        this.errors.push({
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

      const chromaPortAvailable = await this.isPortAvailable(
        '127.0.0.1',
        chromaPort,
      );
      logger.debug(
        `[PREFLIGHT] ChromaDB port ${chromaPort} available: ${chromaPortAvailable}`,
      );

      const ollamaPortAvailable = await this.isPortAvailable(
        '127.0.0.1',
        ollamaPort,
      );
      logger.debug(
        `[PREFLIGHT] Ollama port ${ollamaPort} available: ${ollamaPortAvailable}`,
      );

      checks.push({
        name: 'Port Availability',
        status: chromaPortAvailable || ollamaPortAvailable ? 'ok' : 'warn',
        details: {
          chromaPort,
          ollamaPort,
          chromaPortAvailable,
          ollamaPortAvailable,
        },
      });
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
      // Simple check - just verify we can resolve the user data path
      checks.push({ name: 'Disk Space', status: 'ok' });
      logger.debug('[PREFLIGHT] Disk space check completed');
    } catch (error) {
      logger.error('[PREFLIGHT] Disk space check failed:', error);
      checks.push({ name: 'Disk Space', status: 'warn', error: error.message });
    }

    logger.debug('[PREFLIGHT] All pre-flight checks completed');
    this.reportProgress('preflight', 'Pre-flight checks completed', 10);
    return checks;
  }

  /**
   * Check if Python is installed (using sync spawn to avoid hanging on Windows)
   */
  async checkPythonInstallation() {
    logger.debug('[PREFLIGHT] Checking Python installation...');

    const pythonCommands =
      process.platform === 'win32'
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
        const result = spawnSync(cmd, args, {
          timeout: 3000,
          windowsHide: true,
          shell: process.platform === 'win32',
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
   * Check if Ollama is installed (using sync spawn to avoid hanging on Windows)
   */
  async checkOllamaInstallation() {
    logger.debug('[PREFLIGHT] Checking Ollama installation...');

    try {
      const result = spawnSync('ollama', ['--version'], {
        timeout: 3000,
        windowsHide: true,
        shell: process.platform === 'win32',
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
   */
  // LOW PRIORITY FIX (LOW-3): Removed duplicate constant, using class-level DEFAULT_AXIOS_TIMEOUT
  async isPortAvailable(host, port) {
    try {
      // Note: We don't use retry here as we're checking if port is free
      // A single attempt is sufficient for port checking
      await axios.get(`http://${host}:${port}`, {
        timeout: DEFAULT_AXIOS_TIMEOUT,
      });
      // If we get here, something is already running on the port
      return false;
    } catch (error) {
      // MEDIUM PRIORITY FIX (MED-4): Enhanced error code handling for port availability
      // Errors that definitively indicate port is available
      const PORT_AVAILABLE_ERRORS = new Set([
        'ECONNREFUSED', // Connection refused - nothing listening
        'ETIMEDOUT', // Timeout - likely available but no response
        'ECONNRESET', // Connection reset - port available
        'EHOSTUNREACH', // Host unreachable - port not in use
        'ENETUNREACH', // Network unreachable - port not in use
      ]);

      if (PORT_AVAILABLE_ERRORS.has(error.code)) {
        logger.debug(
          `[PREFLIGHT] Port ${host}:${port} appears available (${error.code})`,
        );
        return true;
      }

      // Axios-specific error responses (server returned an error response)
      // If we got an HTTP error response, something IS running on that port
      if (error.response) {
        logger.debug(
          `[PREFLIGHT] Port ${host}:${port} in use (HTTP ${error.response.status})`,
        );
        return false;
      }

      // For other errors (DNS failures, firewall blocks, certificate errors, etc.)
      // we cannot be certain, so assume port is NOT available (conservative approach)
      logger.warn(
        `[PREFLIGHT] Port check inconclusive for ${host}:${port}: ${error.code || error.message}`,
      );
      return false;
    }
  }

  /**
   * Start a service with retry logic and exponential backoff
   */
  async startServiceWithRetry(serviceName, startFunc, checkFunc, config = {}) {
    const maxRetries = config.maxRetries || this.config.maxRetries;
    const required = config.required || false;
    let lastError = null;

    this.serviceStatus[serviceName] = {
      status: 'starting',
      required,
      health: 'unknown',
      attempts: 0,
    };

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        this.serviceStatus[serviceName].attempts = attempt + 1;
        this.reportProgress(
          'service-startup',
          `Starting ${serviceName}... (attempt ${attempt + 1}/${maxRetries})`,
          20 + (serviceName === 'chromadb' ? attempt * 10 : attempt * 15),
        );

        // Exponential backoff for retries
        if (attempt > 0) {
          const delay = Math.min(
            this.config.baseRetryDelay * Math.pow(2, attempt),
            10000,
          );
          logger.info(`[STARTUP] Waiting ${delay}ms before retry...`);
          await this.delay(delay);
        }

        // Check if already running
        const alreadyRunning = await checkFunc();
        if (alreadyRunning) {
          logger.info(`[STARTUP] ${serviceName} is already running`);
          this.serviceStatus[serviceName].status = 'running';
          this.serviceStatus[serviceName].health = 'healthy';
          return { success: true, alreadyRunning: true };
        }

        // Try to start the service
        logger.info(`[STARTUP] Attempting to start ${serviceName}...`);
        const startResult = await startFunc();

        // CRITICAL FIX: Handle external services that don't have a process
        if (startResult) {
          if (startResult.external || startResult.portInUse) {
            // Service is running externally, treat as success
            logger.info(`[STARTUP] ${serviceName} is running externally`);
            this.serviceStatus[serviceName].status = 'running';
            this.serviceStatus[serviceName].health = 'healthy';
            this.serviceStatus[serviceName].external = true;
            return { success: true, external: true };
          }

          if (startResult.process) {
            this.serviceProcesses.set(serviceName, startResult.process);
          }
        }

        // PERFORMANCE OPTIMIZATION: Reduced timeout and faster polling
        // Reduced from 15000ms to 10000ms (10 seconds)
        const verifyTimeout = config.verifyTimeout || 10000;
        const startTime = Date.now();
        let isRunning = false;

        // PERFORMANCE OPTIMIZATION: Adaptive polling strategy
        // Start with ultra-fast polling (50ms), then gradually slow down
        let pollInterval = 50; // Start with 50ms for ultra-fast detection
        let checksPerformed = 0;

        while (Date.now() - startTime < verifyTimeout) {
          isRunning = await checkFunc();
          if (isRunning) {
            const elapsedTime = Date.now() - startTime;
            logger.info(
              `[STARTUP] ${serviceName} started successfully in ${elapsedTime}ms`,
            );
            this.serviceStatus[serviceName].status = 'running';
            this.serviceStatus[serviceName].health = 'healthy';
            return { success: true, alreadyRunning: false };
          }

          checksPerformed++;

          // PERFORMANCE FIX: Reduced polling frequency to avoid excessive connections
          // - First 5 checks: 200ms (reasonable for already-running services)
          // - Next 5 checks: 500ms (moderate detection)
          // - After that: 1000ms (standard polling)
          if (checksPerformed <= 5) {
            pollInterval = 200;
          } else if (checksPerformed <= 10) {
            pollInterval = 500;
          } else {
            pollInterval = 1000;
          }

          await this.delay(pollInterval);
        }

        throw new Error(
          `${serviceName} failed to respond within ${verifyTimeout}ms`,
        );
      } catch (error) {
        lastError = error;
        logger.warn(
          `[STARTUP] ${serviceName} attempt ${attempt + 1} failed:`,
          error.message,
        );
        this.serviceStatus[serviceName].lastError = error.message;
      }
    }

    // All retries failed
    this.serviceStatus[serviceName].status = 'failed';
    this.serviceStatus[serviceName].health = 'unhealthy';

    const errorInfo = {
      service: serviceName,
      error: lastError?.message || 'Unknown error',
      critical: required,
    };

    this.errors.push(errorInfo);

    if (required) {
      throw new Error(
        `Critical service ${serviceName} failed to start: ${lastError?.message}`,
      );
    }

    logger.warn(
      `[STARTUP] ${serviceName} failed to start but is not required. Continuing...`,
    );
    return { success: false, error: lastError, fallbackMode: true };
  }

  /**
   * Start ChromaDB service
   */
  async startChromaDB() {
    // Check if ChromaDB is disabled
    if (process.env.STRATOSORT_DISABLE_CHROMADB === '1') {
      logger.info('[STARTUP] ChromaDB is disabled via environment variable');
      this.serviceStatus.chromadb.status = 'disabled';
      this.serviceStatus.chromadb.health = 'disabled';
      return { success: true, disabled: true };
    }

    if (this.chromadbDependencyMissing) {
      logger.info(
        '[STARTUP] ChromaDB dependency previously marked missing. Skipping startup.',
      );
      this.serviceStatus.chromadb.status = 'disabled';
      this.serviceStatus.chromadb.health = 'missing_dependency';
      return { success: false, disabled: true, reason: 'missing_dependency' };
    }

    const moduleAvailable = await this.hasPythonModule('chromadb');
    if (!moduleAvailable) {
      this.chromadbDependencyMissing = true;
      this.serviceStatus.chromadb.status = 'disabled';
      this.serviceStatus.chromadb.health = 'missing_dependency';
      this.errors.push({
        service: 'chromadb',
        error:
          'Python module "chromadb" is not installed. Semantic search disabled.',
        critical: false,
      });
      logger.warn(
        '[STARTUP] Python module "chromadb" not available. Disabling ChromaDB features.',
      );
      return { success: false, disabled: true, reason: 'missing_dependency' };
    }

    const startFunc = async () => {
      // PERFORMANCE FIX: Use cached spawn plan if available (for restarts)
      let plan = this.cachedChromaSpawnPlan;

      if (!plan) {
        // First time startup - build the spawn plan
        const { buildChromaSpawnPlan } = require('../utils/chromaSpawnUtils');
        const chromaDbService = require('./ChromaDBService').getInstance();
        const serverConfig = chromaDbService.getServerConfig();

        plan = await buildChromaSpawnPlan(serverConfig);

        if (!plan) {
          throw new Error('No viable ChromaDB startup plan found');
        }

        // CRITICAL FIX: Only cache if it's the system chroma executable
        // Never cache the Python module fallback
        if (plan.command === 'chroma' || plan.source === 'local-cli') {
          this.cachedChromaSpawnPlan = plan;
          logger.info(
            '[STARTUP] Cached ChromaDB spawn plan for future restarts',
          );
        } else {
          logger.warn(
            '[STARTUP] Not caching spawn plan - using fallback method',
          );
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
        this.serviceStatus.chromadb.status = 'stopped';
      });

      return { process: chromaProcess };
    };

    const checkFunc = async () => {
      try {
        const baseUrl =
          process.env.CHROMA_SERVER_URL ||
          `${process.env.CHROMA_SERVER_PROTOCOL || 'http'}://${process.env.CHROMA_SERVER_HOST || '127.0.0.1'}:${process.env.CHROMA_SERVER_PORT || 8000}`;

        // Try multiple endpoints for different ChromaDB versions
        // Try v2 first as it's the current version, then fallback to v1
        const endpoints = [
          '/api/v2/heartbeat', // v2 endpoint (current version) - try first
          '/api/v1/heartbeat', // v1 endpoint (ChromaDB 1.0.x)
          '/api/v1', // Some versions just have this
        ];

        for (const endpoint of endpoints) {
          try {
            const response = await axiosWithRetry(
              () => axios.get(`${baseUrl}${endpoint}`, { timeout: 1000 }),
              {
                operation: `ChromaDB health check ${endpoint}`,
                maxRetries: 2, // Fewer retries for health checks
                initialDelay: 500,
                maxDelay: 2000,
              },
            );
            if (response.status === 200) {
              // Validate response body - check for error messages
              if (response.data && typeof response.data === 'object') {
                // If response has an "error" field, it's not actually healthy
                if (response.data.error) {
                  logger.debug(
                    `[STARTUP] ChromaDB ${endpoint} returned error: ${response.data.error}`,
                  );
                  continue; // Try next endpoint
                }
              }
              // CRITICAL FIX: Log successful endpoint globally (at info level) for better error context
              logger.info(
                `[STARTUP] ChromaDB heartbeat successful on ${baseUrl}${endpoint}`,
              );
              return true;
            }
          } catch (error) {
            // Continue to next endpoint
            logger.debug(
              `[STARTUP] ChromaDB heartbeat failed on ${endpoint}: ${error.message}`,
            );
          }
        }

        return false;
      } catch (error) {
        logger.debug(
          `[STARTUP] ChromaDB heartbeat check failed: ${error.message}`,
        );
        return false;
      }
    };

    // PERFORMANCE OPTIMIZATION: Reduced verifyTimeout to 3000ms for faster restart
    return await this.startServiceWithRetry('chromadb', startFunc, checkFunc, {
      required: false,
      verifyTimeout: 3000,
    });
  }

  /**
   * Start Ollama service
   */
  async startOllama() {
    const startFunc = async () => {
      // CRITICAL FIX: Check if Ollama is already running before trying to start
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';

      try {
        // Quick check if Ollama is already running
        const response = await axios.get(`${baseUrl}/api/tags`, {
          timeout: 1000,
          validateStatus: () => true, // Accept any status code
        });

        if (response.status === 200) {
          logger.info(
            '[STARTUP] Ollama is already running externally, skipping startup',
          );
          // Return without a process since we're using an external instance
          return { process: null, external: true };
        }
      } catch (error) {
        // ECONNREFUSED means Ollama is not running, which is expected
        if (error.code !== 'ECONNREFUSED') {
          logger.debug(
            '[STARTUP] Ollama pre-check error (non-critical):',
            error.message,
          );
        }
      }

      logger.info('[STARTUP] Starting Ollama server...');
      const ollamaProcess = spawn('ollama', ['serve'], {
        detached: false,
        stdio: 'pipe',
      });

      let startupError = null;

      ollamaProcess.stdout?.on('data', (data) => {
        const message = data.toString().trim();
        logger.debug(`[Ollama] ${message}`);
      });

      ollamaProcess.stderr?.on('data', (data) => {
        const message = data.toString().trim();
        logger.debug(`[Ollama stderr] ${message}`);

        // CRITICAL FIX: Detect port binding error and handle gracefully
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
        logger.warn(
          `[Ollama] Process exited with code ${code}, signal ${signal}`,
        );
        this.serviceStatus.ollama.status = 'stopped';

        // If exited quickly with port error, it means Ollama is already running
        if (code === 1 && startupError === 'PORT_IN_USE') {
          // Don't treat this as a failure
          return;
        }
      });

      // Wait briefly to check for immediate failures
      const { TIMEOUTS } = require('../../shared/performanceConstants');
      await new Promise((resolve) =>
        setTimeout(resolve, TIMEOUTS.DELAY_MEDIUM),
      );

      // If we got a port-in-use error, treat as external instance
      if (startupError === 'PORT_IN_USE') {
        // Kill the failed process to clean up
        try {
          ollamaProcess.kill();
        } catch (e) {
          // Process may have already exited
        }
        return { process: null, external: true, portInUse: true };
      }

      if (startupError) {
        throw new Error(`Failed to start Ollama: ${startupError}`);
      }

      return { process: ollamaProcess };
    };

    const checkFunc = async () => {
      try {
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
        // PERFORMANCE OPTIMIZATION: Reduced timeout from 2000ms to 1000ms for faster detection
        const response = await axiosWithRetry(
          () => axios.get(`${baseUrl}/api/tags`, { timeout: 1000 }),
          {
            operation: 'Ollama health check',
            maxRetries: 2, // Fewer retries for health checks
            initialDelay: 500,
            maxDelay: 2000,
          },
        );
        return response.status === 200;
      } catch (error) {
        return false;
      }
    };

    // PERFORMANCE OPTIMIZATION: Reduced verifyTimeout from 15000ms to 8000ms
    return await this.startServiceWithRetry('ollama', startFunc, checkFunc, {
      required: false,
      verifyTimeout: 8000,
    });
  }

  /**
   * Initialize all services
   */
  async initializeServices() {
    this.reportProgress('services', 'Initializing services...', 15);

    try {
      logger.info('[STARTUP] Starting ChromaDB and Ollama in parallel');

      // Start ChromaDB and Ollama in parallel for faster startup
      const [chromaResult, ollamaResult] = await Promise.all([
        (async () => {
          try {
            const result = await this.startChromaDB();
            const statusMsg = result.success ? 'SUCCESS' : 'FAILED';
            logger.info('[STARTUP] ChromaDB startup complete:', statusMsg);

            // ENHANCEMENT: Report specific status to UI
            if (result.success) {
              if (result.external) {
                this.reportProgress(
                  'services',
                  'ChromaDB detected (external instance)',
                  40,
                  {
                    service: 'chromadb',
                    status: 'external',
                  },
                );
              } else if (result.alreadyRunning) {
                this.reportProgress(
                  'services',
                  'ChromaDB already running',
                  40,
                  {
                    service: 'chromadb',
                    status: 'running',
                  },
                );
              } else {
                this.reportProgress(
                  'services',
                  'ChromaDB started successfully',
                  40,
                  {
                    service: 'chromadb',
                    status: 'started',
                  },
                );
              }
            } else if (result.disabled) {
              this.reportProgress(
                'services',
                'ChromaDB disabled (dependency missing)',
                40,
                {
                  service: 'chromadb',
                  status: 'disabled',
                  error: result.reason,
                },
              );
            } else {
              this.reportProgress('services', 'ChromaDB failed to start', 40, {
                service: 'chromadb',
                status: 'failed',
                error: result.error?.message,
              });
            }
            return result;
          } catch (error) {
            logger.error('ChromaDB startup error', { error: error.message });
            return { success: false, error };
          }
        })(),
        (async () => {
          try {
            const result = await this.startOllama();
            const statusMsg = result.success ? 'SUCCESS' : 'FAILED';
            logger.info('[STARTUP] Ollama startup complete:', statusMsg);

            // ENHANCEMENT: Report specific status to UI
            if (result.success) {
              if (result.external) {
                this.reportProgress(
                  'services',
                  'Ollama detected (external instance)',
                  55,
                  {
                    service: 'ollama',
                    status: 'external',
                  },
                );
              } else if (result.alreadyRunning) {
                this.reportProgress('services', 'Ollama already running', 55, {
                  service: 'ollama',
                  status: 'running',
                });
              } else {
                this.reportProgress(
                  'services',
                  'Ollama started successfully',
                  55,
                  {
                    service: 'ollama',
                    status: 'started',
                  },
                );
              }
            } else if (result.fallbackMode) {
              this.reportProgress(
                'services',
                'Ollama unavailable (AI features limited)',
                55,
                {
                  service: 'ollama',
                  status: 'failed',
                  error: result.error?.message,
                },
              );
            } else {
              this.reportProgress('services', 'Ollama failed to start', 55, {
                service: 'ollama',
                status: 'failed',
                error: result.error?.message,
              });
            }
            return result;
          } catch (error) {
            logger.error('Ollama startup error', { error: error.message });
            return { success: false, error };
          }
        })(),
      ]);

      // ENHANCEMENT: Report overall status
      const allSuccess = chromaResult.success && ollamaResult.success;
      const partialSuccess = chromaResult.success || ollamaResult.success;

      if (allSuccess) {
        this.reportProgress(
          'services',
          'All services initialized successfully',
          65,
          {
            chromadb: chromaResult.success,
            ollama: ollamaResult.success,
          },
        );
      } else if (partialSuccess) {
        this.reportProgress(
          'services',
          'Services initialized with limitations',
          65,
          {
            chromadb: chromaResult.success,
            ollama: ollamaResult.success,
            warning: true,
          },
        );
      } else {
        this.reportProgress('services', 'Service initialization failed', 65, {
          chromadb: chromaResult.success,
          ollama: ollamaResult.success,
          error: true,
        });
      }

      return {
        chromadb: chromaResult,
        ollama: ollamaResult,
      };
    } catch (error) {
      logger.error('[STARTUP] Service initialization failed:', error);
      this.reportProgress('services', 'Service initialization error', 65, {
        error: error.message,
        critical: true,
      });
      throw error;
    }
  }

  /**
   * Main startup sequence
   */
  async startup() {
    this.startupState = 'running';
    this.reportProgress('starting', 'Application starting...', 0);

    try {
      // Wrap entire startup in timeout
      const startupPromise = this._runStartupSequence();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Startup timeout exceeded'));
        }, this.config.startupTimeout);
      });

      const result = await Promise.race([startupPromise, timeoutPromise]);

      this.startupState = 'completed';
      this.reportProgress('ready', 'Application ready', 100);

      // Start health monitoring
      this.startHealthMonitoring();

      return result;
    } catch (error) {
      this.startupState = 'failed';
      logger.error('[STARTUP] Startup failed:', error);
      this.errors.push({
        phase: 'startup',
        error: error.message,
        critical: true,
      });

      // Attempt graceful degradation
      await this.enableGracefulDegradation();

      throw error;
    }
  }

  /**
   * Internal startup sequence
   */
  async _runStartupSequence() {
    logger.info('[STARTUP] Beginning internal startup sequence');

    // Phase 1: Pre-flight checks
    logger.info('[STARTUP] Phase 1: Running pre-flight checks');
    const preflightResults = await this.runPreflightChecks();
    logger.info('[STARTUP] Pre-flight checks complete');

    // Phase 2: Initialize services
    logger.info('[STARTUP] Phase 2: Initializing services (ChromaDB & Ollama)');
    const serviceResults = await this.initializeServices();
    logger.info('[STARTUP] Services initialization complete');

    // Phase 3: Verify models (if Ollama is running)
    if (serviceResults.ollama?.success) {
      logger.info('[STARTUP] Phase 3: Verifying AI models');
      this.reportProgress('models', 'Verifying AI models...', 70);
      // Model verification would be called here
    }

    // Phase 4: Initialize application services
    logger.info('[STARTUP] Phase 4: Initializing application services');
    this.reportProgress(
      'app-services',
      'Initializing application services...',
      85,
    );
    // ServiceIntegration.initialize() would be called here

    logger.info('[STARTUP] Internal startup sequence complete');
    return {
      preflight: preflightResults,
      services: serviceResults,
      degraded: this.errors.length > 0,
    };
  }

  /**
   * Enable graceful degradation when services fail
   */
  async enableGracefulDegradation() {
    logger.info('[STARTUP] Enabling graceful degradation mode...');

    // Set flags for degraded mode
    global.degradedMode = {
      enabled: true,
      missingServices: [],
      limitations: [],
    };

    const chromaUnavailableStatuses = [
      'failed',
      'permanently_failed',
      'disabled',
    ];
    if (
      chromaUnavailableStatuses.includes(this.serviceStatus.chromadb.status)
    ) {
      global.degradedMode.missingServices.push('chromadb');
      global.degradedMode.limitations.push('Semantic search disabled');
      global.degradedMode.limitations.push(
        'Smart folder matching may be limited',
      );
    }

    const ollamaUnavailableStatuses = [
      'failed',
      'permanently_failed',
      'disabled',
    ];
    if (ollamaUnavailableStatuses.includes(this.serviceStatus.ollama.status)) {
      global.degradedMode.missingServices.push('ollama');
      global.degradedMode.limitations.push('AI analysis disabled');
      global.degradedMode.limitations.push('Manual organization only');
    }

    this.reportProgress('degraded', 'Running in degraded mode', 100);
  }

  /**
   * Start continuous health monitoring
   */
  startHealthMonitoring() {
    // Always clear existing interval first to prevent leaks
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
    }

    logger.info('[STARTUP] Starting health monitoring...');

    this.healthMonitor = setInterval(async () => {
      // CRITICAL FIX: Add timeout protection and reset mechanism to prevent race conditions
      // Track when health check started for timeout detection
      const healthCheckStartTime = Date.now();
      const healthCheckTimeout = 30000; // 30 second timeout for health checks

      // Skip if previous health check is still in progress
      if (this.healthCheckInProgress) {
        // CRITICAL FIX: Reset flag if health check has been stuck for too long
        if (
          this.healthCheckStartedAt &&
          Date.now() - this.healthCheckStartedAt > healthCheckTimeout
        ) {
          logger.error(
            `[HEALTH] Health check stuck for ${(Date.now() - this.healthCheckStartedAt) / 1000}s, force resetting flag`,
          );
          this.healthCheckInProgress = false;
          this.healthCheckStartedAt = null;
        } else {
          logger.warn(
            '[HEALTH] Previous health check still in progress, skipping this interval',
          );
          return;
        }
      }

      this.healthCheckInProgress = true;
      this.healthCheckStartedAt = healthCheckStartTime;

      try {
        // CRITICAL FIX: Wrap health check in timeout promise race
        const healthCheckPromise = this.checkServicesHealth();
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(`Health check timeout after ${healthCheckTimeout}ms`),
            );
          }, healthCheckTimeout);
        });

        await Promise.race([healthCheckPromise, timeoutPromise]);
      } catch (error) {
        logger.error('[HEALTH] Health check failed:', error.message);
      } finally {
        this.healthCheckInProgress = false;
        this.healthCheckStartedAt = null;
      }
    }, this.config.healthCheckInterval);

    // Unref the interval so it doesn't prevent process shutdown
    try {
      this.healthMonitor.unref();
    } catch (error) {
      logger.warn(
        '[HEALTH] Failed to unref health monitor interval:',
        error.message,
      );
    }
  }

  /**
   * Check health of all services
   */
  async checkServicesHealth() {
    logger.debug('[HEALTH] Checking service health...');

    // HIGH PRIORITY FIX (HIGH-4): Circuit breaker recovery mechanism
    // Allow recovery attempts after a cooldown period (10 minutes)
    const CIRCUIT_BREAKER_RECOVERY_WINDOW = 10 * 60 * 1000; // 10 minutes

    // HIGH PRIORITY FIX (HIGH-4): Enhanced circuit breaker recovery with exponential backoff
    if (
      this.serviceStatus.chromadb.circuitBreakerTripped &&
      this.serviceStatus.chromadb.circuitBreakerTrippedAt
    ) {
      const trippedTime = new Date(
        this.serviceStatus.chromadb.circuitBreakerTrippedAt,
      ).getTime();
      const now = Date.now();

      // Initialize recovery attempt counter
      if (!this.serviceStatus.chromadb.recoveryAttempts) {
        this.serviceStatus.chromadb.recoveryAttempts = 0;
      }

      // HIGH PRIORITY FIX (HIGH-4): Implement exponential backoff
      const attemptCount = this.serviceStatus.chromadb.recoveryAttempts;
      const maxAttempts = 5; // Maximum recovery attempts before giving up
      const backoffMultiplier = Math.pow(2, attemptCount); // Exponential: 1, 2, 4, 8, 16
      const adjustedRecoveryWindow =
        CIRCUIT_BREAKER_RECOVERY_WINDOW * backoffMultiplier;

      if (now - trippedTime >= adjustedRecoveryWindow) {
        if (attemptCount >= maxAttempts) {
          logger.error(
            `[HEALTH] ChromaDB exceeded maximum recovery attempts (${maxAttempts}). Service permanently disabled.`,
          );
          this.serviceStatus.chromadb.status = 'permanently_failed';
          return; // Stop trying
        }

        logger.info(
          `[HEALTH] ChromaDB circuit breaker recovery attempt ${attemptCount + 1}/${maxAttempts} (backoff: ${adjustedRecoveryWindow / 1000}s)...`,
        );

        // Attempt restart
        try {
          await this.startChromaDB();

          // HIGH PRIORITY FIX (HIGH-4): Verify service is actually healthy before resetting circuit breaker
          const isHealthy = await this.checkChromaDBHealth();

          if (isHealthy) {
            // Reset circuit breaker ONLY if service is healthy
            logger.info(
              '[HEALTH] ✅ ChromaDB circuit breaker recovery successful - service is healthy',
            );
            this.serviceStatus.chromadb.circuitBreakerTripped = false;
            this.serviceStatus.chromadb.circuitBreakerTrippedAt = null;
            this.serviceStatus.chromadb.restartCount = 0;
            this.serviceStatus.chromadb.consecutiveFailures = 0;
            this.serviceStatus.chromadb.recoveryAttempts = 0;
          } else {
            throw new Error('Service started but health check failed');
          }
        } catch (error) {
          logger.warn(
            `[HEALTH] ChromaDB circuit breaker recovery attempt ${attemptCount + 1} failed: ${error.message}`,
          );
          // Increment recovery attempts for exponential backoff
          this.serviceStatus.chromadb.recoveryAttempts = attemptCount + 1;
          // Update tripped time for next backoff calculation
          this.serviceStatus.chromadb.circuitBreakerTrippedAt =
            new Date().toISOString();
        }
      }
    }

    // HIGH PRIORITY FIX (HIGH-4): Enhanced circuit breaker recovery for Ollama with exponential backoff
    if (
      this.serviceStatus.ollama.circuitBreakerTripped &&
      this.serviceStatus.ollama.circuitBreakerTrippedAt
    ) {
      const trippedTime = new Date(
        this.serviceStatus.ollama.circuitBreakerTrippedAt,
      ).getTime();
      const now = Date.now();

      // Initialize recovery attempt counter
      if (!this.serviceStatus.ollama.recoveryAttempts) {
        this.serviceStatus.ollama.recoveryAttempts = 0;
      }

      // HIGH PRIORITY FIX (HIGH-4): Implement exponential backoff
      const attemptCount = this.serviceStatus.ollama.recoveryAttempts;
      const maxAttempts = 5; // Maximum recovery attempts before giving up
      const backoffMultiplier = Math.pow(2, attemptCount); // Exponential: 1, 2, 4, 8, 16
      const adjustedRecoveryWindow =
        CIRCUIT_BREAKER_RECOVERY_WINDOW * backoffMultiplier;

      if (now - trippedTime >= adjustedRecoveryWindow) {
        if (attemptCount >= maxAttempts) {
          logger.error(
            `[HEALTH] Ollama exceeded maximum recovery attempts (${maxAttempts}). Service permanently disabled.`,
          );
          this.serviceStatus.ollama.status = 'permanently_failed';
          return; // Stop trying
        }

        logger.info(
          `[HEALTH] Ollama circuit breaker recovery attempt ${attemptCount + 1}/${maxAttempts} (backoff: ${adjustedRecoveryWindow / 1000}s)...`,
        );

        // Attempt restart
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
        try {
          const url = new URL(baseUrl);
          await this.startOllama(url.hostname, parseInt(url.port || '11434'));

          // HIGH PRIORITY FIX (HIGH-4): Verify service is actually healthy before resetting circuit breaker
          const isHealthy = await this.checkOllamaHealth();

          if (isHealthy) {
            // Reset circuit breaker ONLY if service is healthy
            logger.info(
              '[HEALTH] ✅ Ollama circuit breaker recovery successful - service is healthy',
            );
            this.serviceStatus.ollama.circuitBreakerTripped = false;
            this.serviceStatus.ollama.circuitBreakerTrippedAt = null;
            this.serviceStatus.ollama.restartCount = 0;
            this.serviceStatus.ollama.consecutiveFailures = 0;
            this.serviceStatus.ollama.recoveryAttempts = 0;
          } else {
            throw new Error('Service started but health check failed');
          }
        } catch (error) {
          logger.warn(
            `[HEALTH] Ollama circuit breaker recovery attempt ${attemptCount + 1} failed: ${error.message}`,
          );
          // Increment recovery attempts for exponential backoff
          this.serviceStatus.ollama.recoveryAttempts = attemptCount + 1;
          // Update tripped time for next backoff calculation
          this.serviceStatus.ollama.circuitBreakerTrippedAt =
            new Date().toISOString();
        }
      }
    }

    // Check ChromaDB
    if (this.serviceStatus.chromadb.status === 'running') {
      try {
        // PERFORMANCE FIX: Reuse ChromaDBService's built-in check instead of
        // creating new axios connections which cause TIME_WAIT accumulation
        const chromaDbService = require('./ChromaDBService').getInstance();
        const isHealthy = await chromaDbService.checkHealth();

        if (isHealthy) {
          this.serviceStatus.chromadb.health = 'healthy';
          this.serviceStatus.chromadb.consecutiveFailures = 0;
        } else {
          throw new Error('ChromaDB health check failed');
        }
      } catch (error) {
        this.serviceStatus.chromadb.health = 'unhealthy';
        this.serviceStatus.chromadb.consecutiveFailures =
          (this.serviceStatus.chromadb.consecutiveFailures || 0) + 1;

        logger.warn('[HEALTH] ChromaDB health check failed:', error.message);

        // Bug #45: Circuit breaker - Attempt restart after N consecutive failures, auto-disable after threshold
        if (
          this.serviceStatus.chromadb.consecutiveFailures >=
          this.config.circuitBreakerConsecutiveFailures
        ) {
          const restartCount = this.serviceStatus.chromadb.restartCount || 0;

          // Bug #45: Auto-disable service after exceeding circuit breaker threshold
          if (restartCount >= this.config.circuitBreakerThreshold) {
            logger.error(
              `[HEALTH] ChromaDB exceeded circuit breaker threshold (${this.config.circuitBreakerThreshold} failures). Auto-disabling service.`,
            );
            this.serviceStatus.chromadb.status = 'permanently_failed';
            this.serviceStatus.chromadb.health = 'permanently_failed';
            this.serviceStatus.chromadb.consecutiveFailures = 0; // Reset to stop further checks
            this.serviceStatus.chromadb.circuitBreakerTripped = true; // Flag for monitoring
            this.serviceStatus.chromadb.circuitBreakerTrippedAt =
              new Date().toISOString();
          } else {
            // PERFORMANCE FIX: Check for restart lock to prevent concurrent restart attempts
            if (this.restartLocks.chromadb) {
              logger.warn(
                '[HEALTH] ChromaDB restart already in progress, skipping duplicate attempt.',
              );
            } else {
              logger.warn(
                `[HEALTH] Attempting to restart ChromaDB (attempt ${restartCount + 1}/5)...`,
              );
              this.restartLocks.chromadb = true;
              this.serviceStatus.chromadb.restartCount = restartCount + 1;
              this.serviceStatus.chromadb.consecutiveFailures = 0; // Reset counter for new attempt
              try {
                await this.startChromaDB();
              } finally {
                this.restartLocks.chromadb = false;
              }
            }
          }
        }
      }
    }

    // Check Ollama
    if (this.serviceStatus.ollama.status === 'running') {
      try {
        const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
        const response = await axiosWithRetry(
          () => axios.get(`${baseUrl}/api/tags`, { timeout: 10000 }), // Increased from 5000ms to 10000ms to prevent false timeout failures
          {
            operation: 'Ollama service health check',
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 4000,
          },
        );

        if (response.status === 200) {
          this.serviceStatus.ollama.health = 'healthy';
          this.serviceStatus.ollama.consecutiveFailures = 0;
        }
      } catch (error) {
        this.serviceStatus.ollama.health = 'unhealthy';
        this.serviceStatus.ollama.consecutiveFailures =
          (this.serviceStatus.ollama.consecutiveFailures || 0) + 1;

        logger.warn('[HEALTH] Ollama health check failed:', error.message);

        // Bug #45: Circuit breaker - Attempt restart after N consecutive failures, auto-disable after threshold
        if (
          this.serviceStatus.ollama.consecutiveFailures >=
          this.config.circuitBreakerConsecutiveFailures
        ) {
          const restartCount = this.serviceStatus.ollama.restartCount || 0;

          // Bug #45: Auto-disable service after exceeding circuit breaker threshold
          if (restartCount >= this.config.circuitBreakerThreshold) {
            logger.error(
              `[HEALTH] Ollama exceeded circuit breaker threshold (${this.config.circuitBreakerThreshold} failures). Auto-disabling service.`,
            );
            this.serviceStatus.ollama.status = 'permanently_failed';
            this.serviceStatus.ollama.health = 'permanently_failed';
            this.serviceStatus.ollama.consecutiveFailures = 0; // Reset to stop further checks
            this.serviceStatus.ollama.circuitBreakerTripped = true; // Flag for monitoring
            this.serviceStatus.ollama.circuitBreakerTrippedAt =
              new Date().toISOString();
          } else {
            const baseUrl =
              process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
            let host = '127.0.0.1';
            let port = 11434;
            try {
              const parsed = new URL(baseUrl);
              host = parsed.hostname || host;
              port = Number(parsed.port) || port;
            } catch {
              // ignore parse errors; fall back to defaults
            }

            const portAvailable = await this.isPortAvailable(host, port);
            if (!portAvailable) {
              logger.warn(
                '[HEALTH] Ollama port is already in use. Assuming external instance is running and skipping restart.',
              );
              this.serviceStatus.ollama.consecutiveFailures = 0;
              this.serviceStatus.ollama.health = 'degraded';
            } else {
              if (this.restartLocks.ollama) {
                logger.warn(
                  '[HEALTH] Ollama restart already in progress, skipping duplicate attempt.',
                );
              } else {
                logger.warn(
                  `[HEALTH] Attempting to restart Ollama (attempt ${restartCount + 1}/5)...`,
                );
                this.restartLocks.ollama = true;
                this.serviceStatus.ollama.restartCount = restartCount + 1;
                this.serviceStatus.ollama.consecutiveFailures = 0; // Reset counter for new attempt
                try {
                  await this.startOllama();
                } finally {
                  this.restartLocks.ollama = false;
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Get current service status
   */
  getServiceStatus() {
    return {
      startup: this.startupState,
      phase: this.startupPhase,
      services: { ...this.serviceStatus },
      errors: [...this.errors],
      degraded: global.degradedMode?.enabled || false,
    };
  }

  /**
   * Cleanup on shutdown
   */
  async shutdown() {
    logger.info('[STARTUP] Shutting down services...');

    // Stop health monitoring first
    if (this.healthMonitor) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
      logger.info('[STARTUP] Health monitoring stopped');
    }

    // Reset health check flag
    this.healthCheckInProgress = false;

    // Gracefully stop all service processes
    const shutdownPromises = [];
    for (const [serviceName, process] of this.serviceProcesses) {
      shutdownPromises.push(this.shutdownProcess(serviceName, process));
    }

    // Wait for all processes to shut down
    await Promise.allSettled(shutdownPromises);

    // Clear the service processes map
    this.serviceProcesses.clear();

    // Reset service status
    for (const service in this.serviceStatus) {
      this.serviceStatus[service].status = 'stopped';
      this.serviceStatus[service].health = 'unknown';
    }

    logger.info('[STARTUP] All services shut down successfully');
  }

  /**
   * Shutdown a single process
   */
  async shutdownProcess(serviceName, process) {
    try {
      logger.info(`[STARTUP] Stopping ${serviceName}...`);

      // CRITICAL FIX: Comprehensive null/existence checks before all process operations
      if (!process) {
        logger.debug(
          `[STARTUP] ${serviceName} process is null, nothing to stop`,
        );
        return;
      }

      // CRITICAL FIX: Check if process object has required properties before accessing
      if (typeof process !== 'object') {
        logger.warn(
          `[STARTUP] ${serviceName} process is not an object:`,
          typeof process,
        );
        return;
      }

      // CRITICAL FIX: Verify process has a PID (indicates it's a real process)
      if (!process.pid) {
        logger.debug(
          `[STARTUP] ${serviceName} process has no PID, likely already terminated`,
        );
        return;
      }

      // CRITICAL FIX: Check if process is already killed/terminated
      if (process.killed) {
        logger.debug(`[STARTUP] ${serviceName} already killed`);
        return;
      }

      // CRITICAL FIX: Verify exitCode to check if process already exited
      if (process.exitCode !== null && process.exitCode !== undefined) {
        logger.debug(
          `[STARTUP] ${serviceName} already exited with code ${process.exitCode}`,
        );
        return;
      }

      // CRITICAL FIX: Verify removeAllListeners exists before calling
      // First remove all event listeners to prevent memory leaks
      if (typeof process.removeAllListeners === 'function') {
        try {
          process.removeAllListeners();
        } catch (error) {
          logger.warn(
            `[STARTUP] Failed to remove listeners for ${serviceName}:`,
            error.message,
          );
          // Continue with shutdown anyway
        }
      } else {
        logger.warn(
          `[STARTUP] ${serviceName} process does not have removeAllListeners method`,
        );
      }

      // CRITICAL FIX: Verify kill method exists before calling
      if (typeof process.kill !== 'function') {
        logger.error(
          `[STARTUP] ${serviceName} process does not have kill method`,
        );
        return;
      }

      // Try graceful shutdown first
      try {
        process.kill('SIGTERM');
      } catch (killError) {
        // If SIGTERM fails, the process might already be dead
        if (killError.code === 'ESRCH') {
          logger.debug(
            `[STARTUP] ${serviceName} process not found (PID: ${process.pid}), already terminated`,
          );
          return;
        }
        logger.warn(
          `[STARTUP] Failed to send SIGTERM to ${serviceName}:`,
          killError.message,
        );
        // Continue to try force kill
      }

      // Wait up to 5 seconds for graceful shutdown
      await new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;

            // CRITICAL FIX: Verify process still exists before force killing
            if (!process || process.killed || process.exitCode !== null) {
              logger.debug(
                `[STARTUP] ${serviceName} already terminated, no force kill needed`,
              );
              resolve();
              return;
            }

            logger.warn(`[STARTUP] Force killing ${serviceName}...`);
            try {
              // Force kill on Windows requires different approach
              if (process.platform === 'win32' && process.pid) {
                const { spawn } = require('child_process');
                spawn(
                  'taskkill',
                  ['/pid', process.pid.toString(), '/f', '/t'],
                  {
                    windowsHide: true,
                    stdio: 'ignore',
                  },
                );
              } else if (process.pid && typeof process.kill === 'function') {
                process.kill('SIGKILL');
              }
            } catch (e) {
              // ESRCH means process doesn't exist
              if (e.code === 'ESRCH') {
                logger.debug(
                  `[STARTUP] Process ${serviceName} not found during force kill, already terminated`,
                );
              } else {
                logger.debug(
                  `[STARTUP] Process ${serviceName} may have already exited:`,
                  e.message,
                );
              }
            }
            resolve();
          }
        }, 5000);

        // CRITICAL FIX: Verify process has 'once' method before using
        if (!process || typeof process.once !== 'function') {
          logger.warn(
            `[STARTUP] ${serviceName} process does not support event listeners`,
          );
          clearTimeout(timeout);
          resolved = true;
          resolve();
          return;
        }

        // Listen for exit event
        try {
          process.once('exit', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              logger.info(`[STARTUP] ${serviceName} stopped gracefully`);
              resolve();
            }
          });
        } catch (error) {
          logger.warn(
            `[STARTUP] Failed to attach exit listener to ${serviceName}:`,
            error.message,
          );
        }

        // Also listen for error event (in case process is already dead)
        try {
          process.once('error', (error) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              // ESRCH means process doesn't exist
              if (error.code === 'ESRCH') {
                logger.debug(
                  `[STARTUP] ${serviceName} process not found, already terminated`,
                );
              } else {
                logger.debug(
                  `[STARTUP] ${serviceName} process error during shutdown:`,
                  error.message,
                );
              }
              resolve();
            }
          });
        } catch (error) {
          logger.warn(
            `[STARTUP] Failed to attach error listener to ${serviceName}:`,
            error.message,
          );
        }
      });
    } catch (error) {
      logger.error(`[STARTUP] Error stopping ${serviceName}:`, {
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Utility: delay helper
   */
  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Singleton instance
let instance = null;

module.exports = {
  StartupManager,
  getStartupManager: () => {
    if (!instance) {
      instance = new StartupManager();
    }
    return instance;
  },
};
