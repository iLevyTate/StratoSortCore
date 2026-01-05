import crypto from 'crypto';
import { logger } from '../../shared/logger';
import { createSingletonHelpers } from '../../shared/singletonFactory';

logger.setContext('AnalysisCacheService');

interface CacheEntry {
  value: unknown;
  timestamp: number;
}

interface AnalysisStats {
  size: number;
  maxEntries: number;
}

interface SmartFolderLike {
  name?: string;
  description?: string;
}

export class AnalysisCacheService {
  maxEntries: number;

  ttlMs: number;

  cache: Map<string, CacheEntry>;

  constructor() {
    this.maxEntries = 200;
    this.ttlMs = 3600000; // 1 hour
    this.cache = new Map(); // key -> { value, timestamp }
  }

  /**
   * Generate a cache key for text content and analysis options
   */
  // eslint-disable-next-line class-methods-use-this
  generateKey(textContent: string, model: string, smartFolders: SmartFolderLike[]): string {
    // Limit input size to prevent excessive hash computation
    const MAX_TEXT_LENGTH = 50000; // 50KB max for hash key
    const truncatedText =
      textContent?.length > MAX_TEXT_LENGTH ? textContent.slice(0, MAX_TEXT_LENGTH) : textContent;

    const hasher = crypto.createHash('sha1');
    // Include original length to prevent hash collision
    hasher.update(`${textContent?.length || 0}:`);
    hasher.update(truncatedText || '');
    hasher.update('|');
    hasher.update(String(model || ''));
    hasher.update('|');
    try {
      const foldersKey = Array.isArray(smartFolders)
        ? smartFolders
            .map((f) => `${f?.name || ''}:${(f?.description || '').slice(0, 64)}`)
            .join(',')
        : '';
      hasher.update(foldersKey);
    } catch {
      // Expected: Continue with partial key if folder data is malformed
    }
    return hasher.digest('hex');
  }

  /**
   * Generate a file signature for caching based on metadata
   */
  // eslint-disable-next-line class-methods-use-this
  generateFileSignature(filePath: string, stats: { size: number; mtimeMs: number }): string | null {
    if (!stats) return null;
    return `file:${filePath}:${stats.size}:${stats.mtimeMs}`;
  }

  get<T = unknown>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // LRU: Move to end by re-inserting
    this.cache.delete(key);
    this.cache.set(key, { ...entry, timestamp: Date.now() });
    return entry.value as T;
  }

  set(key: string, value: unknown): void {
    // Evict oldest entry if at capacity (LRU eviction)
    if (this.cache.size >= this.maxEntries) {
      const iterator = this.cache.keys();
      const oldestKey = iterator.next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  clear(): void {
    this.cache.clear();
  }

  getStats(): AnalysisStats {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries
    };
  }

  shutdown(): void {
    this.clear();
  }
}

// Use shared singleton factory
const { getInstance, createInstance, registerWithContainer, resetInstance } =
  createSingletonHelpers({
    ServiceClass: AnalysisCacheService,
    serviceId: 'ANALYSIS_CACHE',
    serviceName: 'AnalysisCacheService',
    containerPath: './ServiceContainer',
    shutdownMethod: 'shutdown'
  });

export { getInstance, createInstance, registerWithContainer, resetInstance };
export default AnalysisCacheService;
