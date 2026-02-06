const { PerformanceMetrics } = require('../src/main/services/PerformanceMetrics');

describe('PerformanceMetrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('records embeddings and updates averages', () => {
    const metrics = new PerformanceMetrics();
    metrics.recordEmbedding(100, true);
    metrics.recordEmbedding(200, false);

    const snapshot = metrics.getMetrics();
    expect(snapshot.embeddings.count).toBe(2);
    expect(snapshot.embeddings.errors).toBe(1);
    expect(snapshot.embeddings.avgLatencyMs).toBe(150);
  });

  test('records text generation tokens per second', () => {
    const metrics = new PerformanceMetrics();
    metrics.recordTextGeneration(1000, 200, true);
    const snapshot = metrics.getMetrics();
    expect(snapshot.textGeneration.avgTokensPerSecond).toBe(200);
  });

  test('records model load by type', () => {
    const metrics = new PerformanceMetrics();
    metrics.recordModelLoad('text', 500);
    metrics.recordModelLoad('text', 300);

    const snapshot = metrics.getMetrics();
    expect(snapshot.modelLoads.count).toBe(2);
    expect(snapshot.modelLoads.byType.text.count).toBe(2);
    expect(snapshot.modelLoads.byType.text.totalMs).toBe(800);
  });

  test('getHealthScore penalizes errors and latency', () => {
    const metrics = new PerformanceMetrics();
    metrics.recordEmbedding(200, false);
    metrics.recordEmbedding(200, false);
    const score = metrics.getHealthScore();
    expect(score).toBeLessThan(100);
  });

  test('reset clears metrics', () => {
    const metrics = new PerformanceMetrics();
    metrics.recordVectorSearch(50, true);
    metrics.reset();
    const snapshot = metrics.getMetrics();
    expect(snapshot.vectorSearch.count).toBe(0);
  });
});
