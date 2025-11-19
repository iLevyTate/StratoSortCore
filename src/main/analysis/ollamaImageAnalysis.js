const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const {
  getOllamaVisionModel,
  loadOllamaConfig,
  getOllamaClient,
} = require('../ollamaUtils');
const { buildOllamaOptions } = require('../services/PerformanceService');
const { globalDeduplicator } = require('../utils/llmOptimization');
const { generateWithRetry } = require('../utils/ollamaApiRetry');
const {
  AI_DEFAULTS,
  SUPPORTED_IMAGE_EXTENSIONS,
} = require('../../shared/constants');
const { normalizeAnalysisResult } = require('./utils');
const {
  getIntelligentCategory: getIntelligentImageCategory,
  getIntelligentKeywords: getIntelligentImageKeywords,
  safeSuggestedName,
} = require('./fallbackUtils');
const { getInstance: getChromaDB } = require('../services/ChromaDBService');
const FolderMatchingService = require('../services/FolderMatchingService');
const { logger } = require('../../shared/logger');
logger.setContext('OllamaImageAnalysis');
let chromaDbSingleton = null;
let folderMatcherSingleton = null;

// In-memory cache for image analysis keyed by path|size|mtimeMs
const imageAnalysisCache = new Map();
const MAX_IMAGE_CACHE = 300;
function setImageCache(signature, value) {
  if (!signature) return;
  imageAnalysisCache.set(signature, value);
  if (imageAnalysisCache.size > MAX_IMAGE_CACHE) {
    const first = imageAnalysisCache.keys().next().value;
    imageAnalysisCache.delete(first);
  }
}

// App configuration for image analysis - Optimized for speed
const AppConfig = {
  ai: {
    imageAnalysis: {
      defaultModel: AI_DEFAULTS.IMAGE.MODEL,
      defaultHost: AI_DEFAULTS.IMAGE.HOST,
      timeout: 120000,
      temperature: AI_DEFAULTS.IMAGE.TEMPERATURE,
      maxTokens: AI_DEFAULTS.IMAGE.MAX_TOKENS,
    },
  },
};

// Initialize Ollama client
// Use shared client from ollamaUtils

