/**
 * LLM Suggester
 *
 * LLM-powered organization suggestions.
 * Extracted from OrganizationSuggestionService for better maintainability.
 *
 * @module services/organization/llmSuggester
 */

const { createLogger } = require('../../../shared/logger');
const { TIMEOUTS } = require('../../../shared/performanceConstants');
const { withAbortableTimeout } = require('../../../shared/promiseUtils');
const { AI_DEFAULTS } = require('../../../shared/constants');
const { getInstance: getLlamaService } = require('../LlamaService');
const { globalDeduplicator } = require('../../utils/llmOptimization');
const { extractAndParseJSON } = require('../../utils/jsonRepair');
const { attemptJsonRepairWithLlama } = require('../../utils/llmJsonRepair');

const logger = createLogger('Organization:LLMSuggester');
// Security limits
const MAX_RESPONSE_SIZE = 1024 * 1024; // 1MB
const LLM_SUGGESTIONS_SCHEMA = {
  suggestions: [
    {
      folder: 'folder name',
      reasoning: 'why this makes sense',
      confidence: 0.0,
      strategy: 'organization principle used'
    }
  ]
};

function normalizeFolderKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function resolveConfiguredSmartFolder(folderName, smartFolders = []) {
  if (!folderName || !Array.isArray(smartFolders) || smartFolders.length === 0) return null;
  const candidate = String(folderName).trim();
  if (!candidate) return null;
  const lowerCandidate = candidate.toLowerCase();

  const exact = smartFolders.find(
    (f) => f && typeof f.name === 'string' && f.name.toLowerCase() === lowerCandidate
  );
  if (exact) return exact;

  const normalizedCandidate = normalizeFolderKey(candidate);
  return (
    smartFolders.find(
      (f) => f && typeof f.name === 'string' && normalizeFolderKey(f.name) === normalizedCandidate
    ) || null
  );
}

/**
 * Get LLM-powered alternative suggestions
 * @param {Object} file - File to analyze
 * @param {Array} smartFolders - Available folders
 * @param {Object} config - LLM configuration
 * @returns {Promise<Array>} LLM suggestions
 */
