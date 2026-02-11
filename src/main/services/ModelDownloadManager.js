// src/main/services/ModelDownloadManager.js

const path = require('path');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const { app } = require('electron');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { createLogger } = require('../../shared/logger');
const { MODEL_CATALOG } = require('../../shared/modelRegistry');

const logger = createLogger('ModelDownloadManager');

class ModelDownloadManager {
  constructor() {
    this._modelPath = path.join(app.getPath('userData'), 'models');
    this._downloads = new Map(); // filename -> download state
    this._progressCallbacks = new Set();
  }

  async initialize() {
    await fs.mkdir(this._modelPath, { recursive: true });
  }

  /**
   * Get list of downloaded models
   */
  async getDownloadedModels() {
    try {
      const files = await fs.readdir(this._modelPath);
      const ggufFiles = files.filter((f) => f.endsWith('.gguf'));

      return Promise.all(
        ggufFiles.map(async (filename) => {
          const filePath = path.join(this._modelPath, filename);
          const stats = await fs.stat(filePath);
          const registryInfo = MODEL_CATALOG[filename] || {};

          return {
            filename,
            path: filePath,
            sizeBytes: stats.size,
            sizeMB: Math.round(stats.size / 1024 / 1024),
            type: registryInfo.type || 'unknown',
            displayName: registryInfo.displayName || filename,
            isComplete: !filename.endsWith('.partial')
          };
        })
      );
    } catch {
      return [];
    }
  }

  /**
   * Check available disk space
   */
  async checkDiskSpace(requiredBytes) {
    try {
      // FIX Bug #29: Use fs.statfs instead of execSync to prevent shell injection
      // and support modern Windows environments where wmic is deprecated.
      // fs.statfs is available since Node 18.15.0.
      if (fs.statfs) {
        const stats = await fs.statfs(this._modelPath);
        const freeSpace = stats.bfree * stats.bsize;
        return { available: freeSpace, sufficient: freeSpace > requiredBytes * 1.1 };
      }

      // fs.statfs is available since Node 18.15+; Electron 40 ships Node 20+.
      // If somehow unavailable, assume sufficient space and warn.
      logger.warn('[Download] fs.statfs not available, skipping disk space check');
      return { available: Infinity, sufficient: true };
    } catch (error) {
      logger.warn('[Download] Could not check disk space', error);
      return { available: null, sufficient: true }; // Assume OK if check fails
    }
  }

  /**
   * Resolve model info from the catalog.
   * Checks top-level entries first, then scans clipModel companions
   * so projector files like mmproj-model-f16.gguf are downloadable by name.
   * @private
   */
  _resolveModelInfo(filename) {
    const direct = MODEL_CATALOG[filename];
    if (direct) return direct;

    // Check if filename matches a clipModel companion of any vision model
    for (const info of Object.values(MODEL_CATALOG)) {
      if (info.clipModel && info.clipModel.name === filename) {
        return {
          type: 'vision-helper',
          displayName: `Vision Projector (${filename})`,
          description: `Required companion for vision model`,
          size: info.clipModel.size,
          url: info.clipModel.url,
          checksum: info.clipModel.checksum
        };
      }
    }

    return null;
  }

