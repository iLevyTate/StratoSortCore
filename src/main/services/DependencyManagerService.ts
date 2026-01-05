/**
 * DependencyManagerService
 *
 * Installs/updates external runtime dependencies that StratoSort relies on:
 * - Ollama (Windows: download + silent install)
 * - ChromaDB server runtime (Windows: install Python module via pip; StartupManager spawns server)
 *
 * NOTE: This is intentionally best-effort and non-blocking for the UI.
 */
import os from 'os';
import path from 'path';
import fsSync, { promises as fs } from 'fs';
import { spawn } from 'child_process';
import https from 'https';

import { logger } from '../../shared/logger';
import { createSingletonHelpers } from '../../shared/singletonFactory';
import { isWindows, shouldUseShell } from '../../shared/platformUtils';
import {
  asyncSpawn,
  hasPythonModuleAsync,
  findPythonLauncherAsync
} from '../utils/asyncSpawnUtils';
import { isOllamaInstalled, getOllamaVersion, isOllamaRunning } from '../utils/ollamaDetection';
import { checkPythonInstallation } from './startup/preflightChecks';
import { isChromaDBRunning } from './startup/chromaService';

logger.setContext('DependencyManager');

const OLLAMA_WINDOWS_INSTALLER_URL = 'https://ollama.com/download/OllamaSetup.exe';

interface InstallResult {
  success: boolean;
  error?: string;
  version?: string | null;
  alreadyInstalled?: boolean;
  stderr?: string;
}

interface DependencyStatus {
  installed: boolean;
  version: string | null;
  running?: boolean;
  pythonModuleInstalled?: boolean;
  external?: boolean;
  serverUrl?: string;
}

interface SystemStatus {
  platform: string;
  python: DependencyStatus;
  chromadb: DependencyStatus;
  ollama: DependencyStatus;
}

async function checkOllamaInstallationHelper(): Promise<{
  installed: boolean;
  version: string | null;
}> {
  const installed = await isOllamaInstalled();
  const version = installed ? await getOllamaVersion() : null;
  return { installed, version };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(
  url: string,
  destPath: string,
  {
    onProgress
  }: {
    onProgress?: (progress: { receivedBytes: number; totalBytes: number; percent: number }) => void;
  } = {}
): Promise<void> {
  await fs
    .mkdir(path.dirname(destPath), { recursive: true })
    .catch((err) =>
      logger.debug(
        '[DependencyManager] Directory creation failed (may already exist):',
        err.message
      )
    );

  return new Promise((resolve, reject) => {
    let fileStream: fsSync.WriteStream | null = null;
    let resolved = false;

    const cleanup = (error: Error | null) => {
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
          fileStream?.write(chunk);
        } catch (e: unknown) {
          const error = e instanceof Error ? e : new Error(String(e));
          res.destroy(error);
          cleanup(error);
          return; // eslint-disable-line no-useless-return
        }
        if (typeof onProgress === 'function' && total > 0) {
          onProgress({ receivedBytes: received, totalBytes: total, percent: received / total });
        }
      });

      res.on('end', () => {
        if (resolved) return;
        try {
          fileStream?.end(() => {
            cleanup(null);
          });
        } catch (e: unknown) {
          cleanup(e instanceof Error ? e : new Error(String(e)));
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

async function detectOllamaExePath(): Promise<string | null> {
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

/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
export class DependencyManagerService {
  _progressCallbacks: Function[];

  _lock: Promise<void>;

  constructor({ onProgress }: { onProgress?: Function } = {}) {
    // FIX: Use array of callbacks to support multiple listeners (IPC + backgroundSetup)
    this._progressCallbacks = [];
    if (typeof onProgress === 'function') {
      this._progressCallbacks.push(onProgress);
    }
    this._lock = Promise.resolve();
  }

  /**
   * Add a progress callback. Supports multiple listeners.
   * @param callback - Progress callback function
   * @returns Unsubscribe function
   */
  addProgressCallback(callback: Function): () => void {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _emitProgress(message: string, details: any = {}): void {
    const payload = { message, ...details };
    // eslint-disable-next-line no-restricted-syntax
    for (const callback of this._progressCallbacks) {
      try {
        callback(payload);
      } catch {
        // ignore individual callback errors
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _withLock<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this._lock;
    let release: (value?: void | PromiseLike<void>) => void;
    this._lock = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await prev.catch(() => {});
      return await fn();
    } finally {
      // @ts-expect-error - release is assigned in Promise executor
      release();
    }
  }

  async getStatus(): Promise<SystemStatus> {
    const [python, ollama] = await Promise.all([
      checkPythonInstallation(),
      checkOllamaInstallationHelper()
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
        installed: Boolean(chromaModuleInstalled), // mapped from pythonModuleInstalled
        version: null, // version check not implemented in summary
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

  async installOllama(): Promise<InstallResult> {
    return this._withLock(async () => {
      if (!isWindows) {
        return {
          success: false,
          error:
            'Ollama auto-install is currently only supported on Windows. Please install it from https://ollama.com/download'
        };
      }

      const pre = await checkOllamaInstallationHelper();
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
        try {
          // fire-and-forget; StartupManager / health monitoring will keep it alive
          const child = spawn(ollamaExe, ['serve'], {
            detached: false,
            stdio: 'ignore',
            shell: shouldUseShell(),
            windowsHide: true
          });
          child.unref?.();
        } catch (e: unknown) {
          logger.warn('[DependencyManager] Failed to spawn Ollama after install', {
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }

      // Wait briefly for health to flip
      for (let i = 0; i < 10; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        if (await isOllamaRunning()) break;
        // eslint-disable-next-line no-await-in-loop
        await sleep(500);
      }

      const post = await checkOllamaInstallationHelper();
      return { success: Boolean(post?.installed), version: post?.version || null };
    });
  }

  async updateOllama(): Promise<InstallResult> {
    // For Windows, rerunning the installer is the simplest “update”.
    return this.installOllama();
  }

  async installChromaDb({ upgrade = false, userInstall = true } = {}): Promise<InstallResult> {
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

  async updateChromaDb(): Promise<InstallResult> {
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
 * @param options - Optional progress callback options
 * @returns DependencyManagerService
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function getInstance(options: { onProgress?: Function } = {}): DependencyManagerService {
  const instance = _baseGetInstance(options);
  // Special behavior: Add callback to existing instance instead of replacing
  // eslint-disable-next-line no-underscore-dangle
  if (options.onProgress && instance._progressCallbacks) {
    // Only add if not already registered (avoid duplicates on repeated calls)
    // eslint-disable-next-line no-underscore-dangle
    if (!instance._progressCallbacks.includes(options.onProgress)) {
      instance.addProgressCallback(options.onProgress);
    }
  }
  return instance;
}

export {
  DependencyManagerService as DependencyManagerServiceClass, // export class as named to avoid collision
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance
};

// Also export as default for some compatibility
export default DependencyManagerService;
