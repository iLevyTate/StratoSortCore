const { Ollama } = require('ollama');
const { withErrorLogging, withValidation } = require('./ipcWrappers');
let z;

function isValidOllamaUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return OLLAMA_URL_PATTERN.test(url.trim());
}

// URL pattern that properly matches IP addresses and hostnames
// Matches: http://127.0.0.1:11434, https://localhost:11434, http://ollama.local:11434
const OLLAMA_URL_PATTERN =
  /^https?:\/\/([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(:\d{1,5})?(\/.*)?$|^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d{1,5})?(\/.*)?$|^https?:\/\/localhost(:\d{1,5})?(\/.*)?$/;

/**
 * Normalize a URL for Ollama server connection
 * Handles missing protocol, extra whitespace, and double-protocol issues
 *
 * @param {string} [hostUrl] - The URL to normalize
 * @param {string} [defaultUrl='http://127.0.0.1:11434'] - Default URL if none provided
 * @returns {string} Normalized URL with protocol
 */
function normalizeOllamaUrl(hostUrl, defaultUrl = 'http://127.0.0.1:11434') {
  let url = hostUrl || defaultUrl;

  if (url && typeof url === 'string') {
    url = url.trim();

    // Check if URL already has a protocol
    const hasHttps = url.toLowerCase().startsWith('https://');
    const hasHttp = url.toLowerCase().startsWith('http://');

    if (hasHttps || hasHttp) {
      // Remove duplicate protocols (e.g., http://http://...)
      url = url.replace(/^(https?:\/\/)+/i, hasHttps ? 'https://' : 'http://');
    } else {
      // No protocol specified, add http://
      url = `http://${url}`;
    }
  }

  return url;
}
try {
  z = require('zod');
} catch {
  z = null;
}

function registerOllamaIpc({
  ipcMain,
  IPC_CHANNELS,
  logger,
  systemAnalytics,
  getMainWindow,
  getOllama,
  getOllamaModel,
  getOllamaVisionModel,
  getOllamaEmbeddingModel,
  getOllamaHost
}) {
  // Comprehensive patterns for model categorization
  // Vision models: Models that can process images
  const VISION_MODEL_PATTERNS = [
    /llava/i, // LLaVA family (llava, llava-llama3, llava-phi3, etc.)
    /bakllava/i, // BakLLaVA
    /moondream/i, // Moondream vision model
    /vision/i, // Any model with "vision" in name
    /llama.*vision/i, // Llama vision variants
    /gemma.*vision/i, // Gemma vision variants
    /-v\b/i, // Models ending with -v (like minicpm-v)
    /minicpm-v/i, // MiniCPM-V
    /cogvlm/i, // CogVLM
    /qwen.*vl/i, // Qwen-VL
    /internvl/i, // InternVL
    /yi-vl/i, // Yi-VL
    /deepseek-vl/i, // DeepSeek-VL
    /clip/i, // CLIP models
    /blip/i, // BLIP models
    /sam\b/i // SAM (Segment Anything)
  ];

  // Embedding models: Models for generating text embeddings
  const EMBEDDING_MODEL_PATTERNS = [
    /embed/i, // Any model with "embed" in name
    /embedding/i, // Any model with "embedding" in name
    /mxbai-embed/i, // MxBai embedding models
    /nomic-embed/i, // Nomic embedding models
    /all-minilm/i, // All-MiniLM models
    /\bbge\b/i, // BGE embedding models
    /e5-/i, // E5 embedding models
    /gte-/i, // GTE embedding models
    /stella/i, // Stella embedding models
    /snowflake-arctic-embed/i, // Snowflake Arctic Embed
    /paraphrase/i // Paraphrase models (typically embeddings)
  ];

  /**
   * Categorize a model by its name
   * @param {string} modelName - The model name to categorize
   * @returns {'vision' | 'embedding' | 'text'} The category
   */
  function categorizeModel(modelName) {
    const name = modelName || '';

    // Check vision patterns first (more specific)
    for (const pattern of VISION_MODEL_PATTERNS) {
      if (pattern.test(name)) {
        return 'vision';
      }
    }

    // Check embedding patterns
    for (const pattern of EMBEDDING_MODEL_PATTERNS) {
      if (pattern.test(name)) {
        return 'embedding';
      }
    }

    // Default to text model
    return 'text';
  }

  ipcMain.handle(
    IPC_CHANNELS.OLLAMA.GET_MODELS,
    withErrorLogging(logger, async () => {
      try {
        const ollama = getOllama();
        const response = await ollama.list();
        const models = response.models || [];
        const categories = { text: [], vision: [], embedding: [] };

        for (const m of models) {
          const name = m.name || '';
          const category = categorizeModel(name);
          categories[category].push(name);
        }

        // Sort each category alphabetically for consistent display
        categories.text.sort((a, b) => a.localeCompare(b));
        categories.vision.sort((a, b) => a.localeCompare(b));
        categories.embedding.sort((a, b) => a.localeCompare(b));
        // Ensure we update health on every models fetch
        systemAnalytics.ollamaHealth = {
          status: 'healthy',
          host: getOllamaHost ? getOllamaHost() : undefined,
          modelCount: models.length,
          lastCheck: Date.now()
        };
        return {
          models: models.map((m) => m.name),
          categories,
          selected: {
            textModel: getOllamaModel(),
            visionModel: getOllamaVisionModel(),
            embeddingModel:
              typeof getOllamaEmbeddingModel === 'function' ? getOllamaEmbeddingModel() : null
          },
          ollamaHealth: systemAnalytics.ollamaHealth,
          host: typeof getOllamaHost === 'function' ? getOllamaHost() : undefined
        };
      } catch (error) {
        logger.error('[IPC] Error fetching Ollama models:', error);
        if (error.cause && error.cause.code === 'ECONNREFUSED') {
          systemAnalytics.ollamaHealth = {
            status: 'unhealthy',
            error: 'Connection refused. Ensure Ollama is running.',
            lastCheck: Date.now()
          };
        }
        return {
          models: [],
          categories: { text: [], vision: [], embedding: [] },
          selected: {
            textModel: getOllamaModel(),
            visionModel: getOllamaVisionModel(),
            embeddingModel:
              typeof getOllamaEmbeddingModel === 'function' ? getOllamaEmbeddingModel() : null
          },
          error: error.message,
          host: typeof getOllamaHost === 'function' ? getOllamaHost() : undefined,
          ollamaHealth: systemAnalytics.ollamaHealth
        };
      }
    })
  );

  // Use relaxed URL validation that allows URLs with or without protocol
  // Normalize URL before validation to handle user input like "localhost:11434"
  const relaxedUrlPattern =
    /^(?:https?:\/\/)?(?:[\w.-]+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/.*)?$/;
  const hostSchema = z
    ? z
        .string()
        .trim()
        .regex(
          relaxedUrlPattern,
          'Invalid Ollama URL format (expected host[:port] with optional http/https)'
        )
        .or(z.string().length(0))
        .optional()
    : null;
  const testConnectionHandler =
    z && hostSchema
      ? withValidation(logger, hostSchema, async (event, hostUrl) => {
          try {
            // DUP-1: Use shared URL normalization utility (adds http:// if missing)
            const testUrl = normalizeOllamaUrl(hostUrl);

            const testOllama = new Ollama({ host: testUrl });
            const response = await testOllama.list();
            systemAnalytics.ollamaHealth = {
              status: 'healthy',
              host: testUrl,
              modelCount: response.models.length,
              lastCheck: Date.now()
            };
            return {
              success: true,
              host: testUrl,
              modelCount: response.models.length,
              models: response.models.map((m) => m.name),
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          } catch (error) {
            logger.error('[IPC] Ollama connection test failed:', error);
            // FIX: Use consistent fallback host value
            const fallbackHost = hostUrl || 'http://127.0.0.1:11434';
            systemAnalytics.ollamaHealth = {
              status: 'unhealthy',
              host: fallbackHost,
              error: error.message,
              lastCheck: Date.now()
            };
            return {
              success: false,
              host: fallbackHost,
              error: error.message,
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          }
        })
      : withErrorLogging(logger, async (event, hostUrl) => {
          try {
            // DUP-1: Use shared URL normalization utility
            const testUrl = normalizeOllamaUrl(hostUrl);
            if (!isValidOllamaUrl(testUrl)) {
              throw new Error('Invalid Ollama URL format');
            }

            const testOllama = new Ollama({ host: testUrl });
            const response = await testOllama.list();
            systemAnalytics.ollamaHealth = {
              status: 'healthy',
              host: testUrl,
              modelCount: response.models.length,
              lastCheck: Date.now()
            };
            return {
              success: true,
              host: testUrl,
              modelCount: response.models.length,
              models: response.models.map((m) => m.name),
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          } catch (error) {
            logger.error('[IPC] Ollama connection test failed:', error);
            // FIX: Use consistent fallback host value
            const fallbackHost = hostUrl || 'http://127.0.0.1:11434';
            systemAnalytics.ollamaHealth = {
              status: 'unhealthy',
              host: fallbackHost,
              error: error.message,
              lastCheck: Date.now()
            };
            return {
              success: false,
              host: fallbackHost,
              error: error.message,
              ollamaHealth: systemAnalytics.ollamaHealth
            };
          }
        });
  ipcMain.handle(IPC_CHANNELS.OLLAMA.TEST_CONNECTION, testConnectionHandler);

  // Pull models (best-effort, returns status per model)
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA.PULL_MODELS,
    withErrorLogging(logger, async (_event, models = []) => {
      try {
        const ollama = getOllama();
        const results = [];
        for (const model of Array.isArray(models) ? models : []) {
          try {
            // Send progress events if supported by client
            const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
            await ollama.pull({
              model,
              stream: (progress) => {
                try {
                  if (win && !win.isDestroyed()) {
                    win.webContents.send('operation-progress', {
                      type: 'ollama-pull',
                      model,
                      progress
                    });
                  }
                } catch {
                  // Non-fatal if progress send fails
                }
              }
            });
            results.push({ model, success: true });
          } catch (e) {
            results.push({ model, success: false, error: e.message });
          }
        }
        return { success: true, results };
      } catch (error) {
        logger.error('[IPC] Pull models failed]:', error);
        return { success: false, error: error.message };
      }
    })
  );

  // Delete a model
  ipcMain.handle(
    IPC_CHANNELS.OLLAMA.DELETE_MODEL,
    withErrorLogging(logger, async (_event, model) => {
      try {
        const ollama = getOllama();
        await ollama.delete({ model });
        return { success: true };
      } catch (error) {
        logger.error('[IPC] Delete model failed]:', error);
        return { success: false, error: error.message };
      }
    })
  );
}

module.exports = registerOllamaIpc;
