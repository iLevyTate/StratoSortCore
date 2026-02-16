// src/main/services/PerformanceMetrics.js

class PerformanceMetrics {
  constructor() {
    this._metrics = {
      embeddings: {
        count: 0,
        totalLatencyMs: 0,
        errors: 0,
        avgLatencyMs: 0
      },
      textGeneration: {
        count: 0,
        totalLatencyMs: 0,
        totalTokens: 0,
        errors: 0,
        avgLatencyMs: 0,
        avgTokensPerSecond: 0
      },
      vectorSearch: {
        count: 0,
        totalLatencyMs: 0,
        errors: 0,
        avgLatencyMs: 0
      },
      modelLoads: {
        count: 0,
        totalLatencyMs: 0,
        byType: {}
      },
      memory: {
        peakUsageMB: 0,
        currentUsageMB: 0
      }
    };

    // Sample memory every 30 seconds
    this._memoryInterval = setInterval(() => this._sampleMemory(), 30000);

    // Safety net: clear interval on process exit to prevent orphaned timers
    this._exitHandler = () => this.destroy();
    process.once('exit', this._exitHandler);
  }

  /**
   * Destroy the metrics collector, clearing the interval timer.
   */
  destroy() {
    if (this._memoryInterval) {
      clearInterval(this._memoryInterval);
      this._memoryInterval = null;
    }
    if (this._exitHandler) {
      process.removeListener('exit', this._exitHandler);
      this._exitHandler = null;
    }
  }

  recordEmbedding(latencyMs, success = true) {
    this._metrics.embeddings.count++;
    this._metrics.embeddings.totalLatencyMs += latencyMs;
    if (!success) this._metrics.embeddings.errors++;
    this._updateAverage('embeddings');
  }

  recordTextGeneration(latencyMs, tokenCount, success = true) {
    this._metrics.textGeneration.count++;
    this._metrics.textGeneration.totalLatencyMs += latencyMs;
    this._metrics.textGeneration.totalTokens += tokenCount;
    if (!success) this._metrics.textGeneration.errors++;
    this._updateAverage('textGeneration');

    // Calculate tokens per second
    if (this._metrics.textGeneration.totalLatencyMs > 0) {
      this._metrics.textGeneration.avgTokensPerSecond =
        (this._metrics.textGeneration.totalTokens / this._metrics.textGeneration.totalLatencyMs) *
        1000;
    }
  }

  recordVectorSearch(latencyMs, success = true) {
    this._metrics.vectorSearch.count++;
    this._metrics.vectorSearch.totalLatencyMs += latencyMs;
    if (!success) this._metrics.vectorSearch.errors++;
    this._updateAverage('vectorSearch');
  }

  recordModelLoad(modelType, latencyMs) {
    this._metrics.modelLoads.count++;
    this._metrics.modelLoads.totalLatencyMs += latencyMs;

    if (!this._metrics.modelLoads.byType[modelType]) {
      this._metrics.modelLoads.byType[modelType] = { count: 0, totalMs: 0 };
    }
    this._metrics.modelLoads.byType[modelType].count++;
    this._metrics.modelLoads.byType[modelType].totalMs += latencyMs;
  }

  _updateAverage(category) {
    const m = this._metrics[category];
    m.avgLatencyMs = m.count > 0 ? m.totalLatencyMs / m.count : 0;
  }

  _sampleMemory() {
    const used = process.memoryUsage();
    const currentMB = Math.round(used.heapUsed / 1024 / 1024);
    this._metrics.memory.currentUsageMB = currentMB;
    if (currentMB > this._metrics.memory.peakUsageMB) {
      this._metrics.memory.peakUsageMB = currentMB;
    }
  }

  getMetrics() {
    return JSON.parse(JSON.stringify(this._metrics));
  }

  getHealthScore() {
    // Calculate health score 0-100
    let score = 100;

    // Penalize high error rates
    const embeddingErrorRate =
      this._metrics.embeddings.errors / Math.max(this._metrics.embeddings.count, 1);
    score -= embeddingErrorRate * 30;

    // Penalize high latency
    if (this._metrics.embeddings.avgLatencyMs > 100) {
      score -= Math.min(20, (this._metrics.embeddings.avgLatencyMs - 100) / 10);
    }

    // Penalize high memory usage (>80% of 16GB assumed max)
    const memoryPercent = this._metrics.memory.currentUsageMB / (16 * 1024);
    if (memoryPercent > 0.8) {
      score -= (memoryPercent - 0.8) * 100;
    }

    return Math.max(0, Math.round(score));
  }

  reset() {
    this._metrics = {
      embeddings: { count: 0, totalLatencyMs: 0, errors: 0, avgLatencyMs: 0 },
      textGeneration: {
        count: 0,
        totalLatencyMs: 0,
        totalTokens: 0,
        errors: 0,
        avgLatencyMs: 0,
        avgTokensPerSecond: 0
      },
      vectorSearch: { count: 0, totalLatencyMs: 0, errors: 0, avgLatencyMs: 0 },
      modelLoads: { count: 0, totalLatencyMs: 0, byType: {} },
      memory: { peakUsageMB: 0, currentUsageMB: 0 }
    };
  }
}

// Singleton
let instance = null;
function getInstance() {
  if (!instance) {
    instance = new PerformanceMetrics();
  }
  return instance;
}

module.exports = { PerformanceMetrics, getInstance };
