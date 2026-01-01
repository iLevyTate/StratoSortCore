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
    const port = Number(parsed.port) || (protocol === 'https' ? 443 : 80) || CHROMA_DEFAULTS.PORT;

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
  getChromaUrl,
  parseChromaConfig
};
