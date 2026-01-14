/**
 * ChromaDB Default Configuration
 * Centralized constants for ChromaDB server connection
 * Consolidates duplicated URL construction from:
 * - src/main/services/startup/chromaService.js
 * - src/main/services/DependencyManagerService.js
 */

const CHROMA_DEFAULTS = {
  PROTOCOL: 'http',
  HOST: '127.0.0.1',
  PORT: 8000
};

/**
 * ChromaDB health check endpoints in priority order
 * Supports multiple ChromaDB versions:
 * - /api/v2/heartbeat: ChromaDB 3.x+
 * - /api/v1/heartbeat: ChromaDB 1.x-2.x
 * - /api/v1: Fallback for older versions
 */
const CHROMA_HEALTH_ENDPOINTS = ['/api/v2/heartbeat', '/api/v1/heartbeat', '/api/v1'];

/**
 * User-friendly error messages for common ChromaDB issues
 * Used by chromaService.js and other components for consistent messaging
 */
const CHROMA_ERROR_MESSAGES = {
  PORT_IN_USE: (port) =>
    `Port ${port} is already in use. This could mean:\n` +
    `• Another ChromaDB instance is running (wait a few seconds and restart)\n` +
    `• Another application is using port ${port}\n` +
    `• Check Task Manager for python.exe or chroma.exe processes\n\n` +
    `Solutions:\n` +
    `• Restart StratoSort to use the existing ChromaDB instance\n` +
    `• Set CHROMA_SERVER_PORT in .env to use a different port\n` +
    `• Kill conflicting processes and retry`,

  MISSING_DEPENDENCY:
    'ChromaDB is not installed. Semantic search features will be unavailable.\n\n' +
    'To install ChromaDB:\n' +
    '• Windows: py -3 -m pip install --user chromadb\n' +
    '• macOS/Linux: python3 -m pip install chromadb\n\n' +
    'Or use an external ChromaDB server by setting CHROMA_SERVER_URL',

  PYTHON_NOT_FOUND:
    'Python 3 is required for ChromaDB but was not found.\n\n' +
    'To install Python:\n' +
    '• Windows: Download from python.org or Microsoft Store\n' +
    '• macOS: brew install python3\n' +
    '• Linux: sudo apt install python3 python3-pip\n\n' +
    'After installing, restart StratoSort.',

  CONNECTION_FAILED: (url) =>
    `Cannot connect to ChromaDB server at ${url}.\n\n` +
    'Possible causes:\n' +
    '• ChromaDB server is not running\n' +
    '• Firewall is blocking the connection\n' +
    '• Wrong server URL configured\n\n' +
    'Try restarting StratoSort or check the server status.',

  EXTERNAL_UNREACHABLE: (url) =>
    `External ChromaDB server at ${url} is not reachable.\n\n` +
    'Please verify:\n' +
    '• The server is running and accessible\n' +
    '• The URL is correct (check CHROMA_SERVER_URL)\n' +
    '• Network/firewall allows the connection'
};

/**
 * Get ChromaDB data directory from environment or default
 * Supports production/container deployments via CHROMA_DATA_DIR env var
 * @param {string} [fallbackPath] - Fallback path if env var not set
 * @returns {string} ChromaDB data directory path
 */
function getChromaDataDir(fallbackPath) {
  if (process.env.CHROMA_DATA_DIR) {
    return process.env.CHROMA_DATA_DIR;
  }
  return fallbackPath || '';
}

/**
 * Build ChromaDB server URL from environment variables or defaults
 * @returns {string} Full ChromaDB server URL
 */
function getChromaUrl() {
  if (process.env.CHROMA_SERVER_URL) {
    return process.env.CHROMA_SERVER_URL;
  }

  const protocol = process.env.CHROMA_SERVER_PROTOCOL || CHROMA_DEFAULTS.PROTOCOL;
  const host = process.env.CHROMA_SERVER_HOST || CHROMA_DEFAULTS.HOST;
  const port = process.env.CHROMA_SERVER_PORT || CHROMA_DEFAULTS.PORT;

  return `${protocol}://${host}:${port}`;
}

/**
 * Parse ChromaDB URL into components
 * @param {string} [url] - URL to parse (defaults to environment/defaults)
 * @returns {{ protocol: string, host: string, port: number, url: string }}
 */
function parseChromaConfig(url) {
  const targetUrl = url || getChromaUrl();

  try {
    const parsed = new URL(targetUrl);
    const protocol = parsed.protocol?.replace(':', '') || CHROMA_DEFAULTS.PROTOCOL;
    const host = parsed.hostname || CHROMA_DEFAULTS.HOST;
    // FIX Issue 2.1: Always default to ChromaDB port (8000), not HTTP/HTTPS standard ports
    // If user wants 80/443, they must explicitly specify it in CHROMA_SERVER_PORT
    const port = Number(parsed.port) || CHROMA_DEFAULTS.PORT;

    return {
      protocol,
      host,
      port,
      url: `${protocol}://${host}:${port}`
    };
  } catch {
    // Fallback to defaults if parsing fails
    return {
      protocol: CHROMA_DEFAULTS.PROTOCOL,
      host: CHROMA_DEFAULTS.HOST,
      port: CHROMA_DEFAULTS.PORT,
      url: `${CHROMA_DEFAULTS.PROTOCOL}://${CHROMA_DEFAULTS.HOST}:${CHROMA_DEFAULTS.PORT}`
    };
  }
}

module.exports = {
  CHROMA_DEFAULTS,
  CHROMA_HEALTH_ENDPOINTS,
  CHROMA_ERROR_MESSAGES,
  getChromaUrl,
  getChromaDataDir,
  parseChromaConfig
};
