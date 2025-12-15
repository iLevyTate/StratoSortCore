/**
 * DependencyManagerService
 *
 * Installs/updates external runtime dependencies that StratoSort relies on:
 * - Ollama (Windows: download + silent install)
 * - ChromaDB server runtime (Windows: install Python module via pip; StartupManager spawns server)
 *
 * NOTE: This is intentionally best-effort and non-blocking for the UI.
 */
const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');

const { logger } = require('../../shared/logger');
const { isWindows, shouldUseShell } = require('../../shared/platformUtils');
const {
  asyncSpawn,
  hasPythonModuleAsync,
  findPythonLauncherAsync
} = require('../utils/asyncSpawnUtils');
const {
  checkPythonInstallation,
  checkOllamaInstallation
} = require('../services/startup/preflightChecks');
const { isOllamaRunning } = require('../services/startup/ollamaService');
const { isChromaDBRunning } = require('../services/startup/chromaService');

logger.setContext('DependencyManager');

const OLLAMA_WINDOWS_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url, destPath, { onProgress } = {}) {
  const https = require('https');
  const fsSync = require('fs');

  await fs.mkdir(path.dirname(destPath), { recursive: true }).catch(() => {});

  return new Promise((resolve, reject) => {
    let fileStream = null;
    let resolved = false;

    const cleanup = (error) => {
      if (resolved) return;
      resolved = true;
      if (fileStream) {
        try {
          fileStream.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
      if (error) {
        // Best-effort removal of partial file
        fsSync.unlink(destPath, () => {});
        reject(error);
      } else {
        resolve();
      }
    };

    const request = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        res.resume();
        downloadToFile(res.headers.location, destPath, { onProgress }).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        cleanup(new Error(`Download failed (HTTP ${res.statusCode || 'unknown'})`));
        return;
      }

      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      fileStream = fsSync.createWriteStream(destPath);

      // Handle file stream errors
      fileStream.on('error', (e) => {
        res.destroy();
        cleanup(e);
      });

      res.on('data', (chunk) => {
        if (resolved) return;
        received += chunk.length;
        try {
          fileStream.write(chunk);
        } catch (e) {
          res.destroy(e);
          cleanup(e);
          return;
        }
        if (typeof onProgress === 'function' && total > 0) {
          onProgress({ receivedBytes: received, totalBytes: total, percent: received / total });
        }
      });

      res.on('end', () => {
        if (resolved) return;
        try {
          fileStream.end(() => {
            cleanup(null);
          });
        } catch (e) {
          cleanup(e);
        }
      });

      res.on('error', (e) => {
        cleanup(e);
      });
    });

    request.on('error', (e) => {
      cleanup(e);
    });
  });
}

async function detectOllamaExePath() {
  // Prefer PATH
  try {
    const result = await asyncSpawn('ollama', ['--version'], {
      timeout: 2000,
      windowsHide: true,
      shell: shouldUseShell()
    });
    if (result.status === 0) {
      return 'ollama';
    }
  } catch {
    // ignore
  }

  if (!isWindows) return null;

  const candidates = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  }
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe'));
  }
  candidates.push('C:\\Program Files\\Ollama\\ollama.exe');

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

class DependencyManagerService {
  constructor({ onProgress } = {}) {
    // FIX: Use array of callbacks to support multiple listeners (IPC + backgroundSetup)
    this._progressCallbacks = [];
    if (typeof onProgress === 'function') {
      this._progressCallbacks.push(onProgress);
    }
    this._lock = Promise.resolve();
  }

  /**
   * Add a progress callback. Supports multiple listeners.
   * @param {Function} callback - Progress callback function
   * @returns {Function} Unsubscribe function
   */
  addProgressCallback(callback) {
    if (typeof callback === 'function') {
      this._progressCallbacks.push(callback);
      // Return unsubscribe function
      return () => {
        const index = this._progressCallbacks.indexOf(callback);
        if (index > -1) {
          this._progressCallbacks.splice(index, 1);
        }
      };
    }
    return () => {};
  }

  _emitProgress(message, details = {}) {
    const payload = { message, ...details };
    for (const callback of this._progressCallbacks) {
      try {
        callback(payload);
      } catch {
        // ignore individual callback errors
      }
    }
  }

