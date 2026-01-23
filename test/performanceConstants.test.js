/**
 * Tests for Performance Constants
 * Tests timing, caching, and performance-related constants
 */

describe('performanceConstants', () => {
  let constants;

  beforeEach(() => {
    jest.resetModules();
    constants = require('../src/shared/performanceConstants');
  });

  describe('TIMEOUTS', () => {
    test('defines debounce timeouts', () => {
      expect(constants.TIMEOUTS.DEBOUNCE_INPUT).toBe(300);
      expect(constants.TIMEOUTS.TOOLTIP_DELAY).toBe(500);
    });

    test('defines animation timeouts', () => {
      expect(constants.TIMEOUTS.ANIMATION_SHORT).toBe(200);
      expect(constants.TIMEOUTS.ANIMATION_MEDIUM).toBe(300);
      expect(constants.TIMEOUTS.ANIMATION_LONG).toBe(500);
    });

    test('defines file operation timeouts', () => {
      expect(constants.TIMEOUTS.FILE_READ).toBe(5000);
      expect(constants.TIMEOUTS.FILE_WRITE).toBe(10000);
      expect(constants.TIMEOUTS.FILE_COPY).toBe(30000);
    });

    test('defines AI analysis timeouts', () => {
      expect(constants.TIMEOUTS.AI_ANALYSIS_SHORT).toBe(30000);
      expect(constants.TIMEOUTS.AI_ANALYSIS_MEDIUM).toBe(60000);
      expect(constants.TIMEOUTS.AI_ANALYSIS_LONG).toBe(180000);
    });

    test('defines service timeouts', () => {
      expect(constants.TIMEOUTS.SERVICE_STARTUP).toBe(30000);
      expect(constants.TIMEOUTS.DATABASE_INIT).toBe(15000);
      expect(constants.TIMEOUTS.MODEL_LOAD).toBe(60000);
    });
  });

  describe('RETRY', () => {
    test('defines retry attempt levels', () => {
      expect(constants.RETRY.MAX_ATTEMPTS_LOW).toBe(2);
      expect(constants.RETRY.MAX_ATTEMPTS_MEDIUM).toBe(3);
      expect(constants.RETRY.MAX_ATTEMPTS_HIGH).toBe(5);
      expect(constants.RETRY.MAX_ATTEMPTS_VERY_HIGH).toBe(10);
    });

    test('defines delay settings', () => {
      expect(constants.RETRY.INITIAL_DELAY).toBe(1000);
      expect(constants.RETRY.MAX_DELAY).toBe(10000);
      expect(constants.RETRY.EXPONENTIAL_BASE).toBe(2);
    });

    test('defines operation-specific retry configs', () => {
      expect(constants.RETRY.FILE_OPERATION.maxAttempts).toBe(3);
      expect(constants.RETRY.NETWORK_REQUEST.maxAttempts).toBe(5);
      expect(constants.RETRY.AI_ANALYSIS.maxAttempts).toBe(2);
    });
  });

  describe('CACHE', () => {
    test('defines cache size limits', () => {
      expect(constants.CACHE.MAX_FILE_CACHE).toBe(500);
      expect(constants.CACHE.MAX_EMBEDDING_CACHE).toBe(1000);
      expect(constants.CACHE.MAX_ANALYSIS_CACHE).toBe(200);
    });

    test('defines TTL values', () => {
      expect(constants.CACHE.TTL_SHORT).toBe(5 * 60 * 1000);
      expect(constants.CACHE.TTL_MEDIUM).toBe(30 * 60 * 1000);
      expect(constants.CACHE.TTL_LONG).toBe(2 * 60 * 60 * 1000);
      expect(constants.CACHE.TTL_DAY).toBe(24 * 60 * 60 * 1000);
    });

    test('defines ChromaDB cache settings', () => {
      expect(constants.CACHE.CHROMADB_QUERY_CACHE_SIZE).toBe(200);
      expect(constants.CACHE.CHROMADB_QUERY_TTL_MS).toBe(120000);
    });
  });

  describe('BATCH', () => {
    test('defines batch size levels', () => {
      expect(constants.BATCH.SIZE_SMALL).toBe(10);
      expect(constants.BATCH.SIZE_MEDIUM).toBe(50);
      expect(constants.BATCH.SIZE_LARGE).toBe(100);
      expect(constants.BATCH.SIZE_XLARGE).toBe(1000);
    });

    test('defines concurrency limits', () => {
      expect(constants.BATCH.MAX_CONCURRENT_FILES).toBe(5);
      expect(constants.BATCH.MAX_CONCURRENT_ANALYSIS).toBe(3);
      expect(constants.BATCH.MAX_CONCURRENT_NETWORK).toBe(10);
    });

    test('defines embedding batch settings', () => {
      expect(constants.BATCH.EMBEDDING_BATCH_SIZE).toBe(50);
      expect(constants.BATCH.EMBEDDING_PARALLEL_SIZE).toBe(10);
    });
  });

  describe('POLLING', () => {
    test('defines polling intervals', () => {
      expect(constants.POLLING.FAST).toBe(100);
      expect(constants.POLLING.NORMAL).toBe(500);
      expect(constants.POLLING.SLOW).toBe(2000);
      expect(constants.POLLING.VERY_SLOW).toBe(5000);
    });

    test('defines startup polling intervals', () => {
      expect(constants.POLLING.STARTUP_POLL_INITIAL).toBe(50);
      expect(constants.POLLING.STARTUP_POLL_SLOW).toBe(200);
    });
  });

  describe('FILE_SIZE', () => {
    test('defines file size limits', () => {
      expect(constants.FILE_SIZE.MAX_INLINE_TEXT).toBe(1024 * 1024);
      expect(constants.FILE_SIZE.MAX_DOCUMENT_SIZE).toBe(50 * 1024 * 1024);
      expect(constants.FILE_SIZE.MAX_IMAGE_SIZE).toBe(20 * 1024 * 1024);
    });

    test('defines streaming thresholds', () => {
      expect(constants.FILE_SIZE.LARGE_FILE_THRESHOLD).toBe(10 * 1024 * 1024);
      expect(constants.FILE_SIZE.STREAM_THRESHOLD).toBe(5 * 1024 * 1024);
    });
  });

  describe('PAGINATION', () => {
    test('defines pagination settings', () => {
      expect(constants.PAGINATION.DEFAULT_PAGE_SIZE).toBe(50);
      expect(constants.PAGINATION.MAX_PAGE_SIZE).toBe(1000);
      expect(constants.PAGINATION.INFINITE_SCROLL_THRESHOLD).toBe(100);
    });
  });

  describe('THRESHOLDS', () => {
    test('defines confidence thresholds', () => {
      expect(constants.THRESHOLDS.CONFIDENCE_LOW).toBe(0.3);
      expect(constants.THRESHOLDS.CONFIDENCE_MEDIUM).toBe(0.6);
      expect(constants.THRESHOLDS.CONFIDENCE_HIGH).toBe(0.8);
      expect(constants.THRESHOLDS.CONFIDENCE_VERY_HIGH).toBe(0.9);
    });

    test('defines resource warning thresholds', () => {
      expect(constants.THRESHOLDS.MEMORY_WARNING_PERCENT).toBe(80);
      expect(constants.THRESHOLDS.DISK_WARNING_PERCENT).toBe(90);
      expect(constants.THRESHOLDS.CPU_WARNING_PERCENT).toBe(85);
    });
  });

  describe('LIMITS', () => {
    test('defines result limits', () => {
      expect(constants.LIMITS.MAX_SEARCH_RESULTS).toBe(100);
      expect(constants.LIMITS.MAX_SUGGESTIONS).toBe(10);
      expect(constants.LIMITS.MAX_HISTORY_ITEMS).toBe(1000);
    });

    test('defines queue limits', () => {
      expect(constants.LIMITS.MAX_QUEUE_SIZE).toBe(10000);
      expect(constants.LIMITS.MAX_DEAD_LETTER_SIZE).toBe(1000);
    });

    test('defines rate limiting', () => {
      expect(constants.LIMITS.MAX_IPC_REQUESTS_PER_SECOND).toBe(200);
      expect(constants.LIMITS.RATE_LIMIT_STALE_MS).toBe(60000);
    });
  });

  describe('IMAGE', () => {
    test('defines image dimension limit', () => {
      expect(constants.IMAGE.MAX_DIMENSION).toBe(1536);
    });
  });

  describe('NETWORK', () => {
    test('defines port constants', () => {
      expect(constants.NETWORK.OLLAMA_PORT).toBe(11434);
      expect(constants.NETWORK.CHROMADB_PORT).toBe(8000);
      expect(constants.NETWORK.DEV_SERVER_PORT).toBe(3000);
    });

    test('defines port range', () => {
      expect(constants.NETWORK.MIN_PORT).toBe(1);
      expect(constants.NETWORK.MAX_PORT).toBe(65535);
    });
  });

  describe('DEBOUNCE', () => {
    test('defines debounce intervals', () => {
      expect(constants.DEBOUNCE.SETTINGS_SAVE).toBe(1000);
      expect(constants.DEBOUNCE.PATTERN_SAVE_THROTTLE).toBe(5000);
      expect(constants.DEBOUNCE.REFRESH_INTERVAL).toBe(60000);
    });
  });

  describe('CONCURRENCY', () => {
    test('defines concurrency limits', () => {
      expect(constants.CONCURRENCY.FOLDER_SCAN).toBe(50);
      expect(constants.CONCURRENCY.EMBEDDING_FLUSH).toBe(5);
    });
  });

  describe('GPU_TUNING', () => {
    test('defines batch sizes for different GPU memory', () => {
      expect(constants.GPU_TUNING.NUM_BATCH_CPU_ONLY).toBe(128);
      expect(constants.GPU_TUNING.NUM_BATCH_LOW_MEMORY).toBe(256);
      expect(constants.GPU_TUNING.NUM_BATCH_MEDIUM_MEMORY).toBe(384);
      expect(constants.GPU_TUNING.NUM_BATCH_HIGH_MEMORY).toBe(512);
    });

    test('defines memory thresholds', () => {
      expect(constants.GPU_TUNING.HIGH_MEMORY_THRESHOLD).toBe(12000);
      expect(constants.GPU_TUNING.MEDIUM_MEMORY_THRESHOLD).toBe(8000);
    });
  });

  describe('TRUNCATION', () => {
    test('defines display truncation limits', () => {
      expect(constants.TRUNCATION.NAME_MAX).toBe(50);
      expect(constants.TRUNCATION.DESCRIPTION_MAX).toBe(140);
      expect(constants.TRUNCATION.PREVIEW_SHORT).toBe(100);
    });

    test('defines collection limits', () => {
      expect(constants.TRUNCATION.FOLDERS_DISPLAY).toBe(10);
      expect(constants.TRUNCATION.KEYWORDS_MAX).toBe(7);
      expect(constants.TRUNCATION.TAGS_DISPLAY).toBe(5);
    });
  });

  describe('VIEWPORT', () => {
    test('defines viewport breakpoints', () => {
      expect(constants.VIEWPORT.MOBILE).toBe(480);
      expect(constants.VIEWPORT.TABLET).toBe(768);
      expect(constants.VIEWPORT.DESKTOP).toBe(1280);
      expect(constants.VIEWPORT.WIDE_DESKTOP).toBe(1600);
      expect(constants.VIEWPORT.FOUR_K).toBe(2560);
    });
  });
});
