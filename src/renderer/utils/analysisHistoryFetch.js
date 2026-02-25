import { createLogger } from '../../shared/logger';

const logger = createLogger('AnalysisHistoryFetch');

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_ENTRIES = 50000;
const MAX_PAGE_SIZE = 1000;

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export async function fetchAnalysisHistoryPages(options = {}) {
  const getHistory = window?.electronAPI?.analysisHistory?.get;
  if (typeof getHistory !== 'function') return [];

  const pageSize = Math.min(MAX_PAGE_SIZE, toPositiveInt(options.pageSize, DEFAULT_PAGE_SIZE));
  const maxEntries = Math.max(pageSize, toPositiveInt(options.maxEntries, DEFAULT_MAX_ENTRIES));

  const allEntries = [];
  let offset = 0;

  while (offset < maxEntries) {
    let page;
    try {
      page = await getHistory({ limit: pageSize, offset });
    } catch (error) {
      logger.warn('Failed to fetch analysis history page', {
        offset,
        pageSize,
        error: error?.message
      });
      break;
    }

    if (!Array.isArray(page)) {
      logger.warn('History page payload is invalid; stopping pagination', {
        offset,
        pageSize,
        payloadType: typeof page
      });
      break;
    }

    if (page.length === 0) {
      break;
    }

    allEntries.push(...page);
    offset += page.length;

    if (page.length < pageSize) {
      break;
    }
  }

  return allEntries.slice(0, maxEntries);
}