  /**
   * Download a model with progress tracking and resume support.
   * For vision models with a clipModel companion (mmproj), the companion
   * is automatically downloaded after the main model completes.
   */
  async downloadModel(filename, options = {}) {
    const modelInfo = this._resolveModelInfo(filename);
    if (!modelInfo) {
      throw new Error(`Unknown model: ${filename}`);
    }

    // Guard: prevent concurrent downloads of the same file (corrupts .partial)
    const existing = this._downloads.get(filename);
    if (existing && existing.status === 'downloading') {
      throw new Error(`Download already in progress: ${filename}`);
    }

    const { onProgress, signal } = options;
    const filePath = path.join(this._modelPath, filename);
    const partialPath = filePath + '.partial';

    // Check disk space
    const spaceCheck = await this.checkDiskSpace(modelInfo.size);
    if (!spaceCheck.sufficient) {
      throw new Error(
        `Insufficient disk space. Need ${Math.round(modelInfo.size / 1024 / 1024 / 1024)}GB, ` +
          `have ${Math.round(spaceCheck.available / 1024 / 1024 / 1024)}GB`
      );
    }

    // Check for existing partial download
    let startByte = 0;
    try {
      const partialStats = await fs.stat(partialPath);
      startByte = partialStats.size;
      logger.info(`[Download] Resuming from byte ${startByte}`);
    } catch {
      // No partial file, start fresh
    }

    // Create an internal AbortController so cancelDownload() can work
    const internalAbortController = new AbortController();

    // Track download state
    const downloadState = {
      filename,
      url: modelInfo.url,
      totalBytes: modelInfo.size,
      downloadedBytes: startByte,
      startByte, // Track initial byte offset for accurate speed calculation
      startTime: Date.now(),
      status: 'downloading',
      abortController: internalAbortController
    };
    this._downloads.set(filename, downloadState);

    // Use redirect URL if provided (for following HTTP redirects), with a max redirect limit
    const downloadUrl = options._redirectUrl || modelInfo.url;
    const redirectCount = options._redirectCount || 0;
    const MAX_REDIRECTS = 5;

    return new Promise((resolve, reject) => {
      const url = new URL(downloadUrl);
      const protocol = url.protocol === 'https:' ? https : http;

      const requestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'User-Agent': 'StratoSort/2.0',
          ...(startByte > 0 ? { Range: `bytes=${startByte}-` } : {})
        }
      };

      const request = protocol.get(requestOptions, (response) => {
        // Handle redirects with loop protection
        if (response.statusCode === 301 || response.statusCode === 302) {
          if (redirectCount >= MAX_REDIRECTS) {
            downloadState.status = 'error';
            if (this._downloads.has(filename)) this._downloads.delete(filename);
            reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
            return;
          }

          // FIX Bug #33: Update state instead of deleting it to prevent cancellation race condition
          downloadState.status = 'redirecting';
          downloadState.url = response.headers.location;

          // FIX: Clean up abort listeners from this request before recursing.
          // The recursive call creates a new internalAbortController, so the
          // listener on the old one would be a leak.
          request.removeAllListeners('error');
          request.removeAllListeners('timeout');

          response.resume(); // Drain response to free socket
          this.downloadModel(filename, {
            ...options,
            _redirectUrl: response.headers.location,
            _redirectCount: redirectCount + 1
          })
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          downloadState.status = 'error';
          if (this._downloads.has(filename)) this._downloads.delete(filename);
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        // Fix: If server ignores Range header (returns 200 instead of 206), restart from 0
        let isResume = startByte > 0 && response.statusCode === 206;
        if (startByte > 0 && response.statusCode === 200) {
          logger.info('[Download] Server ignored range request, restarting from beginning');
          startByte = 0;
          downloadState.downloadedBytes = 0;
          downloadState.startByte = 0;
          isResume = false;
        }

        const writeStream = createWriteStream(partialPath, {
          flags: isResume ? 'a' : 'w'
        });

        let downloaded = startByte;
        const total = modelInfo.size;

        response.on('data', (chunk) => {
          downloaded += chunk.length;
          downloadState.downloadedBytes = downloaded;

          const progress = {
            filename,
            downloadedBytes: downloaded,
            totalBytes: total,
            percent: Math.round((downloaded / total) * 100),
            speedBps: this._calculateSpeed(downloadState),
            etaSeconds: this._calculateETA(downloadState)
          };

          if (onProgress) onProgress(progress);
          this._notifyProgress(progress);
        });

        response.pipe(writeStream);

        writeStream.on('finish', async () => {
          try {
            // Verify file size
            const stats = await fs.stat(partialPath);
            if (stats.size !== modelInfo.size) {
              downloadState.status = 'incomplete';
              reject(new Error('Download incomplete - file size mismatch'));
              return;
            }

            // Verify checksum if available
            const expectedChecksum = modelInfo.checksum || modelInfo.sha256;
            if (expectedChecksum) {
              const isValid = await this._verifyChecksum(partialPath, expectedChecksum);
              if (!isValid) {
                downloadState.status = 'corrupted';
                await fs.unlink(partialPath);
                reject(new Error('Download corrupted - checksum mismatch'));
                return;
              }
            }

            // Rename to final filename
            await fs.rename(partialPath, filePath);
            downloadState.status = 'complete';
            if (this._downloads.has(filename)) this._downloads.delete(filename);

            logger.info(`[Download] Completed: ${filename}`);

            // Auto-download clipModel companion (mmproj) for vision models
            if (modelInfo.clipModel && modelInfo.clipModel.name && modelInfo.clipModel.url) {
              const companionPath = path.join(this._modelPath, modelInfo.clipModel.name);
              try {
                await fs.access(companionPath);
                logger.info(`[Download] Companion already exists: ${modelInfo.clipModel.name}`);
              } catch {
                logger.info(`[Download] Downloading companion: ${modelInfo.clipModel.name}`);
                try {
                  await this.downloadModel(modelInfo.clipModel.name, { onProgress, signal });
                } catch (companionError) {
                  logger.warn(
                    `[Download] Companion download failed (vision may not work): ${companionError.message}`
                  );
                  // Don't fail the main download - vision just won't work until companion is available
                }
              }
            }

            resolve({ success: true, path: filePath });
          } catch (finishError) {
            downloadState.status = 'error';
            if (this._downloads.has(filename)) this._downloads.delete(filename);
            reject(finishError);
          }
        });

        writeStream.on('error', (error) => {
          downloadState.status = 'error';
          if (this._downloads.has(filename)) this._downloads.delete(filename);
          reject(error);
        });

        // Handle abort signals: internal (from cancelDownload) + external (from caller)
        const onAbort = () => {
          // FIX: Remove listeners before destroying to prevent double-fire
          internalAbortController.signal.removeEventListener('abort', onAbort);
          if (signal) signal.removeEventListener('abort', onAbort);

          request.destroy();
          // FIX: Use destroy() instead of close() for immediate cleanup of write stream
          // close() waits for pending writes; destroy() discards buffered data and frees resources
          writeStream.destroy();
          downloadState.status = 'cancelled';
          if (this._downloads.has(filename)) this._downloads.delete(filename);
          reject(new Error('Download cancelled'));
        };
        internalAbortController.signal.addEventListener('abort', onAbort);
        if (signal) {
          signal.addEventListener('abort', onAbort);
        }

        // FIX: Clean up abort listeners when download completes normally.
        // Without this, the listeners on the AbortSignal objects persist
        // even after the promise resolves, leaking closures and references.
        const cleanupAbortListeners = () => {
          internalAbortController.signal.removeEventListener('abort', onAbort);
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        writeStream.on('finish', cleanupAbortListeners);
        writeStream.on('error', cleanupAbortListeners);
      });

      request.on('error', (error) => {
        downloadState.status = 'error';
        if (this._downloads.has(filename)) this._downloads.delete(filename);
        reject(error);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        if (this._downloads.has(filename)) this._downloads.delete(filename);
        reject(new Error('Download timeout'));
      });
    });
  }