  async _withLock(fn) {
    const prev = this._lock;
    let release;
    this._lock = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await prev.catch(() => {});
      return await fn();
    } finally {
      release();
    }
  }

  async getStatus() {
    const [python, ollama] = await Promise.all([
      checkPythonInstallation(),
      checkOllamaInstallation()
    ]);
    const [chromaModuleInstalled, ollamaRunning, chromaRunning] = await Promise.all([
      hasPythonModuleAsync('chromadb'),
      isOllamaRunning(),
      isChromaDBRunning()
    ]);

    return {
      platform: process.platform,
      python: {
        installed: Boolean(python?.installed),
        version: python?.version || null
      },
      chromadb: {
        pythonModuleInstalled: Boolean(chromaModuleInstalled),
        running: Boolean(chromaRunning),
        external: Boolean(process.env.CHROMA_SERVER_URL),
        serverUrl:
          process.env.CHROMA_SERVER_URL ||
          `${process.env.CHROMA_SERVER_PROTOCOL || 'http'}://${process.env.CHROMA_SERVER_HOST || '127.0.0.1'}:${process.env.CHROMA_SERVER_PORT || 8000}`
      },
      ollama: {
        installed: Boolean(ollama?.installed),
        version: ollama?.version || null,
        running: Boolean(ollamaRunning)
      }
    };
  }

  async installOllama() {
    return this._withLock(async () => {
      if (!isWindows) {
        return {
          success: false,
          error:
            'Ollama auto-install is currently only supported on Windows. Please install it from https://ollama.com/download'
        };
      }

      const pre = await checkOllamaInstallation();
      if (pre?.installed) {
        return { success: true, alreadyInstalled: true, version: pre.version || null };
      }

      const tempDir = path.join(os.tmpdir(), 'stratosort');
      const installerPath = path.join(tempDir, 'OllamaSetup.exe');

      this._emitProgress('Downloading Ollama installer…', {
        kind: 'dependency',
        dependency: 'ollama'
      });
      await downloadToFile(OLLAMA_WINDOWS_INSTALLER_URL, installerPath, {
        onProgress: ({ percent }) => {
          this._emitProgress('Downloading Ollama installer…', {
            kind: 'dependency',
            dependency: 'ollama',
            stage: 'download',
            percent
          });
        }
      });

      this._emitProgress('Installing Ollama…', {
        kind: 'dependency',
        dependency: 'ollama',
        stage: 'install'
      });
      const installResult = await asyncSpawn(installerPath, ['/S'], {
        timeout: 10 * 60 * 1000,
        windowsHide: false,
        shell: false
      });

      try {
        await fs.unlink(installerPath).catch(() => {});
      } catch {
        // ignore
      }

      if (installResult.status !== 0) {
        return {
          success: false,
          error: `Ollama installer failed (exit ${installResult.status ?? 'unknown'})`,
          stderr: installResult.stderr?.trim()
        };
      }

      // Best-effort: start server so model downloads can begin immediately
      this._emitProgress('Starting Ollama…', {
        kind: 'dependency',
        dependency: 'ollama',
        stage: 'start'
      });
      const ollamaExe = await detectOllamaExePath();
      if (ollamaExe) {
        try {
          // fire-and-forget; StartupManager / health monitoring will keep it alive
          const child = spawn(ollamaExe, ['serve'], {
            detached: false,
            stdio: 'ignore',
            shell: shouldUseShell(),
            windowsHide: true
          });
          child.unref?.();
        } catch (e) {
          logger.warn('[DependencyManager] Failed to spawn Ollama after install', {
            error: e?.message
          });
        }
      }

      // Wait briefly for health to flip
      for (let i = 0; i < 10; i += 1) {
        if (await isOllamaRunning()) break;
        await sleep(500);
      }

      const post = await checkOllamaInstallation();
      return { success: Boolean(post?.installed), version: post?.version || null };
    });
  }

  async updateOllama() {
    // For Windows, rerunning the installer is the simplest “update”.
    return this.installOllama();
  }

  async installChromaDb({ upgrade = false, userInstall = true } = {}) {
    return this._withLock(async () => {
      const python = await checkPythonInstallation();
      if (!python?.installed) {
        return {
          success: false,
          error:
            'Python 3 is required for ChromaDB. Please install Python 3 and ensure it is available as `py -3` (Windows) or `python3`.'
        };
      }

      const pythonLauncher = await findPythonLauncherAsync();
      if (!pythonLauncher) {
        return { success: false, error: 'Could not locate a Python launcher (py/python3/python).' };
      }

      // Upgrade pip first (best-effort)
      this._emitProgress('Preparing Python environment…', {
        kind: 'dependency',
        dependency: 'chromadb',
        stage: 'pip'
      });
      await asyncSpawn(
        pythonLauncher.command,
        [...pythonLauncher.args, '-m', 'pip', 'install', '--upgrade', 'pip'],
        { timeout: 5 * 60 * 1000, windowsHide: true, shell: shouldUseShell() }
      ).catch(() => {});

      const pkgArgs = [
        ...pythonLauncher.args,
        '-m',
        'pip',
        'install',
        ...(upgrade ? ['--upgrade'] : []),
        ...(userInstall ? ['--user'] : []),
        'chromadb'
      ];

      this._emitProgress(`${upgrade ? 'Updating' : 'Installing'} ChromaDB…`, {
        kind: 'dependency',
        dependency: 'chromadb',
        stage: 'install'
      });

      const installRes = await asyncSpawn(pythonLauncher.command, pkgArgs, {
        timeout: 10 * 60 * 1000,
        windowsHide: true,
        shell: shouldUseShell()
      });

      if (installRes.status !== 0) {
        return {
          success: false,
          error: `ChromaDB install failed (exit ${installRes.status ?? 'unknown'})`,
          stderr: (installRes.stderr || '').trim()
        };
      }

      const moduleInstalled = await hasPythonModuleAsync('chromadb');
      return { success: Boolean(moduleInstalled) };
    });
  }

  async updateChromaDb() {
    return this.installChromaDb({ upgrade: true, userInstall: true });
  }
}

// Singleton instance for shared lock coordination
let singletonInstance = null;

/**
 * Get the singleton DependencyManagerService instance.
 * Uses a shared lock to prevent concurrent installations.
 *
 * @param {Object} options - Optional progress callback options
 * @param {Function} options.onProgress - Progress callback (added to existing callbacks, not replaced)
 * @returns {DependencyManagerService}
 */
function getInstance(options = {}) {
  if (!singletonInstance) {
    singletonInstance = new DependencyManagerService(options);
  } else if (options.onProgress) {
    // FIX: Add callback instead of replacing - supports multiple listeners
    singletonInstance.addProgressCallback(options.onProgress);
  }
  return singletonInstance;
}

/**
 * Reset the singleton instance (for testing purposes)
 */
function resetInstance() {
  singletonInstance = null;
}

module.exports = {
  DependencyManagerService,
  getInstance,
  resetInstance
};
