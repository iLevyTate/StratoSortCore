/**
 * Test Utilities for Performance, Stress, and Integration Tests
 *
 * Provides helper functions for:
 * - File generation
 * - Service failure simulation
 * - Memory measurement
 * - Async condition waiting
 * - Mock data generation
 */

const crypto = require('crypto');

/**
 * Generate dummy files in memory (for testing without actual file system)
 * @param {number} count - Number of files to generate
 * @param {Object} options - Generation options
 * @returns {Array<Object>} Array of file objects
 */
function generateDummyFiles(count, options = {}) {
  const {
    extensions = ['.pdf', '.docx', '.txt', '.jpg', '.png'],
    includeAnalysis = true,
    includeEmbedding = false,
    embeddingDimensions = 1024
  } = options;

  const files = [];
  const categories = [
    'Financial',
    'Legal',
    'Project',
    'Personal',
    'Technical',
    'Medical',
    'Marketing'
  ];

  for (let i = 0; i < count; i++) {
    const ext = extensions[i % extensions.length];
    const category = categories[i % categories.length];
    const fileName = `test_file_${i}_${crypto.randomBytes(4).toString('hex')}${ext}`;

    const file = {
      id: `file:${i}`,
      name: fileName,
      path: `/test/files/${category.toLowerCase()}/${fileName}`,
      extension: ext,
      size: Math.floor(Math.random() * 1000000) + 1000, // 1KB - 1MB
      mtime: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000) // Last 30 days
    };

    if (includeAnalysis) {
      file.analysis = {
        category,
        purpose: `Test ${category.toLowerCase()} document ${i}`,
        keywords: [`keyword${i}`, category.toLowerCase(), 'test'],
        confidence: 0.7 + Math.random() * 0.3,
        suggestedFolder: `${category}/Documents`
      };
    }

    if (includeEmbedding) {
      file.vector = generateRandomVector(embeddingDimensions);
    }

    files.push(file);
  }

  return files;
}

/**
 * Generate a random embedding vector
 * @param {number} dimensions - Vector dimensions
 * @returns {Array<number>} Random vector normalized to unit length
 */
function generateRandomVector(dimensions = 1024) {
  const vector = [];
  let sumSquares = 0;

  for (let i = 0; i < dimensions; i++) {
    const value = Math.random() * 2 - 1; // -1 to 1
    vector.push(value);
    sumSquares += value * value;
  }

  // Normalize to unit length (for cosine similarity)
  const magnitude = Math.sqrt(sumSquares);
  return vector.map((v) => v / magnitude);
}

/**
 * Generate dummy folders with embeddings
 * @param {number} count - Number of folders to generate
 * @param {Object} options - Generation options
 * @returns {Array<Object>} Array of folder objects
 */
function generateDummyFolders(count, options = {}) {
  const { includeEmbedding = true, embeddingDimensions = 1024 } = options;

  const folderTypes = [
    'Documents',
    'Images',
    'Reports',
    'Contracts',
    'Invoices',
    'Receipts',
    'Projects'
  ];
  const folders = [];

  for (let i = 0; i < count; i++) {
    const type = folderTypes[i % folderTypes.length];
    const folder = {
      id: `folder:${type.toLowerCase()}_${i}`,
      name: `${type} ${i}`,
      path: `/smart-folders/${type.toLowerCase()}_${i}`,
      description: `Smart folder for ${type.toLowerCase()} - instance ${i}`,
      model: 'mxbai-embed-large',
      updatedAt: new Date().toISOString()
    };

    if (includeEmbedding) {
      folder.vector = generateRandomVector(embeddingDimensions);
    }

    folders.push(folder);
  }

  return folders;
}

/**
 * Create a mock service that can simulate failures
 * @param {string} serviceName - Name of the service for logging
 * @param {Object} methods - Object of method names to mock implementations
 * @returns {Object} Mock service with failure simulation capabilities
 */
function createMockService(serviceName, methods = {}) {
  const eventListeners = new Map();

  const service = {
    _failureMode: false,
    _failureError: null,
    _failureDuration: 0,
    _failureStart: null,
    _callCounts: {},
    _callHistory: [],
    _eventListeners: eventListeners,

    // Event emitter methods
    on(event, callback) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, []);
      }
      eventListeners.get(event).push(callback);
      return this;
    },

    off(event, callback) {
      if (eventListeners.has(event)) {
        const callbacks = eventListeners.get(event);
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
      return this;
    },

    emit(event, data) {
      if (eventListeners.has(event)) {
        for (const callback of eventListeners.get(event)) {
          try {
            callback(data);
          } catch (e) {
            // Ignore callback errors in tests
          }
        }
      }
      return this;
    },

    // Enable failure mode
    simulateFailure(duration = 0, error = null) {
      this._failureMode = true;
      this._failureDuration = duration;
      this._failureError = error || new Error(`${serviceName} is unavailable`);
      this._failureStart = Date.now();
    },

    // Disable failure mode
    recover() {
      this._failureMode = false;
      this._failureError = null;
      this._failureDuration = 0;
      this._failureStart = null;
    },

    // Check if currently failing
    isFailureActive() {
      if (!this._failureMode) return false;
      if (this._failureDuration === 0) return true;
      return Date.now() - this._failureStart < this._failureDuration;
    },

    // Get call statistics
    getCallStats() {
      return {
        counts: { ...this._callCounts },
        history: [...this._callHistory]
      };
    },

    // Reset statistics
    resetStats() {
      this._callCounts = {};
      this._callHistory = [];
    }
  };

  // Wrap each method with failure checking and call tracking
  for (const [methodName, implementation] of Object.entries(methods)) {
    service[methodName] = async function (...args) {
      // Track call
      this._callCounts[methodName] = (this._callCounts[methodName] || 0) + 1;
      this._callHistory.push({
        method: methodName,
        args,
        timestamp: Date.now()
      });

      // Check for active failure
      if (this.isFailureActive()) {
        throw this._failureError;
      }

      // Call actual implementation
      return implementation.apply(this, args);
    };
  }

  return service;
}

