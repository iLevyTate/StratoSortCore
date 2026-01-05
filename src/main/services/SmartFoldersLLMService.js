const { logger } = require('../../shared/logger');

logger.setContext('SmartFoldersLLMService');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { fetchWithRetry } = require('../utils/ollamaApiRetry');
const { getOllamaHost } = require('../ollamaUtils');
const { DEFAULT_AI_MODELS } = require('../../shared/constants');
const { SERVICE_URLS } = require('../../shared/configDefaults');

async function enhanceSmartFolderWithLLM(folderData, existingFolders, getOllamaModel) {
  try {
    logger.info('[LLM-ENHANCEMENT] Analyzing smart folder for optimization:', folderData.name);

    const existingFolderContext = existingFolders.map((f) => ({
      name: f.name,
      description: f.description,
      keywords: f.keywords || [],
      category: f.category || 'general'
    }));

    const prompt = `You are an expert file organization system. Analyze this new smart folder and provide enhancements based on existing folder structure.

NEW FOLDER:
Name: "${folderData.name}"
Path: "${folderData.path}"
Description: "${folderData.description || ''}"

EXISTING FOLDERS:
${existingFolderContext.map((f) => `- ${f.name}: ${f.description} (Category: ${f.category})`).join('\n')}

Please provide a JSON response with the following enhancements:
{
  "improvedDescription": "enhanced description",
  "suggestedKeywords": ["keyword1", "keyword2"],
  "organizationTips": "tips for better organization",
  "confidence": 0.8
}`;

    const modelToUse =
      (typeof getOllamaModel === 'function' && getOllamaModel()) || DEFAULT_AI_MODELS.TEXT_ANALYSIS;

    const host = typeof getOllamaHost === 'function' ? getOllamaHost() : SERVICE_URLS.OLLAMA_HOST;

    try {
      const response = await fetchWithRetry(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelToUse,
          prompt,
          stream: false,
          format: 'json',
          options: { temperature: 0.3, num_predict: 500 }
        })
      });

      if (!response?.ok) {
        return {
          error: `HTTP error ${response?.status || 'unknown'}`
        };
      }

      const data = await response.json();
      const enhancement = extractAndParseJSON(data?.response, null);

      if (enhancement && typeof enhancement === 'object') {
        logger.info('[LLM-ENHANCEMENT] Successfully enhanced smart folder');
        return enhancement;
      }

      logger.warn('[LLM-ENHANCEMENT] Failed to parse LLM response', {
        responseLength: data?.response?.length,
        responsePreview: data?.response?.substring?.(0, 300)
      });
      return { error: 'Invalid JSON response from LLM' };
    } catch (serviceError) {
      logger.error('[LLM-ENHANCEMENT] Service error:', serviceError);
      return { error: serviceError.message || 'Service error' };
    }
  } catch (error) {
    logger.error('[LLM-ENHANCEMENT] Failed to enhance smart folder:', error.message);
    return { error: error.message };
  }
}

async function calculateFolderSimilarities(suggestedCategory, folderCategories, getOllamaModel) {
  try {
    const similarities = [];
    const modelToUse =
      (typeof getOllamaModel === 'function' && getOllamaModel()) || DEFAULT_AI_MODELS.TEXT_ANALYSIS;
    const host = typeof getOllamaHost === 'function' ? getOllamaHost() : SERVICE_URLS.OLLAMA_HOST;

    if (!Array.isArray(folderCategories) || folderCategories.length === 0) {
      return [];
    }

    const pushFallback = (folder) => {
      const basicSimilarity = calculateBasicSimilarity(suggestedCategory, folder.name);
      similarities.push({
        name: folder.name,
        id: folder.id,
        confidence: basicSimilarity,
        description: folder.description,
        fallback: true
      });
    };

    for (const folder of folderCategories) {
      const prompt = `Compare these two categories for semantic similarity:
Category 1: "${suggestedCategory}"
Category 2: "${folder.name}" (Description: "${folder.description}")

Rate similarity from 0.0 to 1.0 where:
- 1.0 = identical meaning
- 0.8+ = very similar concepts
- 0.6+ = related concepts
- 0.4+ = somewhat related
- 0.2+ = loosely related
- 0.0 = unrelated

Respond with only a number between 0.0 and 1.0:`;

      try {
        const response = await fetchWithRetry(`${host}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelToUse,
            prompt,
            stream: false,
            options: { temperature: 0.1, num_predict: 10 }
          })
        });

        if (response?.ok) {
          const data = await response.json();
          const raw = data?.response || '';
          try {
            const similarity = parseFloat((raw || '').trim());
            if (!isNaN(similarity) && similarity >= 0 && similarity <= 1) {
              similarities.push({
                name: folder.name,
                id: folder.id,
                confidence: similarity,
                description: folder.description
              });
            } else {
              pushFallback(folder);
            }
          } catch (parseError) {
            logger.warn(
              `[SEMANTIC] Failed to parse response for folder ${folder.name}:`,
              parseError.message
            );
            pushFallback(folder);
          }
        } else {
          logger.warn(`[SEMANTIC] Service error for folder ${folder.name}`);
          pushFallback(folder);
        }
      } catch (folderError) {
        logger.warn(`[SEMANTIC] Failed to analyze folder ${folder.name}:`, folderError.message);
        pushFallback(folder);
      }
    }
    return similarities.sort((a, b) => b.confidence - a.confidence);
  } catch (error) {
    logger.error('[SEMANTIC] Folder similarity calculation failed:', error);
    return [];
  }
}

function calculateBasicSimilarity(str1, str2) {
  const s1 = String(str1 || '').toLowerCase();
  const s2 = String(str2 || '').toLowerCase();
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  const overlap = words1.filter((w) => words2.includes(w)).length;
  const total = Math.max(words1.length, words2.length) || 1;
  return overlap / total;
}

module.exports = {
  enhanceSmartFolderWithLLM,
  calculateFolderSimilarities,
  calculateBasicSimilarity
};
