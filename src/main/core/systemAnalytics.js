const { createLogger } = require('../../shared/logger');

const logger = createLogger('SystemAnalytics');
const PIPELINE_WINDOW_SIZE = 200;
const PIPELINE_DEGRADE_MIN_SAMPLES = 20;
const PIPELINE_DEGRADE_FALLBACK_RATE = 0.5;
const PIPELINE_DEGRADE_ERROR_RATE = 0.25;

function createPipelineStats() {
  return {
    total: 0,
    primary: 0,
    fallback: 0,
    error: 0,
    recent: [],
    lastDegradedAt: null
  };
}

const systemAnalytics = {
  startTime: Date.now(),
  processedFiles: 0,
  successfulOperations: 0,
  failedOperations: 0,
  totalProcessingTime: 0,
  errors: [],
  llamaHealth: { status: 'unknown', lastCheck: null },
  pipeline: {
    document: createPipelineStats(),
    image: createPipelineStats(),
    embedding: createPipelineStats()
  },

  recordProcessingTime(duration) {
    this.totalProcessingTime += duration;
    this.processedFiles++;
  },

  recordSuccess() {
    this.successfulOperations++;
  },

  recordFailure(error) {
    this.failedOperations++;
    this.errors.push({
      timestamp: Date.now(),
      message: error.message || error.toString(),
      stack: error.stack
    });
    if (this.errors.length > 100) {
      this.errors = this.errors.slice(-100);
    }
  },

  recordPipelineOutcome(pipelineName, outcome, details = {}) {
    if (!pipelineName || !this.pipeline[pipelineName]) return;
    const normalizedOutcome =
      outcome === 'primary' || outcome === 'fallback' || outcome === 'error' ? outcome : 'error';
    const bucket = this.pipeline[pipelineName];
    bucket.total += 1;
    bucket[normalizedOutcome] += 1;

    bucket.recent.push({
      timestamp: Date.now(),
      outcome: normalizedOutcome,
      reason: details.reason || null
    });
    if (bucket.recent.length > PIPELINE_WINDOW_SIZE) {
      bucket.recent.splice(0, bucket.recent.length - PIPELINE_WINDOW_SIZE);
    }

    const recentTotal = bucket.recent.length;
    if (recentTotal < PIPELINE_DEGRADE_MIN_SAMPLES) return;

    const recentFallback = bucket.recent.filter((entry) => entry.outcome === 'fallback').length;
    const recentError = bucket.recent.filter((entry) => entry.outcome === 'error').length;
    const fallbackRate = recentFallback / recentTotal;
    const errorRate = recentError / recentTotal;
    const degraded =
      fallbackRate >= PIPELINE_DEGRADE_FALLBACK_RATE || errorRate >= PIPELINE_DEGRADE_ERROR_RATE;

    if (!degraded) return;

    const now = Date.now();
    if (bucket.lastDegradedAt && now - bucket.lastDegradedAt < 30000) {
      return;
    }
    bucket.lastDegradedAt = now;

    logger.warn('[ANALYTICS] Pipeline degradation detected', {
      pipeline: pipelineName,
      recentTotal,
      fallbackRate: Number(fallbackRate.toFixed(3)),
      errorRate: Number(errorRate.toFixed(3))
    });
  },

  getPipelineSummary() {
    const summarize = (name) => {
      const bucket = this.pipeline[name] || createPipelineStats();
      const recentTotal = bucket.recent.length || 0;
      const recentFallback = bucket.recent.filter((entry) => entry.outcome === 'fallback').length;
      const recentError = bucket.recent.filter((entry) => entry.outcome === 'error').length;
      const recentPrimary = bucket.recent.filter((entry) => entry.outcome === 'primary').length;
      return {
        total: bucket.total,
        primary: bucket.primary,
        fallback: bucket.fallback,
        error: bucket.error,
        primaryRate: bucket.total > 0 ? bucket.primary / bucket.total : 0,
        fallbackRate: bucket.total > 0 ? bucket.fallback / bucket.total : 0,
        errorRate: bucket.total > 0 ? bucket.error / bucket.total : 0,
        recent: {
          total: recentTotal,
          primary: recentPrimary,
          fallback: recentFallback,
          error: recentError,
          primaryRate: recentTotal > 0 ? recentPrimary / recentTotal : 0,
          fallbackRate: recentTotal > 0 ? recentFallback / recentTotal : 0,
          errorRate: recentTotal > 0 ? recentError / recentTotal : 0
        },
        degraded:
          recentTotal >= PIPELINE_DEGRADE_MIN_SAMPLES &&
          (recentFallback / recentTotal >= PIPELINE_DEGRADE_FALLBACK_RATE ||
            recentError / recentTotal >= PIPELINE_DEGRADE_ERROR_RATE)
      };
    };

    return {
      document: summarize('document'),
      image: summarize('image'),
      embedding: summarize('embedding')
    };
  },

  async collectMetrics() {
    const uptime = Date.now() - this.startTime;
    const avgProcessingTime =
      this.processedFiles > 0 ? this.totalProcessingTime / this.processedFiles : 0;

    const metrics = {
      uptime,
      processedFiles: this.processedFiles,
      successfulOperations: this.successfulOperations,
      failedOperations: this.failedOperations,
      avgProcessingTime: Math.round(avgProcessingTime),
      errorRate: this.processedFiles > 0 ? (this.failedOperations / this.processedFiles) * 100 : 0,
      recentErrors: this.errors.slice(-10),
      llamaHealth: this.llamaHealth,
      pipeline: this.getPipelineSummary()
    };

    try {
      const memUsage = process.memoryUsage();
      const percentage =
        memUsage.heapTotal > 0 ? Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100) : 0;
      metrics.memory = {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        percentage
      };
    } catch (error) {
      logger.warn('Could not collect memory metrics:', error.message);
    }

    return metrics;
  },

  getFailureRate() {
    return this.processedFiles > 0 ? (this.failedOperations / this.processedFiles) * 100 : 0;
  },

  destroy() {
    this.errors = [];
    this.pipeline = {
      document: createPipelineStats(),
      image: createPipelineStats(),
      embedding: createPipelineStats()
    };
    logger.info('[ANALYTICS] System analytics cleaned up');
  }
};

module.exports = systemAnalytics;
