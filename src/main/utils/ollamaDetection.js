const http = require('http');
const https = require('https');
const { asyncSpawn } = require('./asyncSpawnUtils');

/**
 * Check if Ollama is installed and available in PATH
 * @returns {Promise<boolean>}
 */
async function isOllamaInstalled() {
  const result = await asyncSpawn('ollama', ['--version'], { timeout: 5000, windowsHide: true });
  return result.status === 0;
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
 * @returns {Promise<boolean>}
 */
async function isOllamaRunning(host = 'http://127.0.0.1:11434') {
  try {
    const url = new URL('/api/tags', host);
    return new Promise((resolve) => {
      const request = (url.protocol === 'https:' ? https : http).get(url, (res) => {
        resolve(res.statusCode === 200);
      });
      request.on('error', () => resolve(false));
      request.setTimeout(2000, () => {
        request.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
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
  getInstalledModels
};
