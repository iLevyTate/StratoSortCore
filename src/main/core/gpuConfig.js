/**
 * GPU Configuration
 *
 * GPU preference settings and hardware acceleration handling.
 * Extracted from simple-main.js for better maintainability.
 *
 * @module core/gpuConfig
 */

const { app } = require('electron');
const { logger } = require('../../shared/logger');

logger.setContext('GPU');

/**
 * Check if software rendering is forced
 */
const forceSoftwareRenderer =
  process.env.STRATOSORT_FORCE_SOFTWARE_GPU === '1' || process.env.ELECTRON_FORCE_SOFTWARE === '1';

/**
 * Time-based sliding window for GPU failure tracking
 */
const GPU_FAILURE_RESET_WINDOW = 60 * 60 * 1000; // 1 hour
let gpuFailureCount = 0;
let lastGpuFailureTime = 0;

/**
 * Initialize GPU configuration
 * Must be called before app.ready
 */
function initializeGpuConfig() {
  try {
    if (forceSoftwareRenderer) {
      app.disableHardwareAcceleration();
      logger.warn('[GPU] Hardware acceleration disabled via STRATOSORT_FORCE_SOFTWARE_GPU');
    } else {
      // Use ANGLE with D3D11 backend for better Windows compatibility
      const angleBackend = process.env.ANGLE_BACKEND || 'd3d11';
      app.commandLine.appendSwitch('use-angle', angleBackend);

      // Only set use-gl if explicitly requested
      const glImplementation = process.env.STRATOSORT_GL_IMPLEMENTATION;
      if (glImplementation) {
        app.commandLine.appendSwitch('use-gl', glImplementation);
        logger.info(`[GPU] Custom GL implementation set: ${glImplementation}`);
      }

      // Safer GPU settings
      app.commandLine.appendSwitch('ignore-gpu-blocklist');

      logger.info(`[GPU] Flags set: ANGLE=${angleBackend}`);
    }
  } catch (e) {
    logger.warn('[GPU] Failed to apply GPU flags:', e?.message || 'Unknown error');
  }
}

/**
 * Handle GPU process exit events
 * @param {Object} event - Event object
 * @param {Object} details - Event details
 */
function handleGpuProcessGone(event, details) {
  if (details?.type === 'GPU') {
    const now = Date.now();

    // Reset counter if last failure was more than 1 hour ago
    if (now - lastGpuFailureTime > GPU_FAILURE_RESET_WINDOW) {
      gpuFailureCount = 0;
      logger.debug('[GPU] Failure counter reset after stability window');
    }

    gpuFailureCount += 1;
    lastGpuFailureTime = now;

    logger.error('[GPU] Process exited', {
      reason: details?.reason,
      exitCode: details?.exitCode,
      crashCount: gpuFailureCount,
      lastFailure: new Date(lastGpuFailureTime).toISOString()
    });

    if (gpuFailureCount >= 2 && process.env.STRATOSORT_FORCE_SOFTWARE_GPU !== '1') {
      logger.warn(
        '[GPU] Repeated GPU failures detected. Set STRATOSORT_FORCE_SOFTWARE_GPU=1 to force software rendering.'
      );
    }
  }
}

/**
 * Apply production GPU optimizations
 * @param {boolean} isDev - Whether running in development mode
 */
function applyProductionOptimizations(isDev) {
  if (!forceSoftwareRenderer) {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
  }

  if (isDev) {
    logger.info('[DEVELOPMENT] GPU acceleration flags enabled for development');
  } else {
    logger.info('[PRODUCTION] GPU acceleration optimizations enabled');
  }
}

module.exports = {
  forceSoftwareRenderer,
  initializeGpuConfig,
  handleGpuProcessGone,
  applyProductionOptimizations
};