async function getLLMAlternativeSuggestions(file, smartFolders, config = {}) {
  try {
    const llamaService = getLlamaService();
    const model = AI_DEFAULTS.TEXT.MODEL;
    const configuredFolders = Array.isArray(smartFolders)
      ? smartFolders.filter(
          (folder) => folder && typeof folder.name === 'string' && folder.name.trim()
        )
      : [];

    if (!llamaService) {
      return [];
    }
    if (configuredFolders.length === 0) {
      return [];
    }
    await llamaService.initialize();

    const llmTemperature = config.llmTemperature || 0.7;
    const llmMaxTokens = config.llmMaxTokens || 500;

    // Limit analysis content size and avoid leaking excessive detail
    const serializedAnalysis = JSON.stringify(file.analysis || {}, null, 2).slice(0, 800);

    const allowedFoldersText = configuredFolders
      .map(
        (f, idx) =>
          `${idx + 1}. "${f.name}" - ${(f.description || 'No description provided').slice(0, 140)}`
      )
      .join('\n');
    const prompt = `Given this file analysis, suggest up to 3 alternative organization approaches:

File: ${file.name}
Type: ${file.extension}
Analysis (truncated): ${serializedAnalysis}

AVAILABLE SMART FOLDERS (ONLY valid outputs):
${allowedFoldersText}

RULES:
- Use ONLY folder names from the list above.
- Do NOT invent, rename, merge, or pluralize folder names.
- Return 1-3 UNIQUE suggestions (no duplicate folders).
- If uncertain, choose the closest folder from the list.
- Keep reasoning grounded in the provided file analysis only.

Return JSON: {
  "suggestions": [
    {
      "folder": "folder name",
      "reasoning": "why this makes sense",
      "confidence": 0.0-1.0,
      "strategy": "organization principle used"
    }
  ]
}`;

    // Use deduplication to prevent duplicate LLM calls
    const deduplicationKey = globalDeduplicator.generateKey({
      fileName: file.name,
      analysis: JSON.stringify(file.analysis || {}),
      folders: configuredFolders.map((f) => f.name).join(','),
      type: 'organization-suggestions'
    });

    const timeoutMs = TIMEOUTS.AI_ANALYSIS_LONG;
    logger.debug('[LLMSuggester] Using text model', { model, timeoutMs, file: file?.name });
    const response = await withAbortableTimeout(
      (abortController) =>
        globalDeduplicator.deduplicate(deduplicationKey, () =>
          llamaService.generateText({
            prompt,
            temperature: llmTemperature,
            maxTokens: llmMaxTokens,
            signal: abortController.signal
          })
        ),
      timeoutMs,
      'LLM organization suggestions'
    );

    // Validate response size
    const responseText = response.response || '';
    const responseSize = Buffer.byteLength(responseText, 'utf8');

    if (responseSize > MAX_RESPONSE_SIZE) {
      logger.warn('[LLMSuggester] Response exceeds maximum size limit', {
        size: responseSize,
        maxSize: MAX_RESPONSE_SIZE,
        file: file.name
      });
      return [];
    }

    // Parse JSON response with robust extraction and repair
    let parsed = extractAndParseJSON(responseText, null, {
      source: 'llmSuggester',
      fileName: file?.name,
      model
    });

    if (!parsed) {
      const repairedResponse = await attemptJsonRepairWithLlama(llamaService, responseText, {
        schema: LLM_SUGGESTIONS_SCHEMA,
        maxTokens: llmMaxTokens,
        operation: 'Organization suggestions'
      });

      if (repairedResponse) {
        parsed = extractAndParseJSON(repairedResponse, null, {
          source: 'llmSuggester.repair',
          fileName: file?.name,
          model
        });
      }
    }

    if (!parsed) {
      // One strict retry to reduce avoidable empty suggestion sets.
      const strictPrompt = `${prompt}

STRICT OUTPUT REQUIREMENT:
- Return ONLY valid JSON.
- Do NOT include markdown fences, prose, or extra tokens.
- Every "folder" value MUST exactly match one of the allowed folder names listed above.
- Use exactly this shape: {"suggestions":[{"folder":"name","reasoning":"text","confidence":0.0,"strategy":"text"}]}`;
      const strictRetryKey = globalDeduplicator.generateKey({
        fileName: file.name,
        analysis: JSON.stringify(file.analysis || {}),
        folders: configuredFolders.map((f) => f.name).join(','),
        type: 'organization-suggestions',
        retry: 'strict-json'
      });
      const strictResponse = await withAbortableTimeout(
        (abortController) =>
          globalDeduplicator.deduplicate(strictRetryKey, () =>
            llamaService.generateText({
              prompt: strictPrompt,
              temperature: 0.1,
              maxTokens: llmMaxTokens,
              signal: abortController.signal
            })
          ),
        timeoutMs,
        'LLM organization suggestions strict retry'
      );
      parsed = extractAndParseJSON(strictResponse?.response || '', null, {
        source: 'llmSuggester.strict-retry',
        fileName: file?.name,
        model
      });
    }

    if (!parsed) {
      logger.warn('[LLMSuggester] Failed to parse JSON response', {
        responseLength: responseText.length,
        responsePreview: responseText.slice(0, 500)
      });
      return [];
    }

    if (!Array.isArray(parsed.suggestions)) {
      logger.warn('[LLMSuggester] Response missing suggestions array');
      return [];
    }

    const seenFolderNames = new Set();
    return parsed.suggestions
      .filter((s) => {
        if (!s || typeof s !== 'object') {
          logger.warn('[LLMSuggester] Skipping suggestion with invalid shape');
          return false;
        }
        // Ensure folder is a valid string
        if (typeof s.folder !== 'string' || !s.folder.trim()) {
          logger.warn('[LLMSuggester] Skipping suggestion with invalid folder', {
            folder: s.folder,
            type: typeof s.folder
          });
          return false;
        }
        return true;
      })
      .map((s) => {
        const resolvedFolder = resolveConfiguredSmartFolder(s.folder, configuredFolders);
        if (!resolvedFolder) {
          logger.warn('[LLMSuggester] Dropping hallucinated/non-configured folder suggestion', {
            folder: s.folder,
            file: file?.name
          });
          return null;
        }
        const dedupeKey = String(resolvedFolder.name || '').toLowerCase();
        if (seenFolderNames.has(dedupeKey)) {
          return null;
        }
        seenFolderNames.add(dedupeKey);

        const rawConf = Number.isFinite(s.confidence) ? s.confidence : Number(s.confidence);
        const normalizedRawConf = Number.isFinite(rawConf) ? rawConf : 0.5;
        const reasoning = typeof s.reasoning === 'string' ? s.reasoning.trim() : '';
        const strategy = typeof s.strategy === 'string' ? s.strategy.trim() : '';
        const normalizedConf = normalizedRawConf > 1 ? normalizedRawConf / 100 : normalizedRawConf;
        const clampedConf = Math.max(0, Math.min(1, normalizedConf));
        return {
          folder: resolvedFolder.name,
          path: resolvedFolder.path,
          folderId: resolvedFolder.id,
          isSmartFolder: true,
          score: clampedConf,
          confidence: clampedConf,
          reasoning,
          strategy,
          method: 'llm_creative'
        };
      })
      .filter(Boolean);
  } catch (error) {
    logger.warn('[LLMSuggester] LLM suggestions failed:', error.message);
    return [];
  }
}

module.exports = {
  getLLMAlternativeSuggestions,
  MAX_RESPONSE_SIZE
};
