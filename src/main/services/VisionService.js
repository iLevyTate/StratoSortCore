const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const tar = require('tar');
const { app } = require('electron');
const { createLogger } = require('../../shared/logger');
const { createSingletonHelpers } = require('../../shared/singletonFactory');
const { resolveRuntimePath } = require('../utils/runtimePaths');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { delay } = require('../../shared/promiseUtils');
const { isVisionDecodePressureError } = require('./visionErrorClassification');

const logger = createLogger('VisionService');
let loggedRuntimeVariant = false;

// Cached result of synchronous NVIDIA GPU probe (null = not yet probed)
let _nvidiaDetected = null;
// Cached result of synchronous Mac GPU probe (null = not yet probed)
let _macGpuDetected = null;

/**
 * Synchronously probe for an NVIDIA GPU via nvidia-smi.
 * The result is cached for the lifetime of the process so the (slow-ish)
 * child-process spawn only runs once.
 */
function hasNvidiaGPU() {
  if (_nvidiaDetected !== null) return _nvidiaDetected;
  if (process.platform !== 'win32') {
    _nvidiaDetected = false;
    return false;
  }
  try {
    const { execSync } = require('child_process');
    const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const name = output.toString().trim();
    if (name) {
      logger.info('[VisionService] NVIDIA GPU detected, preferring CUDA runtime', { gpu: name });
      _nvidiaDetected = true;
      return true;
    }
  } catch {
    // nvidia-smi not available or failed — no usable NVIDIA GPU
  }
  _nvidiaDetected = false;
  return false;
}

/**
 * Synchronously probe for Mac GPU via system_profiler.
 * Matches GPUMonitor logic but keeps it synchronous for getAssetConfig.
 */
