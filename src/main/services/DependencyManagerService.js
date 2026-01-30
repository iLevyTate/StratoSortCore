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
const { shell } = require('electron');

const { logger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { isWindows, isMacOS } = require('../../shared/platformUtils');
const {
  asyncSpawn,
  hasPythonModuleAsync,
  findPythonLauncherAsync
} = require('../utils/asyncSpawnUtils');
const {
  isOllamaInstalled,
  getOllamaVersion,
  isOllamaRunning
} = require('../utils/ollamaDetection');
const { checkPythonInstallation } = require('./startup/preflightChecks');
const { isChromaDBRunning } = require('./startup/chromaService');
const { getChromaUrl } = require('../../shared/config/chromaDefaults');

logger.setContext('DependencyManager');

const OLLAMA_WINDOWS_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';
const RUNTIME_ROOT =
  process.env.STRATOSORT_RUNTIME_DIR ||
  (process.resourcesPath ? path.join(process.resourcesPath, 'assets', 'runtime') : null);

async function checkOllamaInstallation() {
  const installed = await isOllamaInstalled();
  const version = installed ? await getOllamaVersion() : null;
  return { installed, version };
}

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

  await fs
    .mkdir(path.dirname(destPath), { recursive: true })
    .catch((err) =>
      logger.debug(
        '[DependencyManager] Directory creation failed (may already exist):',
        err.message
      )
    );

  return new Promise((resolve, reject) => {
    let fileStream = null;
    let resolved = false;

    const cleanup = (error) => {
      if (resolved) return;
      resolved = true;
      if (fileStream) {
        try {
          fileStream.destroy();
        } catch (cleanupErr) {
          // Intentionally ignored: stream destroy can fail if already closed
          logger.debug('[DependencyManager] Stream cleanup:', cleanupErr?.message);
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

function getEmbeddedPythonLauncher() {
  if (!RUNTIME_ROOT) return null;
  const exe = isWindows ? 'python.exe' : 'python3';
  const candidate = path.join(RUNTIME_ROOT, 'python', exe);
  return { command: candidate, args: [], fromEmbedded: true };
}

function getEmbeddedOllamaBinary() {
  if (!RUNTIME_ROOT) return null;
  const exe = isWindows ? 'ollama.exe' : 'ollama';
  return path.join(RUNTIME_ROOT, 'ollama', exe);
}

async function getPythonVersionWithLauncher(launcher) {
  if (!launcher) return null;
  try {
    const res = await asyncSpawn(launcher.command, [...(launcher.args || []), '--version'], {
      timeout: 3000,
      windowsHide: true
    });
    if (res.status === 0) {
      return (res.stdout || res.stderr || '').toString().trim() || null;
    }
  } catch {
    // ignore
  }
  return null;
}

async function hasPythonModuleWithLauncher(launcher, moduleName) {
  if (!launcher || !moduleName) return false;
  const moduleValid =
    typeof moduleName === 'string' &&
    /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(moduleName);
  if (!moduleValid) return false;

  const res = await asyncSpawn(
    launcher.command,
    [
      ...(launcher.args || []),
      '-c',
      `import importlib; importlib.import_module(${JSON.stringify(moduleName)})`
    ],
    {
      timeout: 5000,
      windowsHide: true
    }
  );
  return res.status === 0;
}

/**
 * Parse Python version string (e.g., "Python 3.9.7") into components
 * @param {string} versionString - Raw version output
 * @returns {{ major: number, minor: number, patch: number } | null}
 */
function parsePythonVersion(versionString) {
  if (!versionString) return null;
  const match = versionString.match(/Python\s*(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3] || '0', 10)
  };
}

/**
 * Check if Python version meets minimum requirement (3.9+)
 * @param {string} versionString - Raw version output
 * @returns {boolean}
 */
function meetsMinimumPythonVersion(versionString) {
  const version = parsePythonVersion(versionString);
  if (!version) return false;
  // Require Python 3.9+
  if (version.major < 3) return false;
  if (version.major === 3 && version.minor < 9) return false;
  return true;
}

async function resolvePythonLauncher() {
  const embedded = getEmbeddedPythonLauncher();
  if (embedded && (await fileExists(embedded.command))) {
    // FIX HIGH-4: Validate embedded Python version meets minimum requirement
    const version = await getPythonVersionWithLauncher(embedded);
    if (!version) {
      logger.warn('[DependencyManager] Embedded Python version unknown, proceeding with caution');
      return embedded;
    }
    if (meetsMinimumPythonVersion(version)) {
      return embedded;
    }
    logger.warn('[DependencyManager] Embedded Python version too old:', version);
  }

  const launcher = await findPythonLauncherAsync();
  if (launcher) {
    // FIX HIGH-4: Validate system Python version meets minimum requirement
    const version = await getPythonVersionWithLauncher(launcher);
    if (!version) {
      logger.warn('[DependencyManager] System Python version unknown, proceeding with caution');
      return launcher;
    }
    if (meetsMinimumPythonVersion(version)) {
      return launcher;
    }
    logger.warn('[DependencyManager] System Python version too old:', version);
  }

  return null;
}

async function getOllamaVersionFromBinary(binPath) {
  try {
    const res = await asyncSpawn(binPath, ['--version'], { timeout: 3000, windowsHide: true });
    if (res.status === 0) {
      return (res.stdout || res.stderr || '').toString().trim() || null;
    }
  } catch {
    // ignore
  }
  return null;
}

async function detectOllamaExePath() {
  const embedded = getEmbeddedOllamaBinary();
  if (embedded && (await fileExists(embedded))) {
    return embedded;
  }

  // Prefer PATH
  try {
    const result = await asyncSpawn('ollama', ['--version'], {
      timeout: 2000,
      windowsHide: true
    });
    if (result.status === 0) {
      return 'ollama';
    }
  } catch (detectErr) {
    // Intentionally ignored: ollama not in PATH is expected on some systems
    logger.debug('[DependencyManager] ollama PATH check failed:', detectErr?.message);
  }

  if (!isWindows) return null;

  const candidates = [];
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  }
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Ollama', 'ollama.exe'));
  }
  // Also check x86 Program Files for 32-bit installations
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Ollama', 'ollama.exe'));
  }

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
      } catch (cbErr) {
        // Intentionally ignored: individual callback failures shouldn't break progress reporting
        logger.debug('[DependencyManager] Progress callback error:', cbErr?.message);
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
      // Wait for previous lock to release (ignore its outcome - we just need sequencing)
      await prev.catch((lockErr) => {
        logger.debug('[DependencyManager] Previous lock error (ignored):', lockErr?.message);
      });
      return await fn();
    } finally {
      release();
    }
  }

  async getStatus() {
    const [pythonDetected, ollama] = await Promise.all([
      checkPythonInstallation(),
      checkOllamaInstallation()
    ]);

    const pythonLauncher = await resolvePythonLauncher();
    const pythonVersion =
      pythonLauncher?.fromEmbedded || pythonLauncher
        ? await getPythonVersionWithLauncher(pythonLauncher)
        : pythonDetected?.version || null;

    const [chromaModuleInstalled, ollamaRunning, chromaRunning] = await Promise.all([
      pythonLauncher
        ? hasPythonModuleWithLauncher(pythonLauncher, 'chromadb')
        : hasPythonModuleAsync('chromadb'),
      isOllamaRunning(),
      isChromaDBRunning()
    ]);

    return {
      platform: process.platform,
      python: {
        installed: Boolean(pythonLauncher) || Boolean(pythonDetected?.installed),
        version: pythonVersion
      },
      chromadb: {
        pythonModuleInstalled: Boolean(chromaModuleInstalled),
        running: Boolean(chromaRunning),
        external: Boolean(process.env.CHROMA_SERVER_URL),
        serverUrl: getChromaUrl()
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
      // macOS support (Homebrew or Manual)
      if (isMacOS) {
        return this._installOllamaMac();
      }

      if (!isWindows) {
        return {
          success: false,
          error:
            'Ollama auto-install is currently only supported on Windows and macOS. Please install it from https://ollama.com/download'
        };
      }

      const pre = await checkOllamaInstallation();
      if (pre?.installed) {
        return { success: true, alreadyInstalled: true, version: pre.version || null };
      }

      // Prefer bundled portable Ollama if present
      const embeddedOllama = getEmbeddedOllamaBinary();
      if (embeddedOllama && (await fileExists(embeddedOllama))) {
        this._emitProgress('Using bundled Ollama runtime…', {
          kind: 'dependency',
          dependency: 'ollama',
          stage: 'embedded'
        });

        try {
          await this._startOllamaBinary(embeddedOllama);
        } catch (e) {
          logger.warn('[DependencyManager] Bundled Ollama failed to start', { error: e?.message });
        }

        const version = (await getOllamaVersionFromBinary(embeddedOllama)) || pre?.version || null;
        return { success: true, bundled: true, version };
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

      await fs
        .unlink(installerPath)
        .catch((err) => logger.debug('[DependencyManager] Installer cleanup failed:', err.message));

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
        await this._startOllamaBinary(ollamaExe);
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

  async _startOllamaBinary(binaryPath) {
    try {
      const child = spawn(binaryPath, ['serve'], {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        cwd: path.dirname(binaryPath)
      });
      child.unref?.();
    } catch (e) {
      logger.warn('[DependencyManager] Failed to spawn Ollama', { error: e?.message });
    }
  }

  async _installOllamaMac() {
    const pre = await checkOllamaInstallation();
    if (pre?.installed) {
      return { success: true, alreadyInstalled: true, version: pre.version || null };
    }

    // Check if Homebrew is available
    let hasBrew = false;
    try {
      const brewCheck = await asyncSpawn('brew', ['--version'], {
        timeout: 2000,
        windowsHide: true
      });
      hasBrew = brewCheck.status === 0;
    } catch {
      hasBrew = false;
    }

    if (hasBrew) {
      this._emitProgress('Installing Ollama via Homebrew…', {
        kind: 'dependency',
        dependency: 'ollama',
        stage: 'install'
      });

      try {
        const installResult = await asyncSpawn('brew', ['install', 'ollama'], {
          timeout: 5 * 60 * 1000
        });

        if (installResult.status === 0) {
          // Success! Start service
          this._emitProgress('Starting Ollama…', {
            kind: 'dependency',
            dependency: 'ollama',
            stage: 'start'
          });

          // brew services start ollama (optional, but good practice)
          await asyncSpawn('brew', ['services', 'start', 'ollama'], { timeout: 5000 }).catch(
            () => {}
          );

          // Wait briefly for health to flip
          for (let i = 0; i < 10; i += 1) {
            if (await isOllamaRunning()) break;
            await sleep(500);
          }

          const post = await checkOllamaInstallation();
          return { success: Boolean(post?.installed), version: post?.version || null };
        } else {
          logger.warn('[DependencyManager] Homebrew install failed:', installResult.stderr);
          // Fall through to manual install
        }
      } catch (err) {
        logger.warn('[DependencyManager] Homebrew install error:', err.message);
        // Fall through to manual install
      }
    }

    // Manual install fallback
    this._emitProgress('Opening download page…', {
      kind: 'dependency',
      dependency: 'ollama',
      stage: 'manual'
    });

    try {
      await shell.openExternal('https://ollama.com/download');
    } catch (e) {
      logger.error('Failed to open browser:', e);
    }

    return {
      success: false,
      error:
        'Could not install automatically. Opened download page. Please install Ollama and restart StratoSort.'
    };
  }

  async updateOllama() {
    // For Windows, rerunning the installer is the simplest “update”.
    return this.installOllama();
  }

  async installChromaDb({ upgrade = false, userInstall = true } = {}) {
    return this._withLock(async () => {
      const pythonLauncher = await resolvePythonLauncher();
      if (!pythonLauncher) {
        // FIX HIGH-4: Provide more helpful error message distinguishing missing vs old Python
        const anyLauncher = await findPythonLauncherAsync();
        if (anyLauncher) {
          const version = await getPythonVersionWithLauncher(anyLauncher);
          return {
            success: false,
            error: `Python version ${version || 'unknown'} is too old. ChromaDB requires Python 3.9 or newer. Please upgrade your Python installation.`
          };
        }
        return {
          success: false,
          error:
            'No Python runtime available. Please install Python 3.9+ or include the bundled runtime.'
        };
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
        { timeout: 5 * 60 * 1000, windowsHide: true }
      ).catch((pipErr) => {
        // Intentionally ignored: pip upgrade failure is non-fatal, chromadb install may still work
        logger.debug('[DependencyManager] pip upgrade failed (non-fatal):', pipErr?.message);
      });

      const pkgArgs = [
        ...pythonLauncher.args,
        '-m',
        'pip',
        'install',
        ...(upgrade ? ['--upgrade'] : []),
        ...(pythonLauncher.fromEmbedded ? [] : userInstall ? ['--user'] : []),
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
        env: pythonLauncher.fromEmbedded
          ? {
              ...process.env,
              PYTHONHOME: path.dirname(pythonLauncher.command)
            }
          : process.env
      });

      if (installRes.status !== 0) {
        return {
          success: false,
          error: `ChromaDB install failed (exit ${installRes.status ?? 'unknown'})`,
          stderr: (installRes.stderr || '').trim()
        };
      }

      const moduleInstalled = await hasPythonModuleWithLauncher(pythonLauncher, 'chromadb');
      return { success: Boolean(moduleInstalled) };
    });
  }

  async updateChromaDb() {
    return this.installChromaDb({ upgrade: true, userInstall: true });
  }
}

// Create singleton helpers using shared factory
const {
  getInstance: _baseGetInstance,
  createInstance,
  registerWithContainer,
  resetInstance
} = createSingletonHelpers({
  ServiceClass: DependencyManagerService,
  serviceId: 'DEPENDENCY_MANAGER',
  serviceName: 'DependencyManagerService',
  containerPath: './ServiceContainer'
  // No shutdownMethod - service has no cleanup needs
});

/**
 * Get the singleton DependencyManagerService instance.
 * Uses a shared lock to prevent concurrent installations.
 *
 * @param {Object} options - Optional progress callback options
 * @param {Function} options.onProgress - Progress callback (added to existing callbacks, not replaced)
 * @returns {DependencyManagerService}
 */
function getInstance(options = {}) {
  const instance = _baseGetInstance(options);
  // Special behavior: Add callback to existing instance instead of replacing
  if (options.onProgress && instance._progressCallbacks) {
    // Only add if not already registered (avoid duplicates on repeated calls)
    if (!instance._progressCallbacks.includes(options.onProgress)) {
      instance.addProgressCallback(options.onProgress);
    }
  }
  return instance;
}

module.exports = {
  DependencyManagerService,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance
};
