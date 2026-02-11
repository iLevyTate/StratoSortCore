import { requireElectronAPI } from './electronApi';

const EMBEDDINGS_STATS_CACHE_MS = 15000;
let cachedStats = null;
let cacheExpiresAt = 0;
let inFlightStatsPromise = null;
let latestStatsRequestId = 0;
let latestAppliedStatsRequestId = 0;

function shouldUseCachedStats() {
  return cachedStats !== null && Date.now() < cacheExpiresAt;
}

export const embeddingsIpc = {
  getStats(options = undefined) {
    return requireElectronAPI().embeddings.getStats(options);
  },
  async getStatsCached({ forceRefresh = false } = {}) {
    if (!forceRefresh && shouldUseCachedStats()) {
      return cachedStats;
    }
    if (!forceRefresh && inFlightStatsPromise) {
      return inFlightStatsPromise;
    }

    const requestId = ++latestStatsRequestId;
    const statsOptions = forceRefresh ? { forceRefresh: true } : undefined;
    const request = requireElectronAPI()
      .embeddings.getStats(statsOptions)
      .then((result) => {
        // Prevent older, slower responses from overwriting newer cache values.
        if (requestId > latestAppliedStatsRequestId) {
          latestAppliedStatsRequestId = requestId;
          cachedStats = result;
          cacheExpiresAt = Date.now() + EMBEDDINGS_STATS_CACHE_MS;
        }
        return result;
      })
      .finally(() => {
        if (inFlightStatsPromise === request) {
          inFlightStatsPromise = null;
        }
      });

    inFlightStatsPromise = request;
    return request;
  },
  invalidateStatsCache() {
    cachedStats = null;
    cacheExpiresAt = 0;
    inFlightStatsPromise = null;
    // Prevent older pending responses from repopulating cache after invalidation.
    latestAppliedStatsRequestId = latestStatsRequestId;
  },
  rebuildFiles() {
    embeddingsIpc.invalidateStatsCache();
    return requireElectronAPI().embeddings.rebuildFiles();
  }
};
