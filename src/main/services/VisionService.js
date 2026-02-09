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

const logger = createLogger('VisionService');
let loggedRuntimeVariant = false;

const LLAMA_CPP_RELEASE_TAG = process.env.STRATOSORT_LLAMA_CPP_TAG || 'b7956';
const LLAMA_CPP_BASE_URL = 'https://github.com/ggml-org/llama.cpp/releases/download';
const SERVER_BINARY_NAME = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';

// Vision models (4-5GB) can take several minutes to load on CPU-only systems
const DEFAULT_STARTUP_TIMEOUT_MS = TIMEOUTS.AI_ANALYSIS_LONG || 300000;
const DEFAULT_REQUEST_TIMEOUT_MS = TIMEOUTS.AI_ANALYSIS_LONG || 300000;

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
    // Use Vulkan build on x64 - it includes GPU acceleration and falls back to
    // CPU backends when no Vulkan driver is available.  ARM64 stays CPU-only.
    const assetName =
      arch === 'arm64'
        ? `llama-${tag}-bin-win-cpu-arm64.zip`
        : `llama-${tag}-bin-win-vulkan-x64.zip`;
    const config = {
      tag,
      assetName,
      archiveType: 'zip',
      url: `${LLAMA_CPP_BASE_URL}/${tag}/${assetName}`
    };
    if (!loggedRuntimeVariant) {
      loggedRuntimeVariant = true;
      logger.info('[VisionService] Selected vision runtime', {
        platform,
        arch,
        assetName
      });
      if (assetName.includes('win-vulkan')) {
        logger.warn(
          '[VisionService] Windows vision runtime uses Vulkan build. CUDA is not bundled by default; set STRATOSORT_LLAMA_CPP_URL to a CUDA build to override.'
        );
      }
    }
    return config;
  }

  if (platform === 'darwin') {
    // macOS builds include Metal GPU support by default
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
        // FIX: Destroy the response stream to stop incoming data on write error
        response.destroy();
        fs.unlink(destination, () => reject(error));
      });
      // FIX: Handle response errors by cleaning up the write stream
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

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk.toString('utf8');
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
    this._shutdownPromise = null; // FIX: Track shutdown to prevent race conditions
    this._serverLock = Promise.resolve(); // FIX: Mutex for server state changes
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

    // 2. Downloaded GPU-enabled runtime (preferred over bundled binary)
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

    // 3. Download the correct GPU-enabled runtime
    if (!this._runtimeInit) {
      this._runtimeInit = this._downloadRuntime();
    }
    try {
      await this._runtimeInit;
      if (this._binaryPath) {
        return this._binaryPath;
      }
    } catch (error) {
      logger.warn('[VisionService] Download failed, checking bundled fallback', {
        error: error.message
      });
    }

    // 4. Bundled binary as last resort (packaged builds or download failure)
    const packagedCandidate = resolveRuntimePath(SERVER_BINARY_NAME);
    if (fs.existsSync(packagedCandidate)) {
      logger.info('[VisionService] Using bundled runtime fallback', {
        binaryPath: packagedCandidate
      });
      this._binaryPath = packagedCandidate;
      return packagedCandidate;
    }

    throw new Error('Vision runtime not found: no downloaded, bundled, or env binary available');
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
    await extractArchive(archivePath, runtimeRoot, asset.archiveType);

    const binaryPath = await findBinary(runtimeRoot, SERVER_BINARY_NAME);
    if (!binaryPath) {
      throw new Error('Vision runtime binary not found after extraction');
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
      '--no-webui'
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
      port
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
      logger.debug('[VisionService][stderr]', { message: text });
    });

    // AbortController to cancel health check if process exits early
    const abortController = new AbortController();

    // Create a promise that rejects if the process exits before health is confirmed.
    // This prevents _waitForHealth from polling a dead process for 180s.
    const earlyExitPromise = new Promise((_, reject) => {
      child.on('exit', (code, signal) => {
        abortController.abort(); // Signal health check to stop polling
        const stderr = stderrChunks.join('').slice(-500);
        reject(
          new Error(
            `Vision runtime exited during startup (code=${code}, signal=${signal})${stderr ? ': ' + stderr : ''}`
          )
        );
      });
    });

    // Handle spawn-level errors (e.g. ENOENT when binary doesn't exist)
    child.on('error', (err) => {
      logger.error('[VisionService] Failed to spawn vision runtime', { error: err.message });
    });

    // Clean up state when the process exits (for both startup failures and runtime crashes)
    child.on('exit', (code, signal) => {
      logger.warn('[VisionService] Vision runtime exited', { code, signal });
      this._process = null;
      this._port = null;
      this._activeConfig = null;
      this._startPromise = null;
    });

    this._process = child;
    this._port = port;

    // Race health check against early exit -- if the process dies first, fail immediately
    try {
      await Promise.race([
        this._waitForHealth(port, DEFAULT_STARTUP_TIMEOUT_MS, abortController.signal),
        earlyExitPromise
      ]);
    } catch (error) {
      // Ensure we clean up if health check fails or process exits
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
      this._activeConfig.gpuLayers === config.gpuLayers
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
      throw new Error(response.json.error.message || 'Vision runtime error');
    }

    const content = response?.json?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Vision runtime returned empty response');
    }

    return { response: content };
  }

  async shutdown() {
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

    if (proc) {
      logger.info('[VisionService] Shutting down vision runtime');

      this._shutdownPromise = (async () => {
        // FIX: Remove all listeners from the child process to prevent leaks.
        // The 'exit' and 'error' listeners attached in _startServer would
        // otherwise accumulate if the service is restarted multiple times.
        try {
          proc.removeAllListeners();
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

        // Wait for the process to actually exit (max 5 s) so a subsequent
        // _startServer doesn't race against the dying instance.
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

module.exports = {
  VisionService,
  getInstance,
  createInstance,
  registerWithContainer,
  resetInstance
};