  /**
   * Get current download status for all active downloads
   * @returns {{ active: number, downloads: Object[] }}
   */
  getStatus() {
    const downloads = [];
    for (const [filename, state] of this._downloads) {
      downloads.push({
        filename,
        status: state.status,
        progress: state.totalBytes
          ? Math.round((state.downloadedBytes / state.totalBytes) * 100)
          : 0,
        totalBytes: state.totalBytes || 0,
        downloadedBytes: state.downloadedBytes || 0
      });
    }
    return { active: downloads.length, downloads };
  }

  /**
   * Cancel an in-progress download
   */
  cancelDownload(filename) {
    const download = this._downloads.get(filename);
    if (download && download.abortController) {
      download.abortController.abort();
      return true;
    }
    return false;
  }

  /**
   * Delete a downloaded model
   */
  async deleteModel(filename) {
    const filePath = path.join(this._modelPath, filename);
    const partialPath = filePath + '.partial';

    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore */
    }

    try {
      await fs.unlink(partialPath);
    } catch {
      /* ignore */
    }

    logger.info(`[Download] Deleted model: ${filename}`);
    return { success: true };
  }

  /**
   * Register progress callback
   */
  onProgress(callback) {
    this._progressCallbacks.add(callback);
    return () => this._progressCallbacks.delete(callback);
  }

  _notifyProgress(progress) {
    this._progressCallbacks.forEach((cb) => {
      try {
        cb(progress);
      } catch {
        /* ignore */
      }
    });
  }

  _calculateSpeed(state) {
    const elapsed = (Date.now() - state.startTime) / 1000;
    if (elapsed < 1) return 0;
    // Subtract startByte to only measure bytes downloaded in THIS session
    const sessionBytes = state.downloadedBytes - (state.startByte || 0);
    return Math.round(sessionBytes / elapsed);
  }

  _calculateETA(state) {
    const speed = this._calculateSpeed(state);
    if (speed === 0) return Infinity;
    const remaining = state.totalBytes - state.downloadedBytes;
    return Math.round(remaining / speed);
  }

  /**
   * Cancel all active downloads and clean up resources.
   * Called during app shutdown by ServiceContainer.
   */
  shutdown() {
    for (const [filename, download] of this._downloads) {
      try {
        if (download.abortController) {
          download.abortController.abort();
        }
      } catch {
        /* ignore — already aborted */
      }
      logger.debug(`[Download] Cancelled active download on shutdown: ${filename}`);
    }
    this._downloads.clear();
    this._progressCallbacks.clear();
  }

  async _verifyChecksum(filePath, expectedHash) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = require('fs').createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const actualHash = hash.digest('hex');
        resolve(actualHash === expectedHash);
      });
      stream.on('error', reject);
    });
  }
}

// Singleton
let instance = null;
function getInstance() {
  if (!instance) {
    instance = new ModelDownloadManager();
  }
  return instance;
}

module.exports = { ModelDownloadManager, getInstance };
