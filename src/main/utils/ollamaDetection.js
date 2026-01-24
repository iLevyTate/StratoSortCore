const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { asyncSpawn } = require('./asyncSpawnUtils');

/**
 * Get platform-specific fallback paths for Ollama binary
 * @returns {string[]} List of potential binary paths
 */
function getOllamaFallbackPaths() {
  const platform = process.platform;
  const home = os.homedir();

  if (platform === 'win32') {
    return [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(process.env.PROGRAMFILES || '', 'Ollama', 'ollama.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe'),
      path.join(home, 'scoop', 'apps', 'ollama', 'current', 'ollama.exe')
    ];
  } else if (platform === 'darwin') {
    return [
      '/usr/local/bin/ollama',
      '/opt/homebrew/bin/ollama',
      path.join(home, '.ollama', 'bin', 'ollama'),
      '/Applications/Ollama.app/Contents/Resources/ollama'
    ];
  } else {
    // Linux
    return [
      '/usr/local/bin/ollama',
      '/usr/bin/ollama',
      path.join(home, '.ollama', 'bin', 'ollama'),
      '/opt/ollama/bin/ollama'
    ];
  }
}

/**
 * Find Ollama binary with fallback paths
 * @returns {Promise<{found: boolean, path: string|null, source: 'path'|'fallback'|null}>}
 */
async function findOllamaBinary() {
  // First try PATH
  const pathResult = await asyncSpawn('ollama', ['--version'], {
    timeout: 5000,
    windowsHide: true
  });
  if (pathResult.status === 0) {
    return { found: true, path: 'ollama', source: 'path' };
  }

  // Try fallback paths
  const fallbacks = getOllamaFallbackPaths();
  for (const binPath of fallbacks) {
    if (!binPath) continue;

    try {
      await fs.access(binPath);
      // Verify it's actually executable
      const result = await asyncSpawn(binPath, ['--version'], { timeout: 5000, windowsHide: true });
      if (result.status === 0) {
        return { found: true, path: binPath, source: 'fallback' };
      }
    } catch {
      // Continue to next fallback
    }
  }

  return { found: false, path: null, source: null };
}

/**
 * Check if Ollama is installed and available in PATH
 * @returns {Promise<boolean>}
 */
async function isOllamaInstalled() {
  const { found } = await findOllamaBinary();
  return found;
}

/**
 * Get installed Ollama version
 * @returns {Promise<string|null>} Version string or null
 */
async function getOllamaVersion() {
  const result = await asyncSpawn('ollama', ['--version'], { timeout: 5000, windowsHide: true });
  if (result.status === 0) {
    return (result.stdout || result.stderr).trim();
  }
  return null;
}

/**
 * Check if Ollama server is running
 * @param {string} host - Host URL to check (default: http://127.0.0.1:11434)
 * @param {number} timeoutMs - Timeout in milliseconds (default: 10000 - generous for slow startup)
 * @returns {Promise<boolean>}
 */
async function isOllamaRunning(host = 'http://127.0.0.1:11434', timeoutMs = 10000) {
  try {
    const url = new URL('/api/tags', host);
    return new Promise((resolve) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, (res) => {
        resolve(res.statusCode === 200);
      });
      request.on('error', () => resolve(false));
      request.setTimeout(timeoutMs, () => {
        request.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

/**
 * Check if Ollama server is running with retries
 * @param {string} host - Host URL to check (default: http://127.0.0.1:11434)
 * @param {number} maxRetries - Max retry attempts (default: 2)
 * @param {number} retryDelayMs - Delay between retries (default: 1000)
 * @returns {Promise<boolean>}
 */
async function isOllamaRunningWithRetry(
  host = 'http://127.0.0.1:11434',
  maxRetries = 2,
  retryDelayMs = 1000
) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const isRunning = await isOllamaRunning(host, 5000); // 5s timeout per attempt
    if (isRunning) return true;

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return false;
}

/**
 * Get list of installed models via CLI
 * @returns {Promise<string[]>} List of model names
 */
async function getInstalledModels() {
  try {
    const result = await asyncSpawn('ollama', ['list'], { timeout: 5000, windowsHide: true });
    if (result.status !== 0) return [];

    const lines = result.stdout.split('\n').slice(1);
    const models = lines
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.split(/\s+/);
        return parts[0] ? parts[0].toLowerCase() : null;
      })
      .filter(Boolean);
    return models;
  } catch {
    return [];
  }
}

module.exports = {
  isOllamaInstalled,
  getOllamaVersion,
  isOllamaRunning,
  isOllamaRunningWithRetry,
  getInstalledModels,
  findOllamaBinary,
  getOllamaFallbackPaths
};
