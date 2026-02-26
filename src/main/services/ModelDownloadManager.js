// src/main/services/ModelDownloadManager.js

const path = require('path');
const fs = require('fs').promises;
const { createWriteStream } = require('fs');
const https = require('https');
const crypto = require('crypto');
const { createLogger } = require('../../shared/logger');
const { MODEL_CATALOG, getModel } = require('../../shared/modelRegistry');
const { ensureResolvedModelsPath } = require('./modelPathResolver');
const { delay } = require('../../shared/promiseUtils');

const logger = createLogger('ModelDownloadManager');
const DEFAULT_DOWNLOAD_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const REQUIRED_SHA256_REGEX = /^[a-f0-9]{64}$/i;
const ALLOWED_MODEL_DOWNLOAD_HOSTS = Object.freeze(['huggingface.co', 'hf.co']);

class ModelDownloadManager {
  constructor() {
    this._modelPath = null;
    this._modelPathInitPromise = null;
    this._downloads = new Map(); // filename -> download state
    this._progressCallbacks = new Set();
  }

  async _ensureModelPath() {
    if (this._modelPath) return this._modelPath;
    if (!this._modelPathInitPromise) {
      this._modelPathInitPromise = (async () => {
        const resolved = await ensureResolvedModelsPath();
        this._modelPath = resolved.modelsPath;
        if (resolved.source === 'legacy') {
          logger.warn('[Download] Using legacy models directory', {
            modelsPath: resolved.modelsPath,
            currentModelsPath: resolved.currentModelsPath
          });
        }
        return this._modelPath;
      })();
    }
    try {
      return await this._modelPathInitPromise;
    } finally {
      this._modelPathInitPromise = null;
    }
  }

  async initialize() {
    await this._ensureModelPath();
  }

