/**
 * Analysis limits from user settings
 * Single source of truth for file size and processing limits used by the analysis pipeline
 * @module analysis/analysisLimits
 */

const { createLogger } = require('../../shared/logger');
const { getConfigurableLimits } = require('../../shared/settingsValidation');
const { DEFAULT_SETTINGS } = require('../../shared/defaultSettings');
const { LIMITS } = require('../../shared/constants');

const logger = createLogger('AnalysisLimits');

const CACHE_TTL_MS = 5000; // 5 seconds - avoid loading settings on every file
let cachedLimits = null;
let cacheTimestamp = 0;

/**
 * Get analysis limits from settings (with caching)
 * @returns {Promise<{maxFileSize: number, maxImageFileSize: number, maxDocumentFileSize: number}>}
 */
async function getAnalysisLimits() {
  const now = Date.now();
  if (cachedLimits && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedLimits;
  }
  try {
    const SettingsService = require('../services/SettingsService');
    const service = SettingsService.getInstance();
    if (!service?.load) {
      return getDefaultLimits();
    }
    const settings = await service.load();
    const { fileSizeLimits } = getConfigurableLimits(settings);
    const rawMaxFileSize = Number(fileSizeLimits?.maxFileSize);
    const rawMaxImageFileSize = Number(fileSizeLimits?.maxImageFileSize);
    const rawMaxDocumentFileSize = Number(fileSizeLimits?.maxDocumentFileSize);
    cachedLimits = {
      maxFileSize:
        Number.isFinite(rawMaxFileSize) && rawMaxFileSize > 0
          ? rawMaxFileSize
          : DEFAULT_SETTINGS.maxFileSize,
      maxImageFileSize:
        Number.isFinite(rawMaxImageFileSize) && rawMaxImageFileSize > 0
          ? rawMaxImageFileSize
          : DEFAULT_SETTINGS.maxImageFileSize,
      maxDocumentFileSize:
        Number.isFinite(rawMaxDocumentFileSize) && rawMaxDocumentFileSize > 0
          ? rawMaxDocumentFileSize
          : DEFAULT_SETTINGS.maxDocumentFileSize
    };
    cacheTimestamp = now;
    return cachedLimits;
  } catch (error) {
    logger.debug('[AnalysisLimits] Failed to load from settings, using defaults:', error?.message);
    return getDefaultLimits();
  }
}

/**
 * Default limits when settings unavailable
 * @returns {{maxFileSize: number, maxImageFileSize: number, maxDocumentFileSize: number}}
 */
function getDefaultLimits() {
  return {
    maxFileSize: LIMITS?.MAX_FILE_SIZE ?? DEFAULT_SETTINGS.maxFileSize,
    maxImageFileSize: DEFAULT_SETTINGS.maxImageFileSize,
    maxDocumentFileSize: DEFAULT_SETTINGS.maxDocumentFileSize
  };
}

/**
 * Invalidate cache (call when settings are saved externally)
 */
function invalidateCache() {
  cachedLimits = null;
  cacheTimestamp = 0;
}

module.exports = {
  getAnalysisLimits,
  getDefaultLimits,
  invalidateCache
};
