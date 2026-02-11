// src/main/services/DegradationManager.js

const { createLogger } = require('../../shared/logger');
const { getInstance: getGPUMonitor } = require('./GPUMonitor');
const { getInstance: getModelDownloadManager } = require('./ModelDownloadManager');
const logger = createLogger('DegradationManager');

class DegradationManager {
  constructor(llamaService) {
    this._llamaService = llamaService;
    // FIX Bug #32: Use singletons to prevent redundant instances
    this._gpuMonitor = getGPUMonitor();
    this._downloadManager = getModelDownloadManager();
    this._degradationState = {
      gpuAvailable: true,
      usingCPUFallback: false,
      missingModels: [],
      warnings: []
    };
  }

  /**
   * Check system readiness and determine degradation level
   */
  async checkSystemReadiness() {
    const issues = [];
    const warnings = [];

    // Check GPU
    const gpuInfo = await this._gpuMonitor.detectGPU();
    if (gpuInfo.type === 'cpu') {
      warnings.push({
        type: 'no_gpu',
        message: 'No GPU detected. AI features will run on CPU (slower).',
        severity: 'warning'
      });
      this._degradationState.gpuAvailable = false;
    }

    // Check models
    const downloadedModels = await this._downloadManager.getDownloadedModels();
    const downloadedNames = new Set(downloadedModels.map((m) => m.filename));

    const missingRequired = [];
    // FIX: Guard against null llamaService (singleton getInstance() creates
    // without arguments). Also guard _selectedModels to avoid TypeError.
    const selectedModels = this._llamaService?._selectedModels;
    if (selectedModels) {
      if (selectedModels.embedding && !downloadedNames.has(selectedModels.embedding)) {
        missingRequired.push('embedding');
      }
      if (selectedModels.text && !downloadedNames.has(selectedModels.text)) {
        missingRequired.push('text');
      }
    }

    if (missingRequired.length > 0) {
      issues.push({
        type: 'missing_models',
        models: missingRequired,
        message: `Required models not downloaded: ${missingRequired.join(', ')}`,
        severity: 'error',
        action: 'download_models'
      });
      this._degradationState.missingModels = missingRequired;
    }

    // Check disk space
    const spaceCheck = await this._downloadManager.checkDiskSpace(1024 * 1024 * 1024); // 1GB minimum
    if (!spaceCheck.sufficient) {
      warnings.push({
        type: 'low_disk_space',
        message: 'Low disk space. Some features may not work.',
        severity: 'warning'
      });
    }

    this._degradationState.warnings = warnings;

    return {
      ready: issues.length === 0,
      issues,
      warnings,
      gpuInfo,
      degradationState: this._degradationState
    };
  }

  /**
   * Handle a specific error and determine recovery action
   */
  async handleError(error, context = {}) {
    const message = (error.message || '').toLowerCase();

    // GPU memory error
    if (
      message.includes('cuda out of memory') ||
      message.includes('metal error') ||
      message.includes('metal device') ||
      message.includes('no metal') ||
      message.includes('vram')
    ) {
      logger.warn('[Degradation] GPU memory error, attempting recovery');

      // Update state so attemptRecovery() knows to try re-enabling GPU later
      this._degradationState.usingCPUFallback = true;
      this._degradationState.gpuAvailable = false;

      return {
        action: 'retry_with_cpu',
        message: 'GPU memory exhausted. Switching to CPU mode.',
        shouldNotifyUser: true
      };
    }

    // Model loading error
    if (message.includes('failed to load model') || message.includes('invalid gguf')) {
      logger.error('[Degradation] Model loading failed');

      return {
        action: 'redownload_model',
        message: 'Model file may be corrupted. Please re-download.',
        shouldNotifyUser: true,
        modelType: context.modelType
      };
    }

    // Disk error
    if (message.includes('enospc') || message.includes('no space left')) {
      return {
        action: 'cleanup_disk',
        message: 'Disk full. Please free up space.',
        shouldNotifyUser: true
      };
    }

    // Unknown error
    return {
      action: 'none',
      message: 'An unexpected error occurred.',
      shouldNotifyUser: false,
      originalError: error
    };
  }

  /**
   * Get current degradation state for UI
   */
  getDegradationState() {
    return { ...this._degradationState };
  }

  /**
   * Attempt to recover from degraded state
   */
  async attemptRecovery() {
    if (this._degradationState.missingModels.length > 0) {
      return {
        canRecover: false,
        action: 'download_models',
        message: 'Please download required models to continue.'
      };
    }

    if (this._degradationState.usingCPUFallback) {
      // Try to re-enable GPU
      const gpuInfo = await this._gpuMonitor.detectGPU();
      if (gpuInfo.type !== 'cpu') {
        this._degradationState.usingCPUFallback = false;
        this._degradationState.gpuAvailable = true;
        return {
          canRecover: true,
          action: 'gpu_restored',
          message: 'GPU access restored.'
        };
      }
    }

    return {
      canRecover: true,
      action: 'none',
      message: 'System operating normally.'
    };
  }
}

// Singleton
let instance = null;
/**
 * Get or create the DegradationManager singleton.
 *
 * @param {Object} [llamaService] - LlamaService instance. Required on first
 *   call so the manager can inspect `_selectedModels` during readiness checks.
 *   Subsequent calls may omit it; the original reference is preserved.
 * @returns {DegradationManager}
 */
function getInstance(llamaService) {
  if (!instance) {
    instance = new DegradationManager(llamaService);
  } else if (llamaService && !instance._llamaService) {
    // FIX: Allow late-binding the llamaService if the singleton was created
    // before the LlamaService was available (e.g., during startup).
    instance._llamaService = llamaService;
  }
  return instance;
}

module.exports = { DegradationManager, getInstance };