/**
 * Mock ChromaDB service with failure simulation
 * @returns {Object} Mock ChromaDB service
 */
function createMockChromaDBService() {
  const files = new Map();
  const folders = new Map();

  const service = createMockService('ChromaDB', {
    async initialize() {
      return true;
    },

    async upsertFile(file) {
      files.set(file.id, file);
      return { success: true };
    },

    async upsertFolder(folder) {
      folders.set(folder.id, folder);
      return { success: true };
    },

    async batchUpsertFiles(fileList) {
      for (const file of fileList) {
        files.set(file.id, file);
      }
      return fileList.length;
    },

    async batchUpsertFolders(folderList) {
      for (const folder of folderList) {
        folders.set(folder.id, folder);
      }
      return { count: folderList.length, skipped: [] };
    },

    async queryFolders(fileId, topK = 5) {
      const results = [];
      let count = 0;
      for (const folder of folders.values()) {
        if (count >= topK) break;
        results.push({
          folderId: folder.id,
          name: folder.name,
          score: 0.9 - count * 0.1
        });
        count++;
      }
      return results;
    },

    async deleteFileEmbedding(fileId) {
      return files.delete(fileId);
    },

    async getStats() {
      return {
        files: files.size,
        folders: folders.size
      };
    },

    async checkHealth() {
      return true;
    }
  });

  // Define isOnline as a getter after createMockService (getters can't be passed via Object.entries)
  Object.defineProperty(service, 'isOnline', {
    get() {
      return !this.isFailureActive();
    },
    enumerable: true,
    configurable: true
  });

  return service;
}

/**
 * Measure current memory usage
 * @returns {Object} Memory usage statistics
 */
function measureMemory() {
  const usage = process.memoryUsage();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
    rss: usage.rss,
    heapUsedMB: Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
    rssMB: Math.round((usage.rss / 1024 / 1024) * 100) / 100
  };
}

/**
 * Force garbage collection if available (requires --expose-gc flag)
 */
function forceGC() {
  if (global.gc) {
    global.gc();
    return true;
  }
  return false;
}

/**
 * Simple delay helper
 * @param {number} ms - Milliseconds to delay
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a timer for measuring execution time
 * @returns {Function} Function that returns elapsed time in ms
 */
function createTimer() {
  const start = process.hrtime.bigint();
  return () => {
    const end = process.hrtime.bigint();
    return Number(end - start) / 1_000_000; // Convert to milliseconds
  };
}

/**
 * Track resource usage over time
 * @returns {Object} Resource tracker with start, checkpoint, and end methods
 */
function createResourceTracker() {
  const startMemory = measureMemory();
  const startTime = process.hrtime.bigint();
  const checkpoints = [];

  return {
    checkpoint(label = '') {
      checkpoints.push({
        label,
        time: Number(process.hrtime.bigint() - startTime) / 1_000_000,
        memory: measureMemory()
      });
    },

    getResults() {
      const endMemory = measureMemory();
      const endTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      return {
        totalTimeMs: endTime,
        memoryDelta: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          heapUsedMB: endMemory.heapUsedMB - startMemory.heapUsedMB,
          heapTotal: endMemory.heapTotal - startMemory.heapTotal
        },
        startMemory,
        endMemory,
        checkpoints
      };
    }
  };
}

/**
 * Generate queue items for stress testing
 * @param {number} count - Number of items to generate
 * @param {Object} options - Generation options
 * @returns {Array<Object>} Array of queue items
 */
function generateQueueItems(count, options = {}) {
  const { type = 'file', includeVector = true, vectorDimensions = 1024 } = options;

  const items = [];

  for (let i = 0; i < count; i++) {
    const item = {
      id: `${type}:item_${i}_${Date.now()}`,
      model: 'mxbai-embed-large',
      updatedAt: new Date().toISOString(),
      meta: {
        name: `item_${i}.pdf`,
        path: `/test/items/item_${i}.pdf`
      }
    };

    if (includeVector) {
      item.vector = generateRandomVector(vectorDimensions);
    }

    items.push(item);
  }

  return items;
}

/**
 * Run operation multiple times and return performance statistics
 * @param {Function} operation - Operation to benchmark
 * @param {Object} options - Benchmark options
 * @returns {Promise<Object>} Performance statistics
 */
async function benchmark(operation, options = {}) {
  const { iterations = 10, warmupIterations = 2, name = 'operation' } = options;

  // Warmup
  for (let i = 0; i < warmupIterations; i++) {
    await operation();
  }

  const times = [];

  for (let i = 0; i < iterations; i++) {
    const timer = createTimer();
    await operation();
    times.push(timer());
  }

  times.sort((a, b) => a - b);

  const sum = times.reduce((a, b) => a + b, 0);
  const avg = sum / times.length;
  const min = times[0];
  const max = times[times.length - 1];
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];

  return {
    name,
    iterations,
    avgMs: Math.round(avg * 100) / 100,
    minMs: Math.round(min * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    medianMs: Math.round(median * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    totalMs: Math.round(sum * 100) / 100,
    timesMs: times.map((t) => Math.round(t * 100) / 100)
  };
}

module.exports = {
  // File generation
  generateDummyFiles,
  generateDummyFolders,
  generateRandomVector,
  generateQueueItems,

  // Mock services
  createMockService,
  createMockChromaDBService,

  // Memory utilities
  measureMemory,
  forceGC,
  createResourceTracker,

  // Timing utilities
  delay,
  createTimer,
  benchmark
};