async function analyzeImageWithOllama(
  imageBase64,
  originalFileName,
  smartFolders = [],
) {
  try {
    const { logger } = require('../../shared/logger');
    logger.info(`Analyzing image content with Ollama`, {
      model: AppConfig.ai.imageAnalysis.defaultModel,
    });

    // Build folder categories string for the prompt (include descriptions)
    let folderCategoriesStr = '';
    if (smartFolders && smartFolders.length > 0) {
      const validFolders = smartFolders
        .filter(
          (f) => f && typeof f.name === 'string' && f.name.trim().length > 0,
        )
        .slice(0, 10)
        .map((f) => ({
          name: f.name.trim().slice(0, 50),
          description: (f.description || '').trim().slice(0, 140),
        }));
      if (validFolders.length > 0) {
        const folderListDetailed = validFolders
          .map(
            (f, i) =>
              `${i + 1}. "${f.name}" — ${f.description || 'no description provided'}`,
          )
          .join('\n');

        folderCategoriesStr = `\n\nAVAILABLE SMART FOLDERS (name — description):\n${folderListDetailed}\n\nSELECTION RULES (CRITICAL):\n- Choose the category by comparing the IMAGE CONTENT to the folder DESCRIPTIONS above.\n- Output the category EXACTLY as one of the folder names above (verbatim).\n- Do NOT invent new categories. If unsure, choose the closest match by description or use the first folder as a fallback.`;
      }
    }

    const prompt = `You are an expert image analyzer for an automated file organization system. Analyze this image named "${originalFileName}" and extract structured information.

Your response should be a JSON object with the following fields:
- date (if there's a visible date in the image, in YYYY-MM-DD format)
- project (a short, 2-5 word project name or main subject based on image content)
- purpose (a concise, 5-10 word description of what this image shows or represents)
- category (most appropriate category for organizing this file; must be one of the folder names above)${folderCategoriesStr}
- keywords (an array of 3-7 relevant keywords describing the image content)
- confidence (a number from 60-100 indicating analysis confidence)
- content_type (e.g., 'people', 'landscape', 'text_document', 'interface', 'object', 'animal', 'food', 'vehicle', 'architecture')
- has_text (boolean indicating if there's readable text in the image)
- colors (array of 2-4 dominant colors in the image)
- suggestedName (descriptive name based on image content, underscores, max 50 chars)

If you cannot determine a field, omit it from the JSON. Do not make up information. The output MUST be a valid JSON object.

Analyze this image:`;

    const cfg = await loadOllamaConfig();
    const modelToUse =
      getOllamaVisionModel() ||
      cfg.selectedVisionModel ||
      AppConfig.ai.imageAnalysis.defaultModel;

    // Use deduplicator to prevent duplicate LLM calls for identical images
    const deduplicationKey = globalDeduplicator.generateKey({
      image: imageBase64.slice(0, 1000), // Use first 1000 chars as signature
      model: modelToUse,
      fileName: originalFileName,
      folders: smartFolders.map((f) => f.name).join(','),
    });

    const client = await getOllamaClient();
    const perfOptions = await buildOllamaOptions('vision');
    const response = await globalDeduplicator.deduplicate(
      deduplicationKey,
      () =>
        generateWithRetry(
          client,
          {
            model: modelToUse,
            prompt,
            images: [imageBase64],
            options: {
              temperature: AppConfig.ai.imageAnalysis.temperature,
              num_predict: AppConfig.ai.imageAnalysis.maxTokens,
              ...perfOptions,
            },
            format: 'json',
          },
          {
            operation: `Image analysis for ${originalFileName}`,
            maxRetries: 3,
            initialDelay: 1000,
            maxDelay: 4000,
          },
        ),
    );

    if (response.response) {
      try {
        const parsedJson = JSON.parse(response.response);

        // Validate and structure the date
        if (parsedJson.date) {
          try {
            parsedJson.date = new Date(parsedJson.date)
              .toISOString()
              .split('T')[0];
          } catch (e) {
            delete parsedJson.date;
            logger.warn('Ollama returned an invalid date for image, omitting.');
          }
        }

        // Ensure array fields are initialized if undefined
        const finalKeywords = Array.isArray(parsedJson.keywords)
          ? parsedJson.keywords
          : [];
        const finalColors = Array.isArray(parsedJson.colors)
          ? parsedJson.colors
          : [];

        // Ensure confidence is a reasonable number
        // MEDIUM PRIORITY FIX (MED-10): Use fixed default instead of random value
        if (
          !parsedJson.confidence ||
          parsedJson.confidence < 60 ||
          parsedJson.confidence > 100
        ) {
          parsedJson.confidence = 75; // Fixed default when Ollama returns invalid confidence
          logger.debug(
            '[IMAGE-ANALYSIS] Invalid confidence from Ollama, using default: 75',
          );
        }

        return {
          ...parsedJson,
          keywords: finalKeywords,
          colors: finalColors,
          has_text: Boolean(parsedJson.has_text),
        };
      } catch (e) {
        logger.error('Error parsing Ollama JSON response for image', {
          error: e.message,
        });
        return {
          error: 'Failed to parse image analysis from Ollama.',
          keywords: [],
          confidence: 65,
        };
      }
    }

    return {
      error: 'No content in Ollama response for image',
      keywords: [],
      confidence: 60,
    };
  } catch (error) {
    const { logger } = require('../../shared/logger');
    logger.error('Error calling Ollama API for image', {
      error: error.message,
    });

    // Specific handling for zero-length image error
    if (error.message.includes('zero length image')) {
      return {
        error: 'Image is empty or corrupted - cannot analyze zero-length image',
        keywords: [],
        confidence: 0,
      };
    }
    // Guidance for vision model input failures
    if (error.message.includes('unable to make llava embedding')) {
      return {
        error:
          'Unsupported image format or dimensions for vision model. Convert to PNG/JPG and keep under ~2048px on the longest side.',
        keywords: [],
        confidence: 0,
      };
    }

    return {
      error: `Ollama API error for image: ${error.message}`,
      keywords: [],
      confidence: 60,
    };
  }
}