function detectMacGPU() {
  if (_macGpuDetected !== null) return _macGpuDetected;
  if (process.platform !== 'darwin') {
    _macGpuDetected = false;
    return false;
  }

  try {
    const { execSync } = require('child_process');
    const output = execSync('system_profiler SPDisplaysDataType -json', {
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const data = JSON.parse(output.toString());
    const gpu = data.SPDisplaysDataType?.[0];

    if (gpu) {
      const name = gpu.sppci_model || 'Unknown GPU';
      let vram = gpu.sppci_vram;
      const isApple = name.toLowerCase().includes('apple');

      if (isApple) {
        try {
          const memOutput = execSync('sysctl hw.memsize').toString();
          // hw.memsize: 17179869184
          const totalMem = parseInt(memOutput.split(':')[1]?.trim()) || 0;
          // Estimate 75% for unified memory (matching GPUMonitor logic)
          const vramBytes = Math.round(totalMem * 0.75);
          vram = `${Math.round(vramBytes / 1024 / 1024)} MB (Estimated)`;
        } catch {
          vram = 'Unknown (Apple Silicon)';
        }
      }

      logger.info('[VisionService] macOS GPU detected, using Metal runtime', {
        gpu: name,
        vram,
        type: 'metal'
      });
      _macGpuDetected = true;
      return true;
    }
  } catch (error) {
    logger.debug('[VisionService] macOS GPU detection failed', { error: error.message });
  }

  _macGpuDetected = false;
  return false;
}

const LLAMA_CPP_RELEASE_TAG = process.env.STRATOSORT_LLAMA_CPP_TAG || 'b7956';
const LLAMA_CPP_BASE_URL = 'https://github.com/ggml-org/llama.cpp/releases/download';
const SERVER_BINARY_NAME = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

// Vision models (4-5GB) can take several minutes to load on CPU-only systems
const DEFAULT_STARTUP_TIMEOUT_MS = TIMEOUTS.VISION_STARTUP || 120000;
const DEFAULT_REQUEST_TIMEOUT_MS = TIMEOUTS.VISION_REQUEST || 90000;
const DEFAULT_IDLE_KEEPALIVE_MS =
  typeof TIMEOUTS.VISION_IDLE_KEEPALIVE === 'number' ? TIMEOUTS.VISION_IDLE_KEEPALIVE : 0;

function parseKeepAliveMs(value, fallbackMs) {
  if (value == null || value === '') return fallbackMs;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallbackMs;
  return parsed;
}

function getRuntimeRoot(tag = LLAMA_CPP_RELEASE_TAG) {
  return path.join(app.getPath('userData'), 'runtime', 'llama.cpp', tag);
}

function inferArchiveType(url) {
  const lower = url.toLowerCase();
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  return null;
}

function getAssetConfig(tag = LLAMA_CPP_RELEASE_TAG) {
  const overrideUrl = process.env.STRATOSORT_LLAMA_CPP_URL;
  if (overrideUrl && overrideUrl.trim()) {
    const archiveType = inferArchiveType(overrideUrl);
    if (!archiveType) {
      throw new Error('Unsupported llama.cpp runtime archive format');
    }
    const config = {
      tag: 'custom',
      assetName: path.basename(overrideUrl),
      archiveType,
      url: overrideUrl
    };
    if (!loggedRuntimeVariant) {
      loggedRuntimeVariant = true;
      logger.info('[VisionService] Selected vision runtime (override)', {
        platform: process.platform,
        arch: process.arch,
        assetName: config.assetName
      });
    }
    return config;
  }

  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'win32') {
    // ARM64 stays CPU-only; x64 prefers CUDA when NVIDIA GPU is detected,
    // falls back to Vulkan (which itself falls back to CPU when no driver).
    const cudaVersion = process.env.STRATOSORT_CUDA_VERSION || '12.4';
    const useNvidiaCuda =
      arch !== 'arm64' && !process.env.STRATOSORT_PREFER_VULKAN && hasNvidiaGPU();

    let assetName;
    let cudartAssetName = null;
    if (arch === 'arm64') {
      assetName = `llama-${tag}-bin-win-cpu-arm64.zip`;
    } else if (useNvidiaCuda) {
      assetName = `llama-${tag}-bin-win-cuda-${cudaVersion}-x64.zip`;
      cudartAssetName = `cudart-llama-bin-win-cuda-${cudaVersion}-x64.zip`;
    } else {
      assetName = `llama-${tag}-bin-win-vulkan-x64.zip`;
    }

    const config = {
      tag,
      assetName,
      archiveType: 'zip',
      url: `${LLAMA_CPP_BASE_URL}/${tag}/${assetName}`
    };

    if (cudartAssetName) {
      config.cudartAssetName = cudartAssetName;
      config.cudartUrl = `${LLAMA_CPP_BASE_URL}/${tag}/${cudartAssetName}`;
    }

    if (!loggedRuntimeVariant) {
      loggedRuntimeVariant = true;
      logger.info('[VisionService] Selected vision runtime', {
        platform,
        arch,
        assetName,
        ...(cudartAssetName && { cudartAssetName }),
        backend: useNvidiaCuda ? 'cuda' : assetName.includes('vulkan') ? 'vulkan' : 'cpu'
      });
    }
    return config;
  }

  if (platform === 'darwin') {
    // macOS builds include Metal GPU support by default
    detectMacGPU();

    const assetName =
      arch === 'arm64'
        ? `llama-${tag}-bin-macos-arm64.tar.gz`
        : `llama-${tag}-bin-macos-x64.tar.gz`;
    const config = {
      tag,
      assetName,
      archiveType: 'tar.gz',
      url: `${LLAMA_CPP_BASE_URL}/${tag}/${assetName}`
    };
    if (!loggedRuntimeVariant) {
      loggedRuntimeVariant = true;
      logger.info('[VisionService] Selected vision runtime', {
        platform,
        arch,
        assetName
      });
    }
    return config;
  }

  if (platform === 'linux') {
    if (arch !== 'x64') {
      throw new Error(`Unsupported Linux architecture for vision runtime: ${arch}`);
    }
    const assetName = `llama-${tag}-bin-ubuntu-x64.tar.gz`;
    const config = {
      tag,
      assetName,
      archiveType: 'tar.gz',
      url: `${LLAMA_CPP_BASE_URL}/${tag}/${assetName}`
    };
    if (!loggedRuntimeVariant) {
      loggedRuntimeVariant = true;
      logger.info('[VisionService] Selected vision runtime', {
        platform,
        arch,
        assetName
      });
    }
    return config;
  }

  throw new Error(`Unsupported platform for vision runtime: ${platform}`);
}

async function downloadFile(url, destination, _redirectCount = 0) {
  const MAX_REDIRECTS = 10;
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });

  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'StratoSort' } }, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.destroy();
        if (_redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`Too many redirects (${MAX_REDIRECTS}) downloading vision runtime`));
          return;
        }
        downloadFile(response.headers.location, destination, _redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode}`));
        response.resume();
        return;
      }

      const fileStream = fs.createWriteStream(destination);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(resolve);
      });
      fileStream.on('error', (error) => {
        response.destroy();
        fs.unlink(destination, () => reject(error));
      });
      response.on('error', (error) => {
        fileStream.destroy();
        fs.unlink(destination, () => reject(error));
      });
    });

    request.on('error', reject);
  });
}

async function extractArchive(archivePath, destination, archiveType) {
  if (archiveType === 'zip') {
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(destination, true);
    return;
  }

  if (archiveType === 'tar.gz') {
    await tar.x({ file: archivePath, cwd: destination });
    return;
  }

  throw new Error(`Unsupported archive type: ${archiveType}`);
}

async function findBinary(rootDir, binaryName, maxDepth = 5) {
  async function walk(dir, depth) {
    if (depth < 0) return null;
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }

    for (const entry of entries) {
      if (entry.isFile() && entry.name === binaryName) {
        return path.join(dir, entry.name);
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const found = await walk(path.join(dir, entry.name), depth - 1);
        if (found) return found;
      }
    }

    return null;
  }

  return walk(rootDir, maxDepth);
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on('error', reject);
  });
}

async function requestJson({ method, port, path: endpointPath, body, timeoutMs, signal }) {
  const payload = body ? JSON.stringify(body) : null;
  const options = {
    method,
    hostname: '127.0.0.1',
    port,
    path: endpointPath,
    headers: {
      'Content-Type': 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
    }
  };

  const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MB safety limit
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
        if (data.length > MAX_RESPONSE_SIZE) {
          req.destroy(new Error('Vision response exceeded 10 MB limit'));
        }
      });
      res.on('end', () => {
        if (!data) {
          resolve({ status: res.statusCode, json: null });
          return;
        }
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data) });
        } catch (error) {
          reject(error);
        }
      });
    });

    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('Vision request timed out'));
      });
    }

    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('Vision request aborted'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          req.destroy(new Error('Vision request aborted'));
        },
        { once: true }
      );
    }

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function detectBase64Mime(imageBase64) {
  if (typeof imageBase64 !== 'string') return null;
  if (imageBase64.startsWith('/9j/')) return 'image/jpeg';
  if (imageBase64.startsWith('iVBOR')) return 'image/png';
  if (imageBase64.startsWith('R0lG')) return 'image/gif';
  if (imageBase64.startsWith('UklGR')) return 'image/webp';
  return null;
}

function detectMimeFromPath(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return null;
}

class VisionService {
  constructor() {
    this._process = null;
    this._port = null;
    this._binaryPath = null;
    this._activeConfig = null;
    this._runtimeInit = null;
    this._startPromise = null;
    this._shutdownPromise = null;
    this._serverLock = Promise.resolve();
    this._idleShutdownTimer = null;
    this._recentStderr = '';
    this._idleKeepAliveMs = parseKeepAliveMs(
      process.env.STRATOSORT_VISION_KEEPALIVE_MS,
      DEFAULT_IDLE_KEEPALIVE_MS
    );
  }

  _extractDecodePressureHint() {
    const recent = String(this._recentStderr || '');
    if (!recent) return '';
    if (!isVisionDecodePressureError(recent)) {
      return '';
    }
    const normalized = recent.replace(/\s+/g, ' ').trim();
    const excerpt = normalized.slice(0, 240);
    return excerpt ? ` [vision-runtime: ${excerpt}]` : '';
  }

  isIdleKeepAliveEnabled() {
    return this._idleKeepAliveMs > 0;
  }

  _clearIdleShutdownTimer() {
    if (!this._idleShutdownTimer) return;
    clearTimeout(this._idleShutdownTimer);
    this._idleShutdownTimer = null;
  }

  scheduleIdleShutdown(reason = 'idle') {
    this._clearIdleShutdownTimer();
    if (!this.isIdleKeepAliveEnabled() || !this._process) return;

    this._idleShutdownTimer = setTimeout(() => {
      this._idleShutdownTimer = null;
      this.shutdown().catch((error) => {
        logger.warn('[VisionService] Idle shutdown failed', {
          reason,
          error: error?.message
        });
      });
    }, this._idleKeepAliveMs);

    if (typeof this._idleShutdownTimer.unref === 'function') {
      this._idleShutdownTimer.unref();
    }

    logger.debug('[VisionService] Scheduled idle shutdown', {
      reason,
      keepAliveMs: this._idleKeepAliveMs
    });
  }

  async isAvailable() {
    const envPath = process.env.STRATOSORT_LLAMA_SERVER_PATH;
    if (envPath && fs.existsSync(envPath)) {
      return true;
    }

    // Prefer downloaded GPU-enabled runtime over bundled (potentially CPU-only) binary
    try {
      const asset = getAssetConfig();
      const runtimeRoot = getRuntimeRoot(asset.tag);
      const manifestPath = path.join(runtimeRoot, 'runtime.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        if (manifest?.binaryPath && fs.existsSync(manifest.binaryPath)) {
          return true;
        }
      }
    } catch {
      // ignore availability checks that error
    }

    // Fallback to bundled binary (packaged builds)
    const packagedCandidate = resolveRuntimePath(SERVER_BINARY_NAME);
    if (fs.existsSync(packagedCandidate)) {
      return true;
    }

    return false;
  }

  async _ensureBinary() {
    if (this._binaryPath) {
      return this._binaryPath;
    }

    // 1. Explicit env override
    const envPath = process.env.STRATOSORT_LLAMA_SERVER_PATH;
    if (envPath) {
      try {
        await fs.promises.access(envPath);
        this._binaryPath = envPath;
        return envPath;
      } catch {
        logger.warn('[VisionService] STRATOSORT_LLAMA_SERVER_PATH not accessible', {
          path: envPath
        });
      }
    }

    // 2. Bundled binary (packaged builds) — use immediately, no download
    const packagedCandidate = resolveRuntimePath(SERVER_BINARY_NAME);
    if (fs.existsSync(packagedCandidate)) {
      logger.info('[VisionService] Using bundled runtime', {
        binaryPath: packagedCandidate
      });
      this._binaryPath = packagedCandidate;
      return packagedCandidate;
    }

    // 3. Downloaded GPU-enabled runtime in userData (from previous session or manual setup)
    try {
      const asset = getAssetConfig();
      const runtimeRoot = getRuntimeRoot(asset.tag);
      const manifestPath = path.join(runtimeRoot, 'runtime.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
        if (
          manifest?.binaryPath &&
          fs.existsSync(manifest.binaryPath) &&
          manifest.assetName === asset.assetName
        ) {
          logger.info('[VisionService] Using downloaded runtime', {
            binaryPath: manifest.binaryPath,
            asset: manifest.assetName
          });
          this._binaryPath = manifest.binaryPath;
          return manifest.binaryPath;
        }
      }
    } catch {
      // Fall through to download or bundled fallback
    }

    // 4. Download the correct GPU-enabled runtime (dev mode or unbundled builds)
    if (!this._runtimeInit) {
      this._runtimeInit = this._downloadRuntime();
    }
    try {
      await this._runtimeInit;
      if (this._binaryPath) {
        return this._binaryPath;
      }
    } catch (error) {
      this._runtimeInit = null;
      logger.warn('[VisionService] Download failed, rechecking bundled path', {
        error: error.message
      });
    }

    // 5. Bundled binary as last resort (e.g. download failed but build included it)
    const fallbackPackaged = resolveRuntimePath(SERVER_BINARY_NAME);
    if (fs.existsSync(fallbackPackaged)) {
      logger.info('[VisionService] Using bundled runtime fallback', {
        binaryPath: fallbackPackaged
      });
      this._binaryPath = fallbackPackaged;
      return fallbackPackaged;
    }

    throw new Error('Vision runtime not found: no bundled, downloaded, or env binary available');
  }

  async _downloadRuntime() {
    const asset = getAssetConfig();
    const runtimeRoot = getRuntimeRoot(asset.tag);
    await fs.promises.mkdir(runtimeRoot, { recursive: true });

    const manifestPath = path.join(runtimeRoot, 'runtime.json');
    try {
      const existing = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8'));
      // Re-download if the asset variant changed (e.g., cpu -> vulkan)
      if (
        existing?.binaryPath &&
        fs.existsSync(existing.binaryPath) &&
        existing.assetName === asset.assetName
      ) {
        this._binaryPath = existing.binaryPath;
        return;
      }
      if (existing?.assetName && existing.assetName !== asset.assetName) {
        logger.info('[VisionService] Asset variant changed, re-downloading', {
          from: existing.assetName,
          to: asset.assetName
        });
      }
    } catch {
      // Ignore missing/invalid manifest
    }

    const archivePath = path.join(runtimeRoot, asset.assetName);
    logger.info('[VisionService] Downloading vision runtime', {
      asset: asset.assetName
    });
    await downloadFile(asset.url, archivePath);

    try {
      await extractArchive(archivePath, runtimeRoot, asset.archiveType);
    } catch (extractionError) {
      try {
        await fs.promises.unlink(archivePath);
      } catch {
        /* ignore cleanup errors */
      }
      throw extractionError;
    }

    const binaryPath = await findBinary(runtimeRoot, SERVER_BINARY_NAME);
    if (!binaryPath) {
      throw new Error('Vision runtime binary not found after extraction');
    }

    // Download CUDA runtime DLLs alongside the binary when using a CUDA build.
    // The DLLs must live in the same directory as the binary so the dynamic
    // linker can find them at spawn time (cwd = binaryDir).
    if (asset.cudartAssetName && asset.cudartUrl) {
      const cudartArchive = path.join(runtimeRoot, asset.cudartAssetName);
      const binaryDir = path.dirname(binaryPath);
      logger.info('[VisionService] Downloading CUDA runtime DLLs', {
        asset: asset.cudartAssetName,
        targetDir: binaryDir
      });
      try {
        await downloadFile(asset.cudartUrl, cudartArchive);
        await extractArchive(cudartArchive, binaryDir, asset.archiveType);
        logger.info('[VisionService] CUDA runtime DLLs installed');
      } catch (cudartError) {
        // Non-fatal: the system may already have CUDA DLLs via the driver.
        // Log and continue — the server will fail to start if they're truly missing.
        logger.warn(
          '[VisionService] Failed to download CUDA runtime DLLs; ' +
            'CUDA may still work if the driver provides them',
          {
            error: cudartError.message
          }
        );
      } finally {
        try {
          await fs.promises.unlink(cudartArchive);
        } catch {
          /* ignore */
        }
      }
    }

    if (process.platform !== 'win32') {
      try {
        await fs.promises.chmod(binaryPath, 0o755);
      } catch (error) {
        logger.debug('[VisionService] Failed to chmod vision binary', { error: error.message });
      }
    }

    this._binaryPath = binaryPath;
    await fs.promises.writeFile(
      manifestPath,
      JSON.stringify(
        {
          tag: asset.tag,
          assetName: asset.assetName,
          binaryPath
        },
        null,
        2
      )
    );

    try {
      await fs.promises.unlink(archivePath);
    } catch {
      // ignore cleanup errors
    }
  }

  _buildServerArgs(config, port) {
    const args = [
      '-m',
      config.modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--no-webui',
      '--parallel',
      '1'
    ];

    if (config.mmprojPath) {
      args.push('--mmproj', config.mmprojPath);
    }

    if (typeof config.contextSize === 'number' && config.contextSize > 0) {
      args.push('--ctx-size', String(config.contextSize));
    }

    if (typeof config.threads === 'number' && config.threads > 0) {
      args.push('--threads', String(config.threads));
    }

    // Only set --n-gpu-layers when explicitly configured.
    // For "auto"/unset, let llama-server fit layers to available VRAM.
    if (typeof config.gpuLayers === 'number' && config.gpuLayers >= 0) {
      args.push('--n-gpu-layers', String(config.gpuLayers));
    }

    // Reduce decode/KV pressure on constrained VRAM profiles when provided by caller.
    if (typeof config.batchSize === 'number' && config.batchSize > 0) {
      args.push('-b', String(config.batchSize));
    }
    if (typeof config.ubatchSize === 'number' && config.ubatchSize > 0) {
      args.push('-ub', String(config.ubatchSize));
    }

    return args;
  }

  async _waitForHealth(port, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, signal) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (signal?.aborted) {
        throw new Error('Vision runtime startup aborted (process exited)');
      }
      try {
        const { status, json } = await requestJson({
          method: 'GET',
          port,
          path: '/health'
        });
        if (status === 200 && (json?.status === 'ok' || json?.status === 'OK')) {
          return;
        }
      } catch {
        // ignore until timeout
      }
      await delay(500);
    }
    throw new Error('Vision runtime failed to start in time');
  }

  async _startServer(config) {
    const binaryPath = await this._ensureBinary();
    const port = await getAvailablePort();
    const args = this._buildServerArgs(config, port);

    logger.info('[VisionService] Starting vision runtime', {
      binaryPath,
      port,
      contextSize: config.contextSize,
      batchSize: config.batchSize || null,
      ubatchSize: config.ubatchSize || null
    });

    const child = spawn(binaryPath, args, {
      cwd: path.dirname(binaryPath),
      windowsHide: true,
      env: {
        ...process.env,
        LLAMA_ARG_LOG_VERBOSITY: process.env.LLAMA_ARG_LOG_VERBOSITY || '2'
      }
    });

    const stderrChunks = [];

    child.stdout?.on('data', (data) => {
      logger.debug('[VisionService][stdout]', { message: data.toString() });
    });

    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderrChunks.push(text);
      this._recentStderr = `${this._recentStderr}${text}`.slice(-4000);
      logger.debug('[VisionService][stderr]', { message: text });
    });

    // AbortController to cancel health check if process exits early
    const abortController = new AbortController();

    // Create a promise that rejects if the process exits before health is confirmed.
    // This prevents _waitForHealth from polling a dead process for 180s.
    // preventing both a stale listener and an unhandled promise rejection when the
    // process later exits normally.
    let earlyExitHandler;
    const earlyExitPromise = new Promise((_, reject) => {
      earlyExitHandler = (code, signal) => {
        abortController.abort(); // Signal health check to stop polling
        const stderr = stderrChunks.join('').slice(-500);
        reject(
          new Error(
            `Vision runtime exited during startup (code=${code}, signal=${signal})${stderr ? ': ' + stderr : ''}`
          )
        );
      };
      child.on('exit', earlyExitHandler);
    });
    // Suppress unhandled rejection if health check wins the race
    earlyExitPromise.catch(() => {});

    // Handle spawn-level errors (e.g. ENOENT when binary doesn't exist)
    child.on('error', (err) => {
      logger.error('[VisionService] Failed to spawn vision runtime', { error: err.message });
    });

    // Clean up state when the process exits (for both startup failures and runtime crashes)
    this._generalExitHandler = (code, signal) => {
      logger.warn('[VisionService] Vision runtime exited', { code, signal });
      this._process = null;
      this._port = null;
      this._activeConfig = null;
      this._startPromise = null;
      this._recentStderr = '';
    };
    child.on('exit', this._generalExitHandler);

    this._process = child;
    this._port = port;

    // Kill the child process if the parent exits unexpectedly (crash, SIGTERM, etc.)
    // On Windows, child processes are NOT auto-killed when the parent dies.
    this._exitHandler = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    };
    process.on('exit', this._exitHandler);

    // Race health check against early exit -- if the process dies first, fail immediately
    try {
      await Promise.race([
        this._waitForHealth(port, DEFAULT_STARTUP_TIMEOUT_MS, abortController.signal),
        earlyExitPromise
      ]);
      // Health check succeeded -- remove the startup exit listener to avoid
      // spurious rejection when the process later exits normally.
      child.removeListener('exit', earlyExitHandler);
      // Free startup stderr buffer — no longer needed after successful health check
      stderrChunks.length = 0;
    } catch (error) {
      // Ensure we clean up if health check fails or process exits
      child.removeListener('exit', earlyExitHandler);
      // Remove process-level exit handler to prevent stale listener leak
      if (this._exitHandler) {
        process.removeListener('exit', this._exitHandler);
        this._exitHandler = null;
      }
      if (this._process === child) {
        this._process = null;
        this._port = null;
        this._activeConfig = null;
        this._startPromise = null;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }
      throw error;
    }
  }

  _configMatches(config) {
    if (!this._activeConfig) return false;
    return (
      this._activeConfig.modelPath === config.modelPath &&
      this._activeConfig.mmprojPath === config.mmprojPath &&
      this._activeConfig.contextSize === config.contextSize &&
      this._activeConfig.threads === config.threads &&
      this._activeConfig.gpuLayers === config.gpuLayers &&
      this._activeConfig.batchSize === config.batchSize &&
      this._activeConfig.ubatchSize === config.ubatchSize
    );
  }

  async _ensureServer(config) {
    // Acquire lock to prevent concurrent config changes
    let releaseLock;
    const acquireLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    // Chain the lock
    const previousLock = this._serverLock;
    this._serverLock = (async () => {
      try {
        await previousLock;
      } catch {
        // Ignore previous errors
      }
      await acquireLock;
    })();

    try {
      // Wait for any previous operation to complete
      await previousLock;

      // Wait for any pending shutdown to complete before starting
      if (this._shutdownPromise) {
        await this._shutdownPromise;
      }

      if (this._process && this._port && this._configMatches(config)) {
        return;
      }

      if (this._process) {
        await this.shutdown();
      }

      this._activeConfig = { ...config };
      // We are holding the lock, so it's safe to set _startPromise
      this._startPromise = this._startServer(config).catch((error) => {
        this._startPromise = null;
        this._activeConfig = null; // Clear stale config so retries can proceed
        throw error;
      });

      await this._startPromise;
    } finally {
      releaseLock();
    }
  }

  async analyzeImage(options = {}) {
    const {
      imageBase64,
      imagePath,
      prompt,
      systemPrompt,
      maxTokens = 1024,
      temperature = 0.2,
      signal,
      config
    } = options;

    if (!config?.modelPath) {
      throw new Error('Vision model not found: no model path provided');
    }

    if (config?.mmprojRequired && !config?.mmprojPath) {
      throw new Error('Vision model not found: missing multimodal projector');
    }

    this._clearIdleShutdownTimer();
    await this._ensureServer(config);

    // Validate server is still alive after _ensureServer (process may have died in between)
    if (!this._port || !this._process) {
      throw new Error('Vision runtime is not running (server exited after startup)');
    }

    let imageData = imageBase64;
    let mimeType = null;

    if (!imageData && imagePath) {
      const buffer = await fs.promises.readFile(imagePath);
      imageData = buffer.toString('base64');
      mimeType = detectMimeFromPath(imagePath);
    }

    if (!imageData) {
      throw new Error('Vision input not found');
    }

    if (!mimeType) {
      mimeType = detectBase64Mime(imageData) || 'image/png';
    }

    const dataUrl = `data:${mimeType};base64,${imageData}`;
    try {
      const response = await requestJson({
        method: 'POST',
        port: this._port,
        path: '/v1/chat/completions',
        body: {
          model: path.basename(config.modelPath),
          messages: [
            systemPrompt
              ? { role: 'system', content: systemPrompt }
              : { role: 'system', content: 'You are a helpful vision assistant.' },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt || 'Describe this image.' },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ],
          max_tokens: maxTokens,
          temperature
        },
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        signal
      });

      if (response?.json?.error) {
        const baseMessage = response.json.error.message || 'Vision runtime error';
        const decodePressureHint = this._extractDecodePressureHint();
        throw new Error(`${baseMessage}${decodePressureHint}`);
      }

      const content = response?.json?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Vision runtime returned empty response');
      }

      return { response: content };
    } finally {
      this.scheduleIdleShutdown('analyzeImage');
    }
  }

  async shutdown() {
    this._clearIdleShutdownTimer();
    // If already shutting down, return the existing promise
    if (this._shutdownPromise) {
      return this._shutdownPromise;
    }

    const proc = this._process;

    // Clear state immediately so concurrent callers don't re-use the dying server
    this._process = null;
    this._port = null;
    this._activeConfig = null;
    this._startPromise = null;
    this._recentStderr = '';

    // Remove the parent-exit safety handler since we're shutting down explicitly
    if (this._exitHandler) {
      process.removeListener('exit', this._exitHandler);
      this._exitHandler = null;
    }

    // Remove the general exit listener from the child process to prevent stale listener leaks
    if (proc && this._generalExitHandler) {
      try {
        proc.removeListener('exit', this._generalExitHandler);
      } catch {
        /* ignore -- process may already be destroyed */
      }
      this._generalExitHandler = null;
    }

    if (proc) {
      logger.info('[VisionService] Shutting down vision runtime');

      this._shutdownPromise = (async () => {
        // Wait for the process to actually exit (max 5 s) so a subsequent
        // _startServer doesn't race against the dying instance.
        // Attach the exit listener BEFORE killing to avoid missing the event.
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try {
              proc.kill('SIGKILL');
            } catch {
              /* ignore */
            }
            resolve();
          }, 5000);
          if (timeout.unref) timeout.unref();

          proc.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });

          // Remove other listeners to prevent leaks from _startServer
          try {
            proc.removeAllListeners('error');
            proc.stdout?.removeAllListeners();
            proc.stderr?.removeAllListeners();
          } catch {
            // ignore -- streams may already be closed
          }

          try {
            proc.kill();
          } catch {
            // ignore -- process may have already exited
          }
        });
      })().finally(() => {
        this._shutdownPromise = null;
      });

      await this._shutdownPromise;
    }
  }
}

const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: VisionService,
    serviceId: 'VISION_SERVICE',
    serviceName: 'VisionService',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

/** @internal Reset module-level caches (for testing only). */
function _resetRuntimeCache() {
  _nvidiaDetected = null;
  _macGpuDetected = null;
  loggedRuntimeVariant = false;
}

module.exports = {
  VisionService,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance,
  _resetRuntimeCache
};
