# Performance Benchmarking and Optimization Guide

## Overview

This document identifies performance bottlenecks and provides guidelines for profiling and optimization.

## Identified Bottlenecks

### 1. AI Analysis Operations (CRITICAL)

#### Bottleneck: LLM Inference Time

- **Location**: `src/main/analysis/documentLlm.js`, `src/main/analysis/ollamaImageAnalysis.js`
- **Impact**: 2-10 seconds per file analysis
- **Cause**: Network calls to Ollama API, model inference time
- **User Impact**: Slow file analysis, especially in batch operations

#### Profiling Strategy

```javascript
// Add timing instrumentation
const startTime = Date.now();
const result = await ollama.generate({...});
const duration = Date.now() - startTime;
logger.performance('LLM inference', duration, {
  model: modelName,
  promptLength: prompt.length,
  responseLength: result.response.length,
});
```

#### Optimization Opportunities

1. **Caching** - Cache analysis results by file hash
2. **Batch Processing** - Process multiple files concurrently
3. **Model Selection** - Use smaller/faster models when appropriate
4. **Prompt Optimization** - Reduce prompt length
5. **Streaming** - Stream responses for better perceived performance

#### Metrics to Track

- Time per file type (PDF, DOCX, image)
- Average tokens per second
- Cache hit rate
- Concurrent request performance

### 2. File System Operations (HIGH)

#### Bottleneck: File Reading and Hashing

- **Location**: `src/main/analysis/documentExtractors.js`
- **Impact**: 0.5-5 seconds for large files
- **Cause**: Reading entire file into memory, PDF parsing
- **User Impact**: Delay before analysis starts

#### Profiling Strategy

```javascript
const fs = require('fs').promises;
const startTime = Date.now();
const stats = await fs.stat(filePath);
const readStart = Date.now();
const content = await fs.readFile(filePath);
const readDuration = Date.now() - readStart;

logger.performance('File read', readDuration, {
  size: stats.size,
  path: filePath,
  bytesPerSecond: stats.size / (readDuration / 1000),
});
```

#### Optimization Opportunities

1. **Streaming** - Use streams for large files instead of reading entire file
2. **Lazy Loading** - Only extract content when needed
3. **Parallel Processing** - Read multiple files concurrently
4. **Caching** - Cache extracted content
5. **Chunking** - Process large files in chunks

#### Metrics to Track

- Read time by file size
- Extraction time by file type
- Memory usage during extraction
- Concurrent read performance

### 3. ChromaDB Embedding Generation (HIGH)

#### Bottleneck: Embedding Calculation

- **Location**: `src/main/services/ChromaDBService.js`
- **Impact**: 1-3 seconds per embedding
- **Cause**: LLM API calls for embedding generation
- **User Impact**: Slow smart folder matching

#### Profiling Strategy

```javascript
async addFolderEmbedding(folderId, folderName, description) {
  const startTime = Date.now();
  const embedding = await this.generateEmbedding(description);
  const embeddingTime = Date.now() - startTime;

  const insertStart = Date.now();
  await this.collection.add({...});
  const insertTime = Date.now() - insertStart;

  logger.performance('ChromaDB operation', embeddingTime + insertTime, {
    embeddingTime,
    insertTime,
    descriptionLength: description.length,
  });
}
```

#### Optimization Opportunities

1. **Batch Embeddings** - Generate multiple embeddings in one call
2. **Caching** - Cache embeddings for unchanged descriptions
3. **Smaller Models** - Use smaller embedding models
4. **Lazy Generation** - Generate embeddings on-demand

#### Metrics to Track

- Embedding generation time
- Database insert time
- Search query performance
- Number of embeddings cached

### 4. React Rendering Performance (MEDIUM)

#### Bottleneck: Large List Rendering

- **Location**: `src/renderer/phases/DiscoverPhase.jsx`, `src/renderer/components/organize/OrganizationSuggestions.jsx`
- **Impact**: UI lag with >100 files
- **Cause**: Rendering large lists without virtualization
- **User Impact**: Slow UI interactions