  /**
   * Get list of downloaded models
   */
  async getDownloadedModels() {
    try {
      const modelPath = await this._ensureModelPath();
      const files = await fs.readdir(modelPath);
      const ggufFiles = files.filter((f) => /\.gguf$/i.test(f));

      return Promise.all(
        ggufFiles.map(async (filename) => {
          const filePath = path.join(modelPath, filename);
          const stats = await fs.stat(filePath);
          const registryInfo = getModel(filename) || {};

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
      const modelPath = await this._ensureModelPath();
      // and support modern Windows environments where wmic is deprecated.
      // fs.statfs is available since Node 18.15.0.
      if (fs.statfs) {
        const stats = await fs.statfs(modelPath);
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
    const direct = getModel(filename);
    if (direct) return direct;

    // Check if filename matches a clipModel companion of any vision model
    const lowerFilename = filename?.toLowerCase();
    for (const info of Object.values(MODEL_CATALOG)) {
      if (info.clipModel && info.clipModel.name?.toLowerCase() === lowerFilename) {
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
    const modelPath = await this._ensureModelPath();
    const modelInfo = this._resolveModelInfo(filename);
    if (!modelInfo) {
      throw new Error(`Unknown model: ${filename}`);
    }
    const expectedChecksum = modelInfo.checksum || modelInfo.sha256;
    if (!this._isValidSha256(expectedChecksum)) {
      throw new Error(`Model checksum missing or invalid for ${filename}`);
    }
    this._validateDownloadUrl(modelInfo.url, filename);

    // Guard: prevent concurrent downloads of the same file (corrupts .partial)
    const existing = this._downloads.get(filename);
    if (existing && existing.status === 'downloading') {
      throw new Error(`Download already in progress: ${filename}`);
    }

    const { onProgress, signal } = options;
    const retryAttempt = Number.isInteger(options._attempt) ? options._attempt : 0;
    const maxRetries = Number.isInteger(options._maxRetries)
      ? Math.max(0, options._maxRetries)
      : DEFAULT_DOWNLOAD_MAX_RETRIES;
    const filePath = path.join(modelPath, filename);
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
      if (partialStats.size >= modelInfo.size) {
        // Stale/invalid partial (equal or larger than target size) can cause
        // bad range requests and unrecoverable retry loops. Restart cleanly.
        await this._cleanupPartialFile(partialPath);
        logger.warn(
          `[Download] Discarded stale partial for ${filename} (${partialStats.size} bytes), restarting`
        );
      } else {
        startByte = partialStats.size;
        logger.info(`[Download] Resuming from byte ${startByte}`);
      }
    } catch {
      // No partial file, start fresh
    }

    // Use redirect URL if provided (for following HTTP redirects), with a max redirect limit
    const downloadUrl = options._redirectUrl || modelInfo.url;
    const redirectCount = options._redirectCount || 0;
    const MAX_REDIRECTS = 5;
    const validatedDownloadUrl = this._validateDownloadUrl(downloadUrl, filename).toString();

    // Create an internal AbortController so cancelDownload() can work
    const internalAbortController = new AbortController();

    // Track download state
    const downloadState = {
      filename,
      url: validatedDownloadUrl,
      totalBytes: modelInfo.size,
      downloadedBytes: startByte,
      startByte, // Track initial byte offset for accurate speed calculation
      startTime: Date.now(),
      status: 'downloading',
      abortController: internalAbortController
    };
    this._downloads.set(filename, downloadState);

    return new Promise((resolve, reject) => {
      const url = new URL(validatedDownloadUrl);
      let settled = false;

      const finalizeSuccess = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const finalizeFailure = (error, status = 'error', cleanupPartial = false) => {
        if (settled) return;
        downloadState.status = status;
        if (this._downloads.has(filename)) this._downloads.delete(filename);
        const cleanup = cleanupPartial ? this._cleanupPartialFile(partialPath) : Promise.resolve();
        cleanup
          .then(async () => {
            const canRetry =
              retryAttempt < maxRetries &&
              this._isRetryableDownloadError(error, status, {
                externalSignal: signal,
                internalSignal: internalAbortController.signal
              });

            if (!canRetry) {
              if (settled) return;
              settled = true;
              reject(error);
              return;
            }

            const nextAttempt = retryAttempt + 1;
            const retryDelayMs = Math.min(3000, RETRY_BASE_DELAY_MS * nextAttempt);
            logger.warn(
              `[Download] Attempt ${nextAttempt}/${maxRetries} retrying ${filename} after failure`,
              {
                status,
                error: error?.message || String(error),
                retryDelayMs
              }
            );
            if (retryDelayMs > 0) {
              await delay(retryDelayMs);
            }
            this.downloadModel(filename, {
              ...options,
              _attempt: nextAttempt
            })
              .then(finalizeSuccess)
              .catch(reject);
          })
          .catch(() => {
            if (settled) return;
            settled = true;
            reject(error);
          });
      };

      // Honor already-aborted external signals before opening sockets/streams.
      if (signal?.aborted) {
        finalizeFailure(new Error('Download cancelled'), 'cancelled');
        return;
      }

      const requestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          'User-Agent': 'StratoSort/2.0'
        }
      };
      if (startByte > 0) {
        requestOptions.headers.Range = `bytes=${startByte}-`;
      } else {
        delete requestOptions.headers.Range;
      }

      const request = https.get(requestOptions, (response) => {
        // Handle redirects with loop protection
        if (response.statusCode === 301 || response.statusCode === 302) {
          if (redirectCount >= MAX_REDIRECTS) {
            finalizeFailure(new Error(`Too many redirects (${MAX_REDIRECTS})`));
            return;
          }

          const redirectLocation = response.headers.location;
          if (!redirectLocation) {
            finalizeFailure(new Error('Redirect response missing Location header'));
            return;
          }
          const resolvedRedirectUrl = new URL(redirectLocation, url).toString();
          const validatedRedirectUrl = this._validateDownloadUrl(
            resolvedRedirectUrl,
            filename
          ).toString();

          downloadState.status = 'redirecting';
          downloadState.url = validatedRedirectUrl;

          // The recursive call creates a new internalAbortController, so the
          // listener on the old one would be a leak.
          request.removeAllListeners('error');
          request.removeAllListeners('timeout');

          response.resume(); // Drain response to free socket
          this.downloadModel(filename, {
            ...options,
            _redirectUrl: validatedRedirectUrl,
            _redirectCount: redirectCount + 1
          })
            .then(finalizeSuccess)
            .catch((err) => finalizeFailure(err));
          return;
        }

        if (response.statusCode !== 200 && response.statusCode !== 206) {
          finalizeFailure(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        let isResume = startByte > 0 && response.statusCode === 206;
        if (startByte > 0 && response.statusCode === 200) {
          logger.info('[Download] Server ignored range request, restarting from beginning');
          startByte = 0;
          downloadState.downloadedBytes = 0;
          downloadState.startByte = 0;
          isResume = false;
        }

        // Prefer the server's Content-Length for size validation.
        // Catalog sizes are informational estimates (e.g. "~21MB") and may
        // not match the real file byte-for-byte, causing spurious mismatches.
        const contentLength = parseInt(response.headers['content-length'], 10);
        const serverExpectedBytes =
          Number.isFinite(contentLength) && contentLength > 0
            ? isResume
              ? contentLength + startByte
              : contentLength
            : null;
        const expectedBytes = serverExpectedBytes || modelInfo.size;

        const writeStream = createWriteStream(partialPath, {
          flags: isResume ? 'a' : 'w'
        });

        let downloaded = startByte;
        const total = expectedBytes;

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
          if (typeof writeStream.close === 'function') {
            writeStream.close();
          }
          try {
            // Verify file size against server-reported Content-Length (or catalog fallback).
            const stats = await fs.stat(partialPath);
            if (stats.size !== expectedBytes) {
              finalizeFailure(
                new Error(
                  `Download incomplete - file size mismatch (got ${stats.size}, expected ${expectedBytes})`
                ),
                'incomplete',
                true
              );
              return;
            }

            // Verify checksum (required for all remote model artifacts).
            const isValid = await this._verifyChecksum(partialPath, expectedChecksum);
            if (!isValid) {
              finalizeFailure(
                new Error('Download corrupted - checksum mismatch'),
                'corrupted',
                true
              );
              return;
            }

            // Rename to final filename
            await fs.rename(partialPath, filePath);
            downloadState.status = 'complete';
            if (this._downloads.has(filename)) this._downloads.delete(filename);

            logger.info(`[Download] Completed: ${filename}`);

            // Auto-download clipModel companion (mmproj) for vision models
            if (modelInfo.clipModel && modelInfo.clipModel.name && modelInfo.clipModel.url) {
              const companionPath = path.join(modelPath, modelInfo.clipModel.name);
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

            finalizeSuccess({ success: true, path: filePath });
          } catch (finishError) {
            finalizeFailure(finishError);
          }
        });

        writeStream.on('error', (error) => {
          if (typeof writeStream.close === 'function') {
            writeStream.close();
          }
          finalizeFailure(error);
        });

        // Handle abort signals: internal (from cancelDownload) + external (from caller)
        const onAbort = () => {
          internalAbortController.signal.removeEventListener('abort', onAbort);
          if (signal) signal.removeEventListener('abort', onAbort);

          request.destroy();
          // close() waits for pending writes; destroy() discards buffered data and frees resources
          writeStream.destroy();
          finalizeFailure(new Error('Download cancelled'), 'cancelled');
        };
        internalAbortController.signal.addEventListener('abort', onAbort);
        if (signal) {
          signal.addEventListener('abort', onAbort);
        }

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
        finalizeFailure(error);
      });

      request.setTimeout(30000, () => {
        request.destroy();
        finalizeFailure(new Error('Download timeout'));
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
   * Check if a model is currently being downloaded.
   * @param {string} filename - Model filename
   * @returns {boolean}
   */
  isDownloading(filename) {
    const state = this._downloads.get(filename);
    return !!state && (state.status === 'downloading' || state.status === 'redirecting');
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
    const modelPath = await this._ensureModelPath();
    const filePath = path.join(modelPath, filename);
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

  _isValidSha256(value) {
    return typeof value === 'string' && REQUIRED_SHA256_REGEX.test(value.trim());
  }

  _isAllowedDownloadHost(hostname) {
    if (!hostname || typeof hostname !== 'string') return false;
    const host = hostname.toLowerCase();
    return ALLOWED_MODEL_DOWNLOAD_HOSTS.some(
      (allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`)
    );
  }

  _validateDownloadUrl(rawUrl, filename) {
    let parsedUrl;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      throw new Error(`Invalid download URL for ${filename}`);
    }
    if (parsedUrl.protocol !== 'https:') {
      throw new Error(`Blocked non-HTTPS model download for ${filename}`);
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error(`Blocked credentialed download URL for ${filename}`);
    }
    if (!this._isAllowedDownloadHost(parsedUrl.hostname)) {
      throw new Error(`Blocked download from untrusted host: ${parsedUrl.hostname}`);
    }
    return parsedUrl;
  }

  async _verifyChecksum(filePath, expectedHash) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = require('fs').createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const actualHash = hash.digest('hex').toLowerCase();
        const normalizedExpected = String(expectedHash || '')
          .trim()
          .toLowerCase();
        resolve(actualHash === normalizedExpected);
      });
      stream.on('error', reject);
    });
  }

  async _cleanupPartialFile(partialPath) {
    try {
      await fs.unlink(partialPath);
    } catch {
      // Best-effort cleanup: file may not exist if write failed before creation.
    }
  }

  _isRetryableDownloadError(error, status, signals = {}) {
    if (status === 'cancelled') return false;
    if (signals?.externalSignal?.aborted || signals?.internalSignal?.aborted) return false;
    if (status === 'incomplete' || status === 'corrupted') return true;
    const message = String(error?.message || '').toLowerCase();
    const code = String(error?.code || '').toUpperCase();
    if (message.includes('timeout') || message.includes('file size mismatch')) return true;
    if (/^http 5\d{2}/i.test(String(error?.message || ''))) return true;
    return ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN'].includes(
      code
    );
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
