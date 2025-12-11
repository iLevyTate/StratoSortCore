/**
 * Performance Tests for Batch Operations
 *
 * Tests batch file analysis, memory usage, and processing time scaling
 * for various file counts (100, 500, 1000).
 */

const {
  generateDummyFiles,
  generateDummyFolders,
  generateQueueItems,
  createMockChromaDBService,
  measureMemory,
  forceGC,
  createTimer,
  createResourceTracker,
  delay,
  benchmark
} = require('../utils/testUtilities');

// Mock logger to reduce noise
jest.mock('../../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/test-app')
  }
}));

describe('Batch Operations Performance', () => {
  let mockChromaDB;

  beforeEach(() => {
    jest.clearAllMocks();
    mockChromaDB = createMockChromaDBService();
    forceGC();
  });

  afterEach(() => {
    forceGC();
  });

  describe('Batch File Analysis Performance', () => {
    const fileCounts = [100, 500, 1000];

    fileCounts.forEach((count) => {
      it(`should process ${count} files within reasonable time`, async () => {
        const files = generateDummyFiles(count, {
          includeAnalysis: true,
          includeEmbedding: true
        });

        const tracker = createResourceTracker();
        const timer = createTimer();

        // Simulate batch processing
        const batchSize = 50;
        let processed = 0;

        for (let i = 0; i < files.length; i += batchSize) {
          const batch = files.slice(i, i + batchSize);
          await mockChromaDB.batchUpsertFiles(batch);
          processed += batch.length;
          tracker.checkpoint(`batch_${Math.floor(i / batchSize)}`);
        }

        const elapsedMs = timer();
        const results = tracker.getResults();

        // Performance assertions
        // Allow 1ms per file as baseline (100 files = 100ms, 1000 files = 1000ms)
        const maxExpectedTime = count * 1;
        expect(elapsedMs).toBeLessThan(maxExpectedTime);

        // Verify all files processed
        expect(processed).toBe(count);

        // Log performance metrics
        console.log(`[PERF] ${count} files processed in ${elapsedMs.toFixed(2)}ms`);
        console.log(`[PERF] Throughput: ${(count / (elapsedMs / 1000)).toFixed(2)} files/sec`);
        console.log(`[PERF] Memory delta: ${results.memoryDelta.heapUsedMB}MB`);
      }, 30000); // 30 second timeout for larger tests
    });

    it('should scale linearly with file count', async () => {
      const results = [];

      for (const count of [100, 200, 400]) {
        const files = generateDummyFiles(count, { includeEmbedding: true });

        const timer = createTimer();
        await mockChromaDB.batchUpsertFiles(files);
        const elapsed = timer();

        results.push({ count, elapsed });
      }

      // Check that doubling files roughly doubles time (with tolerance)
      const ratio1 = results[1].elapsed / results[0].elapsed;
      const ratio2 = results[2].elapsed / results[1].elapsed;

      // Allow for some variance, but should be roughly linear (1.5x - 3x for 2x files)
      expect(ratio1).toBeGreaterThan(1);
      expect(ratio1).toBeLessThan(4);
      expect(ratio2).toBeGreaterThan(1);
      expect(ratio2).toBeLessThan(4);

      console.log('[PERF] Scaling ratios:', { ratio1, ratio2 });
    });
  });

  describe('Memory Usage During Batch Processing', () => {
    it('should maintain stable memory with repeated batch operations', async () => {
      const iterations = 5;
      const filesPerBatch = 100;
      const memorySnapshots = [];

      forceGC();
      await delay(50);
      const baseline = measureMemory();
      memorySnapshots.push({ iteration: 0, ...baseline });

      for (let i = 1; i <= iterations; i++) {
        const files = generateDummyFiles(filesPerBatch, {
          includeEmbedding: true
        });
        await mockChromaDB.batchUpsertFiles(files);

        forceGC();
        await delay(50);

        const snapshot = measureMemory();
        memorySnapshots.push({ iteration: i, ...snapshot });
      }

      // Memory should not grow unbounded
      const finalMemory = memorySnapshots[memorySnapshots.length - 1];
      const memoryGrowth = finalMemory.heapUsedMB - baseline.heapUsedMB;

      // Allow up to 50MB growth for 500 file operations
      expect(memoryGrowth).toBeLessThan(50);

      console.log(
        '[PERF] Memory snapshots:',
        memorySnapshots.map((s) => `Iter ${s.iteration}: ${s.heapUsedMB}MB`)
      );
      console.log(`[PERF] Total memory growth: ${memoryGrowth.toFixed(2)}MB`);
    });

    it('should return to near-baseline memory after batch completion', async () => {
      forceGC();
      await delay(100);
      const baseline = measureMemory();

      // Create large batch
      const files = generateDummyFiles(500, { includeEmbedding: true });
      await mockChromaDB.batchUpsertFiles(files);

      // Clear references
      files.length = 0;

      forceGC();
      await delay(100);

      const afterCleanup = measureMemory();
      const memoryDelta = afterCleanup.heapUsedMB - baseline.heapUsedMB;

      // Memory should return to within 20MB of baseline
      expect(memoryDelta).toBeLessThan(20);

      console.log(`[PERF] Baseline: ${baseline.heapUsedMB}MB`);
      console.log(`[PERF] After cleanup: ${afterCleanup.heapUsedMB}MB`);
      console.log(`[PERF] Delta: ${memoryDelta.toFixed(2)}MB`);
    });
  });

  describe('Folder Operations Performance', () => {
    it('should batch upsert folders efficiently', async () => {
      const folders = generateDummyFolders(100);

      const benchmarkResult = await benchmark(
        async () => {
          await mockChromaDB.batchUpsertFolders(folders);
        },
        { iterations: 5, warmupIterations: 1, name: 'batchUpsertFolders' }
      );

      expect(benchmarkResult.avgMs).toBeLessThan(100);

      console.log('[PERF] Folder batch upsert:', benchmarkResult);
    });

    it('should query folders efficiently', async () => {
      // Setup folders
      const folders = generateDummyFolders(50);
      await mockChromaDB.batchUpsertFolders(folders);

      // Benchmark queries
      const benchmarkResult = await benchmark(
        async () => {
          await mockChromaDB.queryFolders('file:test_0', 5);
        },
        { iterations: 20, warmupIterations: 5, name: 'queryFolders' }
      );

      // Query should be fast
      expect(benchmarkResult.avgMs).toBeLessThan(50);
      expect(benchmarkResult.p95Ms).toBeLessThan(100);

      console.log('[PERF] Folder query:', benchmarkResult);
    });
  });

  describe('Concurrent Operations Performance', () => {
    it('should handle concurrent batch operations', async () => {
      const concurrentBatches = 10;
      const filesPerBatch = 50;

      const batches = Array(concurrentBatches)
        .fill(null)
        .map(() => generateDummyFiles(filesPerBatch, { includeEmbedding: true }));

      const timer = createTimer();

      // Run all batches concurrently
      await Promise.all(batches.map((batch) => mockChromaDB.batchUpsertFiles(batch)));

      const elapsed = timer();
      const totalFiles = concurrentBatches * filesPerBatch;

      console.log(
        `[PERF] ${concurrentBatches} concurrent batches (${totalFiles} total files) in ${elapsed.toFixed(2)}ms`
      );
      console.log(`[PERF] Throughput: ${(totalFiles / (elapsed / 1000)).toFixed(2)} files/sec`);

      // Should complete within reasonable time
      expect(elapsed).toBeLessThan(5000);
    });

    it('should handle mixed read/write operations', async () => {
      // Setup initial data
      const folders = generateDummyFolders(20);
      await mockChromaDB.batchUpsertFolders(folders);

      const files = generateDummyFiles(100, { includeEmbedding: true });
      await mockChromaDB.batchUpsertFiles(files);

      const timer = createTimer();
      const operations = [];

      // Mix of writes and reads
      for (let i = 0; i < 50; i++) {
        if (i % 3 === 0) {
          // Write operation
          const newFiles = generateDummyFiles(10, { includeEmbedding: true });
          operations.push(mockChromaDB.batchUpsertFiles(newFiles));
        } else {
          // Read operation
          operations.push(mockChromaDB.queryFolders(`file:test_${i}`, 5));
        }
      }

      await Promise.all(operations);
      const elapsed = timer();

      console.log(`[PERF] 50 mixed operations in ${elapsed.toFixed(2)}ms`);
      expect(elapsed).toBeLessThan(2000);
    });
  });

  describe('Processing Time Benchmarks', () => {
    it('should meet throughput targets for file processing', async () => {
      const TARGET_THROUGHPUT = 500; // files per second minimum

      const files = generateDummyFiles(500, { includeEmbedding: true });
      const timer = createTimer();

      await mockChromaDB.batchUpsertFiles(files);

      const elapsed = timer();
      const throughput = files.length / (elapsed / 1000);

      expect(throughput).toBeGreaterThan(TARGET_THROUGHPUT);

      console.log(
        `[PERF] Throughput: ${throughput.toFixed(2)} files/sec (target: ${TARGET_THROUGHPUT})`
      );
    });

    it('should have low latency for individual operations', async () => {
      const MAX_LATENCY_MS = 10;

      const benchmarkResult = await benchmark(
        async () => {
          const file = generateDummyFiles(1, { includeEmbedding: true })[0];
          await mockChromaDB.upsertFile(file);
        },
        { iterations: 50, warmupIterations: 10, name: 'singleUpsert' }
      );

      expect(benchmarkResult.avgMs).toBeLessThan(MAX_LATENCY_MS);
      expect(benchmarkResult.p95Ms).toBeLessThan(MAX_LATENCY_MS * 2);

      console.log('[PERF] Single upsert latency:', benchmarkResult);
    });
  });

  describe('Large Dataset Performance', () => {
    it('should handle 1000 file batch without degradation', async () => {
      const files = generateDummyFiles(1000, { includeEmbedding: true });

      const tracker = createResourceTracker();

      // Process in chunks to simulate real-world batching
      const chunkSize = 100;
      for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = files.slice(i, i + chunkSize);
        await mockChromaDB.batchUpsertFiles(chunk);
        tracker.checkpoint(`chunk_${i / chunkSize}`);
      }

      const results = tracker.getResults();

      // Check that later chunks don't take significantly longer than earlier ones
      const checkpointTimes = results.checkpoints.map((cp, i, arr) => {
        if (i === 0) return cp.time;
        return cp.time - arr[i - 1].time;
      });

      const firstHalfAvg = checkpointTimes.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
      const secondHalfAvg = checkpointTimes.slice(5).reduce((a, b) => a + b, 0) / 5;

      // Second half should not take more than 2x the first half
      expect(secondHalfAvg).toBeLessThan(firstHalfAvg * 2);

      console.log(
        '[PERF] Chunk times:',
        checkpointTimes.map((t) => t.toFixed(2))
      );
      console.log(`[PERF] Total time: ${results.totalTimeMs.toFixed(2)}ms`);
      console.log(`[PERF] Memory growth: ${results.memoryDelta.heapUsedMB.toFixed(2)}MB`);
    }, 60000);
  });
});

describe('Embedding Queue Performance', () => {
  describe('Queue Throughput', () => {
    it('should enqueue items at high speed', async () => {
      const queue = [];
      const items = generateQueueItems(1000);

      const timer = createTimer();

      for (const item of items) {
        queue.push(item);
      }

      const elapsed = timer();
      const throughput = items.length / (elapsed / 1000);

      expect(throughput).toBeGreaterThan(10000); // Should enqueue 10k+ items/sec

      console.log(`[PERF] Enqueue throughput: ${throughput.toFixed(0)} items/sec`);
    });

    it('should dequeue items efficiently', async () => {
      const items = generateQueueItems(1000);
      const queue = [...items];

      const timer = createTimer();

      while (queue.length > 0) {
        queue.shift();
      }

      const elapsed = timer();
      const throughput = items.length / (elapsed / 1000);

      console.log(`[PERF] Dequeue throughput: ${throughput.toFixed(0)} items/sec`);
    });
  });
});