#### Profiling Strategy

```javascript
// Use React DevTools Profiler
import { Profiler } from 'react';

<Profiler id="FileList" onRender={onRenderCallback}>
  <FileList files={files} />
</Profiler>;

function onRenderCallback(id, phase, actualDuration) {
  logger.performance('React render', actualDuration, {
    component: id,
    phase,
    itemCount: files.length,
  });
}
```

#### Optimization Opportunities

1. **Virtualization** - Use react-window for large lists
2. **Memoization** - Use React.memo for expensive components
3. **Lazy Loading** - Load items as needed
4. **Debouncing** - Debounce search/filter operations
5. **Code Splitting** - Split large components

#### Metrics to Track

- Render time by list size
- Re-render frequency
- Component mount time
- Memory usage in renderer

### 5. Database Query Performance (MEDIUM)

#### Bottleneck: Settings and History Queries

- **Location**: `src/main/services/SettingsService.js`, `src/main/services/AnalysisHistoryService.js`
- **Impact**: 100-500ms for large datasets
- **Cause**: Full table scans, no indexing
- **User Impact**: Slow settings load, slow history search

#### Profiling Strategy

```javascript
async getHistory(filter = {}) {
  const startTime = Date.now();
  const query = this.buildQuery(filter);
  const queryTime = Date.now() - startTime;

  const fetchStart = Date.now();
  const results = await this.db.all(query);
  const fetchTime = Date.now() - fetchStart;

  logger.performance('Database query', queryTime + fetchTime, {
    queryTime,
    fetchTime,
    resultCount: results.length,
    filter,
  });

  return results;
}
```

#### Optimization Opportunities

1. **Indexing** - Add indexes on frequently queried columns
2. **Pagination** - Limit results and use pagination
3. **Caching** - Cache frequently accessed data
4. **Query Optimization** - Optimize SQL queries
5. **Lazy Loading** - Load data on-demand

### 6. Memory Leaks (MEDIUM)

#### Bottleneck: Growing Memory Usage

- **Location**: Various event listeners, React components
- **Impact**: Application slowdown over time
- **Cause**: Unreleased event listeners, unclosed resources
- **User Impact**: App becomes sluggish after extended use

#### Profiling Strategy

```javascript
// Monitor memory usage
setInterval(() => {
  const usage = process.memoryUsage();
  logger.debug('Memory usage', {
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
    external: Math.round(usage.external / 1024 / 1024) + 'MB',
  });
}, 60000); // Every minute
```

#### Optimization Opportunities

1. **Cleanup** - Properly remove event listeners
2. **WeakMap/WeakSet** - Use for caches
3. **Resource Management** - Close file handles, database connections
4. **Limit Caches** - Set maximum cache sizes
5. **Periodic Cleanup** - Clear old data periodically

## Benchmarking Framework

### Setup Performance Monitoring

```javascript
// src/shared/performanceMonitor.js
class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
  }

  startOperation(operationId) {
    this.metrics.set(operationId, {
      start: Date.now(),
      memoryStart: process.memoryUsage(),
    });
  }

  endOperation(operationId, metadata = {}) {
    const metric = this.metrics.get(operationId);
    if (!metric) return;

    const duration = Date.now() - metric.start;
    const memoryEnd = process.memoryUsage();
    const memoryDelta = memoryEnd.heapUsed - metric.memoryStart.heapUsed;

    logger.performance(operationId, duration, {
      ...metadata,
      memoryDelta: Math.round(memoryDelta / 1024) + 'KB',
    });

    this.metrics.delete(operationId);
    return { duration, memoryDelta };
  }

  async measure(operationId, fn, metadata = {}) {
    this.startOperation(operationId);
    try {
      const result = await fn();
      this.endOperation(operationId, metadata);
      return result;
    } catch (error) {
      this.endOperation(operationId, { ...metadata, error: true });
      throw error;
    }
  }
}

module.exports = { PerformanceMonitor };
```