async function analyzeImageFile(filePath, smartFolders = []) {
  const { logger } = require('../../shared/logger');
  logger.info(`Analyzing image file`, { path: filePath });
  const fileExtension = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  // Check if file extension is supported (include SVG by rasterizing via sharp)
  const supportedExtensions = SUPPORTED_IMAGE_EXTENSIONS;
  if (!supportedExtensions.includes(fileExtension)) {
    return {
      error: `Unsupported image format: ${fileExtension}`,
      category: 'unsupported',
      keywords: [],
      confidence: 0,
      suggestedName: fileName
        .replace(fileExtension, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_'),
    };
  }

  // Fixed: Proactive graceful degradation - check Ollama availability before processing
  const ModelVerifier = require('../services/ModelVerifier');
  const modelVerifier = new ModelVerifier();

  try {
    const connectionCheck = await modelVerifier.checkOllamaConnection();
    if (!connectionCheck.connected) {
      logger.warn(
        '[ANALYSIS-FALLBACK] Ollama unavailable, using filename-based analysis',
        {
          fileName,
          error: connectionCheck.error,
        },
      );
      const intelligentCategory = getIntelligentImageCategory(
        fileName,
        fileExtension,
      );
      const intelligentKeywords = getIntelligentImageKeywords(
        fileName,
        fileExtension,
      );
      return {
        purpose: `Image (fallback - Ollama unavailable)`,
        project: fileName.replace(fileExtension, ''),
        category: intelligentCategory,
        date: new Date().toISOString().split('T')[0],
        keywords: intelligentKeywords,
        confidence: 60,
        suggestedName: safeSuggestedName(fileName, fileExtension),
        extractionMethod: 'filename_fallback',
        fallbackReason: connectionCheck.error,
      };
    }
  } catch (error) {
    logger.error('[IMAGE] Pre-flight verification failed', {
      error: error.message,
    });
    // Continue with fallback
    const intelligentCategory = getIntelligentImageCategory(
      fileName,
      fileExtension,
    );
    const intelligentKeywords = getIntelligentImageKeywords(
      fileName,
      fileExtension,
    );
    return {
      purpose: `Image (fallback - verification error)`,
      project: fileName.replace(fileExtension, ''),
      category: intelligentCategory,
      date: new Date().toISOString().split('T')[0],
      keywords: intelligentKeywords,
      confidence: 55,
      suggestedName: safeSuggestedName(fileName, fileExtension),
      extractionMethod: 'filename_fallback',
      fallbackReason: error.message,
    };
  }

  try {
    // First, check if file exists and has content
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (statError) {
      // CRITICAL FIX: Handle ENOENT and other file access errors gracefully
      if (statError.code === 'ENOENT') {
        logger.error(`Image file does not exist`, { path: filePath });
        return {
          error: 'Image file not found (ENOENT)',
          category: 'error',
          keywords: [],
          confidence: 0,
        };
      }
      throw statError; // Re-throw other errors
    }

    if (stats.size === 0) {
      logger.error(`Image file is empty`, { path: filePath });
      return {
        error: 'Image file is empty (0 bytes)',
        category: 'error',
        keywords: [],
        confidence: 0,
      };
    }

    logger.debug(`Image file size`, { bytes: stats.size });

    // CRITICAL FIX: Wrap readFile in try-catch to handle TOCTOU race condition
    // File could be deleted between stat() and readFile() calls
    let imageBuffer;
    try {
      imageBuffer = await fs.readFile(filePath);
    } catch (readError) {
      if (readError.code === 'ENOENT') {
        logger.error(`Image file disappeared during read`, { path: filePath });
        return {
          error: 'Image file was deleted during analysis (TOCTOU)',
          category: 'error',
          keywords: [],
          confidence: 0,
        };
      }
      throw readError; // Re-throw other errors
    }

    // Cache quick path: signature based on file stats
    const signature = `${filePath}|${stats.size}|${stats.mtimeMs}`;
    if (imageAnalysisCache.has(signature)) {
      return imageAnalysisCache.get(signature);
    }

    // Preprocess image for vision model compatibility
    // - Convert unsupported formats (svg, tiff, bmp, gif, webp) to PNG
    // - Downscale very large images to avoid model failures
    try {
      const needsFormatConversion = [
        '.svg',
        '.tiff',
        '.tif',
        '.bmp',
        '.gif',
        '.webp',
      ].includes(fileExtension);
      let transformer = null;

      let meta = null;
      try {
        meta = await sharp(imageBuffer).metadata();
      } catch {
        // Non-fatal if metadata extraction fails
      }

      const maxDimension = 1536; // smaller to speed up vision model
      const shouldResize =
        meta &&
        (Number(meta.width) > maxDimension ||
          Number(meta.height) > maxDimension);

      if (needsFormatConversion || shouldResize) {
        transformer = sharp(imageBuffer);
        if (shouldResize) {
          const resizeOptions = { fit: 'inside', withoutEnlargement: true };
          if (meta && meta.width && meta.height) {
            if (meta.width >= meta.height) resizeOptions.width = maxDimension;
            else resizeOptions.height = maxDimension;
          } else {
            resizeOptions.width = maxDimension;
          }
          transformer = transformer.resize(resizeOptions);
        }
        // Use lower compression level to reduce CPU while keeping size reasonable
        imageBuffer = await transformer.png({ compressionLevel: 5 }).toBuffer();
      }
    } catch (preErr) {
      logger.error(`Failed to pre-process image for analysis`, {
        path: filePath,
        error: preErr.message,
      });
    }

    // Validate buffer is not empty
    if (imageBuffer.length === 0) {
      logger.error(`Image buffer is empty after reading`, { path: filePath });
      return {
        error: 'Image buffer is empty after reading',
        category: 'error',
        keywords: [],
        confidence: 0,
      };
    }

    logger.debug(`Image buffer size`, { bytes: imageBuffer.length });
    const imageBase64 = imageBuffer.toString('base64');

    // Validate base64 encoding
    if (!imageBase64 || imageBase64.length === 0) {
      logger.error(`Image base64 encoding failed`, { path: filePath });
      return {
        error: 'Image base64 encoding failed',
        category: 'error',
        keywords: [],
        confidence: 0,
      };
    }

    logger.debug(`Base64 length`, { chars: imageBase64.length });

    // Analyze with Ollama
    let analysis;
    try {
      analysis = await analyzeImageWithOllama(
        imageBase64,
        fileName,
        smartFolders,
      );
    } catch (error) {
      logger.error('[IMAGE] Error calling analyzeImageWithOllama', {
        error: error.message,
        filePath,
      });
      // Fallback to filename-based analysis
      const intelligentCategory = getIntelligentImageCategory(
        fileName,
        fileExtension,
      );
      const intelligentKeywords = getIntelligentImageKeywords(
        fileName,
        fileExtension,
      );
      return {
        purpose: `Image (fallback - analysis error)`,
        project: fileName.replace(fileExtension, ''),
        category: intelligentCategory,
        date: new Date().toISOString().split('T')[0],
        keywords: intelligentKeywords,
        confidence: 55,
        suggestedName: safeSuggestedName(fileName, fileExtension),
        extractionMethod: 'filename_fallback',
        error: error.message,
      };
    }

    // Semantic folder refinement using embeddings based on image JSON fields
    try {
      // Reuse single service instances to avoid reloading data repeatedly
      const chromaDb = chromaDbSingleton || (chromaDbSingleton = getChromaDB());

      // BUG FIX #8: Comprehensive null/undefined validation with duck typing
      // CRITICAL: folderMatcher can be an object with undefined methods, causing crashes
      if (!chromaDb) {
        logger.warn(
          '[IMAGE] ChromaDB not available, skipping semantic folder refinement',
        );
      } else {
        const folderMatcher =
          folderMatcherSingleton ||
          (folderMatcherSingleton = new FolderMatchingService(chromaDb));

        // BUG FIX #8: Duck typing validation - check that all required methods exist
        // Don't just check if object is truthy, validate it has the methods we need
        const hasRequiredMethods =
          folderMatcher &&
          typeof folderMatcher === 'object' &&
          typeof folderMatcher.initialize === 'function' &&
          typeof folderMatcher.upsertFolderEmbedding === 'function' &&
          typeof folderMatcher.upsertFileEmbedding === 'function' &&
          typeof folderMatcher.matchFileToFolders === 'function';

        if (!hasRequiredMethods) {
          logger.warn(
            '[IMAGE] FolderMatcher invalid or missing required methods',
            {
              hasFolderMatcher: !!folderMatcher,
              folderMatcherType: typeof folderMatcher,
              hasInitialize: typeof folderMatcher?.initialize === 'function',
              hasUpsertFolder:
                typeof folderMatcher?.upsertFolderEmbedding === 'function',
              hasUpsertFile:
                typeof folderMatcher?.upsertFileEmbedding === 'function',
              hasMatchFile:
                typeof folderMatcher?.matchFileToFolders === 'function',
            },
          );
        } else {
          // Initialize FolderMatchingService on first use
          if (!folderMatcher.embeddingCache?.initialized) {
            try {
              await folderMatcher.initialize();
            } catch (initError) {
              logger.warn(
                '[IMAGE] FolderMatcher initialization error:',
                initError.message,
              );
              // Continue with analysis even if folder matching initialization failed
              // The analysis result is still valid without semantic folder refinement
            }
          }

          // Validate smartFolders before attempting to upsert
          if (
            smartFolders &&
            Array.isArray(smartFolders) &&
            smartFolders.length > 0
          ) {
            try {
              // Validate each folder has required properties before upserting
              const validFolders = smartFolders.filter(
                (f) => f && typeof f === 'object' && (f.name || f.id || f.path),
              );

              if (validFolders.length > 0) {
                await Promise.all(
                  validFolders.map((f) =>
                    folderMatcher.upsertFolderEmbedding(f),
                  ),
                );
              }
            } catch (upsertError) {
              logger.warn(
                '[IMAGE] Folder embedding upsert error:',
                upsertError.message,
              );
              // Continue even if folder upsert fails - we can still try file matching
            }
          }

          // Continue with file embedding and matching
          const fileId = `image:${filePath}`;
          const summary = [
            analysis.project,
            analysis.purpose,
            (analysis.keywords || []).join(' '),
            analysis.content_type || '',
          ]
            .filter(Boolean)
            .join('\n');

          try {
            // Validate summary is non-empty before upserting
            if (summary && summary.trim().length > 0) {
              // CRITICAL FIX: Ensure ChromaDB is initialized
              const chromaDbService =
                require('../services/ChromaDBService').getInstance();
              if (chromaDbService) {
                await chromaDbService.initialize();
              }

              await folderMatcher.upsertFileEmbedding(fileId, summary, {
                path: filePath,
              });

              // CRITICAL FIX: Add delay to ensure write consistency before querying
              // ChromaDB has retry logic with delays of 50ms, 100ms, 200ms
              // We wait slightly longer than the max retry delay to ensure consistency
              const { TIMEOUTS } = require('../../shared/performanceConstants');
              await new Promise((resolve) =>
                setTimeout(resolve, TIMEOUTS.DELAY_SHORT),
              );

              const candidates = await folderMatcher.matchFileToFolders(
                fileId,
                5,
              );

              // Validate candidates structure before accessing
              if (Array.isArray(candidates) && candidates.length > 0) {
                const top = candidates[0];

                // Validate top candidate has required properties
                if (
                  top &&
                  typeof top === 'object' &&
                  typeof top.score === 'number' &&
                  top.name
                ) {
                  if (top.score >= 0.55) {
                    // CRITICAL FIX: Ensure category and destination folder match
                    // Category should always be the folder name
                    analysis.category = top.name;
                    // Suggested folder name for display
                    analysis.suggestedFolder = top.name;
                    // Destination folder path (or name if path missing) - should correspond to category
                    analysis.destinationFolder = top.path || top.name;

                    logger.debug('[IMAGE] Folder match applied', {
                      category: top.name,
                      destinationFolder: top.path || top.name,
                      score: top.score,
                    });
                  }
                  analysis.folderMatchCandidates = candidates;
                }
              }
            } else {
              logger.debug(
                '[IMAGE] Empty summary, skipping folder matching for:',
                filePath,
              );
            }
          } catch (matchError) {
            logger.warn('[IMAGE] Folder matching error:', matchError.message);
          }
        }
      }
    } catch (error) {
      // EDGE CASE: Catch unexpected errors and log details
      logger.warn('[IMAGE] Unexpected error in semantic folder refinement:', {
        error: error?.message,
        stack: error?.stack,
        filePath,
      });
    }

    // Ensure analysis is defined before checking properties
    if (!analysis) {
      logger.warn('[IMAGE] analyzeImageWithOllama returned undefined', {
        filePath,
      });
      const intelligentCategory = getIntelligentImageCategory(
        fileName,
        fileExtension,
      );
      const intelligentKeywords = getIntelligentImageKeywords(
        fileName,
        fileExtension,
      );
      const result = {
        purpose: 'Image analyzed with fallback method.',
        project: fileName.replace(fileExtension, ''),
        date: new Date().toISOString().split('T')[0],
        category: intelligentCategory,
        keywords: intelligentKeywords,
        confidence: 60,
        error: 'Ollama image analysis returned undefined',
      };
      try {
        setImageCache(signature, result);
      } catch {
        // Non-fatal if caching fails
      }
      return result;
    }

    if (analysis && !analysis.error) {
      const normalized = normalizeAnalysisResult(
        {
          ...analysis,
          content_type: analysis.content_type || 'unknown',
          suggestedName:
            analysis.suggestedName ||
            safeSuggestedName(fileName, fileExtension),
        },
        { category: 'image', keywords: [] },
      );
      try {
        setImageCache(signature, normalized);
      } catch {
        // Non-fatal if caching fails
      }
      return normalized;
    }

    // Fallback analysis if Ollama fails
    const intelligentCategory = getIntelligentImageCategory(
      fileName,
      fileExtension,
    );
    const intelligentKeywords = getIntelligentImageKeywords(
      fileName,
      fileExtension,
    );

    const result = {
      keywords: Array.isArray(analysis.keywords)
        ? analysis.keywords
        : intelligentKeywords,
      purpose: 'Image analyzed with fallback method.',
      project: fileName.replace(fileExtension, ''),
      date: new Date().toISOString().split('T')[0],
      category: intelligentCategory,
      confidence: 60,
      error: analysis?.error || 'Ollama image analysis failed.',
    };
    try {
      setImageCache(signature, result);
    } catch {
      // Non-fatal if caching fails
    }
    return result;
  } catch (error) {
    logger.error('Error processing image', { filePath, error: error.message });
    return {
      error: `Failed to process image: ${error.message}`,
      category: 'error',
      project: fileName,
      keywords: [],
      confidence: 50,
    };
  }
}

// OCR capability using Ollama for text extraction from images
async function extractTextFromImage(filePath) {
  const { logger } = require('../../shared/logger');
  try {
    const imageBuffer = await fs.readFile(filePath);
    const imageBase64 = imageBuffer.toString('base64');

    const prompt = `Extract all readable text from this image. Return only the text content, maintaining the original structure and formatting as much as possible. If no text is found, return "NO_TEXT_FOUND".`;

    const cfg2 = await loadOllamaConfig();
    const modelToUse2 =
      getOllamaVisionModel() ||
      cfg2.selectedVisionModel ||
      AppConfig.ai.imageAnalysis.defaultModel;
    const client2 = await getOllamaClient();
    const response = await generateWithRetry(
      client2,
      {
        model: modelToUse2,
        prompt,
        images: [imageBase64],
        options: {
          temperature: 0.1, // Lower temperature for text extraction
          num_predict: 2000,
        },
      },
      {
        operation: `Text extraction from image ${path.basename(filePath)}`,
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 4000,
      },
    );

    if (response.response && response.response.trim() !== 'NO_TEXT_FOUND') {
      return response.response.trim();
    }

    return null;
  } catch (error) {
    logger.error('Error extracting text from image', { error: error.message });
    return null;
  }
}

// Fallback image helpers sourced from fallbackUtils

module.exports = {
  analyzeImageFile,
  extractTextFromImage,
};
