/**
 * Embedding gate (single source of truth)
 *
 * Decides whether embedding work should run for a file in a given stage.
 * Stages:
 * - 'analysis': during analysis/extraction (pre-move)
 * - 'final': after the file is in its final path (post-move/rename or watcher placement)
 *
 * Timing (setting):
 * - 'during_analysis' (default/backward-compatible)
 * - 'after_organize'
 * - 'manual' (never auto-embed)
 *
 * Policy:
 * - 'embed'
 * - 'skip'
 * - 'web_only' (treated as skip for local embeddings)
 */
const { container, ServiceIds } = require('../ServiceContainer');
const { createLogger } = require('../../../shared/logger');
const logger = createLogger('EmbeddingGate');

const DEFAULTS = Object.freeze({
  timing: 'during_analysis',
  policy: 'embed',
  scope: 'all_analyzed'
});

function normalizeTiming(value) {
  if (value === 'during_analysis' || value === 'after_organize' || value === 'manual') return value;
  return DEFAULTS.timing;
}

function normalizePolicy(value) {
  if (value === 'embed' || value === 'skip' || value === 'web_only') return value;
  return DEFAULTS.policy;
}

function normalizeScope(value) {
  if (value === 'all_analyzed' || value === 'smart_folders_only') return value;
  return DEFAULTS.scope;
}

async function loadEmbeddingConfigFromSettings() {
  try {
    const settingsService = container.tryResolve(ServiceIds.SETTINGS);
    if (!settingsService?.load) {
      return { timing: DEFAULTS.timing, defaultPolicy: DEFAULTS.policy, scope: DEFAULTS.scope };
    }
    const settings = await settingsService.load();
    return {
      timing: normalizeTiming(settings?.embeddingTiming),
      defaultPolicy: normalizePolicy(settings?.defaultEmbeddingPolicy),
      scope: normalizeScope(settings?.embeddingScope)
    };
  } catch (error) {
    logger.debug('[EmbeddingGate] Failed to load settings (non-fatal)', { error: error?.message });
    return { timing: DEFAULTS.timing, defaultPolicy: DEFAULTS.policy, scope: DEFAULTS.scope };
  }
}

/**
 * Compute the effective policy for a file.
 * This is intentionally minimal for now; later we’ll add folder defaults + per-file overrides.
 */
function resolveEffectivePolicy({ defaultPolicy, policyOverride }) {
  if (policyOverride != null) return normalizePolicy(policyOverride);
  return normalizePolicy(defaultPolicy);
}

/**
 * Determines whether we should run local embedding/indexing work.
 *
 * @param {Object} params
 * @param {'analysis'|'final'} params.stage
 * @param {string} [params.embeddingTiming] - optional override
 * @param {string} [params.policyOverride] - optional override
 * @param {boolean} [params.isInSmartFolder] - whether the file resides in a smart folder
 * @returns {Promise<{shouldEmbed: boolean, timing: string, policy: string, scope: string}>}
 */
async function shouldEmbed(params) {
  const { stage, embeddingTiming, policyOverride, isInSmartFolder } = params || {};
  const config = await loadEmbeddingConfigFromSettings();
  const timing = normalizeTiming(embeddingTiming || config.timing);
  const scope = normalizeScope(config.scope);
  const policy = resolveEffectivePolicy({
    defaultPolicy: config.defaultPolicy || DEFAULTS.policy,
    policyOverride
  });

  // Policy gate
  if (policy !== 'embed') {
    return { shouldEmbed: false, timing, policy, scope };
  }

  // Scope gate: when set to 'smart_folders_only', skip files outside smart folders.
  // Only apply when the caller provides explicit smart-folder context (isInSmartFolder !== undefined).
  if (scope === 'smart_folders_only' && isInSmartFolder === false) {
    return { shouldEmbed: false, timing, policy, scope };
  }

  // Timing gate
  if (timing === 'manual') {
    return { shouldEmbed: false, timing, policy, scope };
  }

  if (stage === 'analysis') {
    return { shouldEmbed: timing === 'during_analysis', timing, policy, scope };
  }

  if (stage === 'final') {
    // If timing is 'during_analysis', we assume it was handled during analysis (or path update handles the move).
    // Only embed at final stage if timing is explicitly 'after_organize'.
    return { shouldEmbed: timing === 'after_organize', timing, policy, scope };
  }

  // Unknown stage: fail closed
  return { shouldEmbed: false, timing, policy, scope };
}

module.exports = {
  shouldEmbed,
  normalizeTiming,
  normalizePolicy,
  normalizeScope
};