### Usage Example

```javascript
const { PerformanceMonitor } = require('../shared/performanceMonitor');
const monitor = new PerformanceMonitor();

// Measure operation
const result = await monitor.measure(
  'analyze-pdf',
  () => analyzePDF(filePath),
  { fileSize: stats.size, fileName: path.basename(filePath) },
);
```

## Benchmark Tests

### Create Performance Test Suite

```javascript
// test/benchmarks/file-analysis.benchmark.js
const { performance } = require('perf_hooks');

describe('File Analysis Performance', () => {
  it('should analyze PDF in under 5 seconds', async () => {
    const start = performance.now();
    await analyzePDF('fixtures/sample.pdf');
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(5000);
  });

  it('should handle 10 concurrent analyses', async () => {
    const files = Array(10).fill('fixtures/sample.pdf');
    const start = performance.now();

    await Promise.all(files.map((file) => analyzePDF(file)));

    const duration = performance.now() - start;
    const avgDuration = duration / files.length;

    expect(avgDuration).toBeLessThan(6000); // Allow some overhead
  });

  it('should not leak memory after 100 analyses', async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 100; i++) {
      await analyzePDF('fixtures/sample.pdf');
    }

    // Force garbage collection if available
    if (global.gc) global.gc();

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = finalMemory - initialMemory;

    // Allow max 50MB growth for 100 operations
    expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
  });
});
```

## Performance Targets

### Response Time Targets

- **File Selection**: < 100ms
- **Single File Analysis**: < 5 seconds (PDF/DOCX), < 10 seconds (images)
- **Batch Analysis (10 files)**: < 30 seconds
- **Smart Folder Creation**: < 3 seconds
- **File Organization**: < 500ms per file
- **Settings Load**: < 200ms
- **UI Interactions**: < 16ms (60 FPS)

### Resource Usage Targets

- **Memory**: < 500MB idle, < 2GB during heavy analysis
- **CPU**: < 20% idle, < 80% during analysis
- **Disk I/O**: < 50MB/s for file operations

### Scalability Targets

- Handle 1000+ files in library
- Analyze 100+ files in single batch
- Support 50+ smart folders
- Maintain <1GB database size

## Profiling Tools

### Node.js Built-in Profiler

```bash
# CPU profiling
node --prof app.js
node --prof-process isolate-*.log > processed.txt

# Heap snapshots
node --inspect app.js
# Then use Chrome DevTools
```

### Electron DevTools

- Performance tab for renderer profiling
- Memory tab for heap snapshots
- Network tab for IPC overhead

### Third-party Tools

- **clinic.js** - Comprehensive Node.js profiling
- **why-is-node-running** - Find what keeps process alive
- **memwatch-next** - Detect memory leaks
- **autocannon** - HTTP load testing (for API endpoints)

## Optimization Checklist

### Pre-optimization

- [ ] Identify bottleneck with profiling
- [ ] Establish baseline metrics
- [ ] Create benchmark tests

### Optimization

- [ ] Implement optimization
- [ ] Verify correctness (run tests)
- [ ] Measure improvement
- [ ] Check for regressions

### Post-optimization

- [ ] Document optimization
- [ ] Update benchmarks
- [ ] Add performance regression tests

## Common Pitfalls

### 1. Premature Optimization

- Profile first, optimize second
- Focus on actual bottlenecks, not theoretical ones

### 2. Over-caching

- Caches use memory
- Invalidation is complex
- Consider cache size limits

### 3. Ignoring Edge Cases

- Test with large files
- Test with many files
- Test with slow systems

### 4. Breaking Correctness

- Optimizations should not change behavior
- Run full test suite after optimization

## Continuous Monitoring

### Production Metrics

- Log slow operations automatically
- Track P95/P99 latencies
- Monitor memory usage trends
- Alert on performance regressions

### Regular Performance Reviews

- Weekly: Review performance logs
- Monthly: Run full benchmark suite
- Quarterly: Profile for new bottlenecks
