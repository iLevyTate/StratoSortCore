const { createLogger } = require('../../shared/logger');

const logger = createLogger('SmartFoldersLLMService');
const { extractAndParseJSON } = require('../utils/jsonRepair');
const { getInstance: getLlamaService } = require('./LlamaService');
const { withAbortableTimeout } = require('../../shared/promiseUtils');
const { TIMEOUTS } = require('../../shared/performanceConstants');

function cleanText(value, maxLength = 240) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function clamp01(value, fallback = 0.75) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sanitizeStringList(values, { maxItems = 8, maxLength = 40 } = {}) {
  if (!Array.isArray(values)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of values) {
    const cleaned = cleanText(entry, maxLength);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= maxItems) break;
  }
  return out;
}

function resolveExistingFolderName(value, existingFolders = []) {
  const cleaned = cleanText(value, 80);
  if (!cleaned) return null;
  const exact = existingFolders.find(
    (folder) =>
      typeof folder?.name === 'string' && folder.name.toLowerCase() === cleaned.toLowerCase()
  );
  if (exact) return exact.name;
  const normalized = normalizeName(cleaned);
  const normalizedMatch = existingFolders.find(
    (folder) => typeof folder?.name === 'string' && normalizeName(folder.name) === normalized
  );
  return normalizedMatch?.name || null;
}

function normalizeEnhancement(raw, folderData, existingFolders = []) {
  const suggestedCategory =
    cleanText(raw?.suggestedCategory || '', 60).toLowerCase() ||
    cleanText(folderData?.category || '', 60).toLowerCase() ||
    'general';
  const relatedFolders = sanitizeStringList(raw?.relatedFolders, { maxItems: 6, maxLength: 80 })
    .map((name) => resolveExistingFolderName(name, existingFolders))
    .filter(Boolean);
  const improvedDescription =
    cleanText(raw?.improvedDescription || raw?.enhancedDescription || '', 320) ||
    cleanText(folderData?.description || '', 320) ||
    `Smart folder for ${cleanText(folderData?.name || 'files', 80)}`;
  return {
    improvedDescription,
    // Keep backward compatibility for older callers.
    enhancedDescription: improvedDescription,
    suggestedKeywords: sanitizeStringList(raw?.suggestedKeywords, { maxItems: 10, maxLength: 32 }),
    organizationTips: cleanText(raw?.organizationTips || '', 320),
    confidence: clamp01(raw?.confidence, 0.75),
    suggestedCategory,
    semanticTags: sanitizeStringList(raw?.semanticTags, { maxItems: 8, maxLength: 32 }),
    relatedFolders
  };
}

async function enhanceSmartFolderWithLLM(folderData, existingFolders, _getTextModel) {
  try {
    logger.info('[LLM-ENHANCEMENT] Analyzing smart folder for optimization:', folderData.name);

    const safeExistingFolders = Array.isArray(existingFolders) ? existingFolders : [];
    const existingFolderContext = safeExistingFolders.map((f) => ({
      name: f.name,
      description: f.description,
      keywords: f.keywords || [],
      category: f.category || 'general'
    }));
    const existingFolderNames = existingFolderContext
      .map((f) => cleanText(f.name, 80))
      .filter(Boolean);
    const existingCategories = Array.from(
      new Set(
        existingFolderContext
          .map((f) => cleanText(f.category, 60).toLowerCase())
          .filter(Boolean)
          .concat('general')
      )
    );

    const prompt = `You are an expert file organization system.
Analyze this new smart folder and provide practical enhancements grounded ONLY in the provided data.
Do not invent company names, projects, or processes.

NEW FOLDER:
Name: "${folderData.name}"
Path: "${folderData.path}"
Description: "${folderData.description || ''}"

EXISTING FOLDERS:
${existingFolderContext.map((f) => `- ${f.name}: ${f.description} (Category: ${f.category})`).join('\n')}

ALLOWED RELATED FOLDERS (must match exactly, or use []):
${existingFolderNames.join(', ') || '(none)'}

ALLOWED CATEGORY VALUES:
${existingCategories.join(', ')}

Return ONLY valid JSON with this exact shape:
{
  "improvedDescription": "enhanced description",
  "suggestedKeywords": ["keyword1", "keyword2"],
  "organizationTips": "tips for better organization",
  "confidence": 0.8,
  "suggestedCategory": "one allowed category",
  "semanticTags": ["tag1", "tag2"],
  "relatedFolders": ["exact existing folder name"]
}`;

    try {
      const llamaService = getLlamaService();
      await llamaService.initialize();
      const result = await withAbortableTimeout(
        (abortController) =>
          llamaService.generateText({
            prompt,
            maxTokens: 500,
            temperature: 0.3,
            signal: abortController.signal
          }),
        TIMEOUTS.AI_ANALYSIS_MEDIUM,
        `Smart folder enhancement (${folderData.name || 'unnamed'})`
      );
      const parsed = extractAndParseJSON(result?.response, null);

      if (parsed && typeof parsed === 'object') {
        const enhancement = normalizeEnhancement(parsed, folderData, safeExistingFolders);
        logger.info('[LLM-ENHANCEMENT] Successfully enhanced smart folder');
        return enhancement;
      }

      logger.warn('[LLM-ENHANCEMENT] Failed to parse LLM response', {
        responseLength: result?.response?.length,
        responsePreview: result?.response?.substring?.(0, 300)
      });
      return { error: 'Invalid JSON response from LLM' };
    } catch (serviceError) {
      const isTimeout =
        serviceError?.name === 'AbortError' ||
        /timed out/i.test(String(serviceError?.message || ''));
      if (isTimeout) {
        logger.warn('[LLM-ENHANCEMENT] Timed out, falling back to non-LLM enhancement path', {
          folderName: folderData?.name || null,
          timeoutMs: TIMEOUTS.AI_ANALYSIS_MEDIUM
        });
        return { error: 'LLM enhancement timed out', errorCode: 'LLM_ENHANCEMENT_TIMEOUT' };
      }
      logger.error('[LLM-ENHANCEMENT] Service error:', serviceError);
      return { error: serviceError.message || 'Service error' };
    }
  } catch (error) {
    logger.error('[LLM-ENHANCEMENT] Failed to enhance smart folder:', error.message);
    return { error: error.message };
  }
}

async function calculateFolderSimilarities(suggestedCategory, folderCategories, _getTextModel) {
  try {
    const similarities = [];
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

    // Hoist LLM init outside the loop to avoid redundant initialization per folder
    let llamaService;
    try {
      llamaService = getLlamaService();
      await llamaService.initialize();
    } catch (initError) {
      logger.warn(
        '[SEMANTIC] LLM initialization failed, using fallback for all folders:',
        initError.message
      );
      for (const folder of folderCategories) {
        pushFallback(folder);
      }
      return similarities.sort((a, b) => b.confidence - a.confidence);
    }

    const PER_CALL_TIMEOUT = TIMEOUTS.AI_ANALYSIS_SHORT;

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
        const result = await withAbortableTimeout(
          () =>
            llamaService.generateText({
              prompt,
              maxTokens: 10,
              temperature: 0.1
            }),
          PER_CALL_TIMEOUT,
          `Folder similarity (${folder.name})`
        );
        const raw = result?.response || '';
        if (raw) {
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
          logger.warn(`[SEMANTIC] Service returned empty response for folder ${folder.name}`);
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
