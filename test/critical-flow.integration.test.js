/**
 * Critical flow integration test:
 * analyze-summary -> semantic smart-folder match -> move updates vector metadata
 *
 * This is intentionally "real-ish":
 * - Uses OramaVectorService (in-process vector DB)
 * - Uses FolderMatchingService normalization layer
 * - Uses OrganizationSuggestionServiceCore semantic matching path (embedding routing)
 * - Uses FilePathCoordinator to update vector DB ids/metadata on move
 */
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { AI_DEFAULTS } = require('../src/shared/constants');

const EMBEDDING_DIM = AI_DEFAULTS?.EMBEDDING?.DIMENSIONS || 384;

// Avoid Orama persistence plugin dynamic import issues in Jest.
jest.mock('@orama/plugin-data-persistence', () => ({
  persist: jest.fn(async () => '{}'),
  restore: jest.fn(async () => {
    throw new Error('restore not available in test');
  })
}));

// Mock electron app.getPath for Orama persistence pathing.
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

// Keep organization persistence in-memory for deterministic tests.
jest.mock('../src/main/services/organization/persistence', () => ({
  PatternPersistence: class {
    async load() {
      return {};
    }
    async save() {
      return { success: true };
    }
    getMetrics() {
      return {};
    }
  }
}));

jest.mock('../src/main/services/organization/feedbackMemoryStore', () => ({
  FeedbackMemoryStore: class {
    async load() {
      return [];
    }
    async list() {
      return [];
    }
    async add() {
      return null;
    }
    async update() {
      return null;
    }
    async remove() {
      return true;
    }
    async reset() {
      return true;
    }
    getMetrics() {
      return {};
    }
  }
}));

// Deterministic embeddings: anything invoice-ish maps to the same vector.
const mockLlamaService = {
  getConfig: jest.fn(() => ({ embeddingModel: 'all-MiniLM-L6-v2-Q4_K_M.gguf' })),
  onModelChange: jest.fn(() => () => {}),
  generateEmbedding: jest.fn(async (text) => {
    const t = String(text || '').toLowerCase();
    const seed = t.includes('invoice') || t.includes('invoices') ? 0.25 : 0.75;
    return { embedding: new Array(EMBEDDING_DIM).fill(seed) };
  })
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

describe('critical flow: suggest + move', () => {
  let tmpRoot;
  let OramaVectorService;
  let FolderMatchingService;
  let OrganizationSuggestionService;
  let FilePathCoordinator;
  let normalizePathForIndex;
  let app;

  beforeAll(async () => {
    ({ app } = require('electron'));
    ({ OramaVectorService } = require('../src/main/services/OramaVectorService'));
    FolderMatchingService = require('../src/main/services/FolderMatchingService');
    OrganizationSuggestionService = require('../src/main/services/organization');
    ({ FilePathCoordinator } = require('../src/main/services/FilePathCoordinator'));
    ({ normalizePathForIndex } = require('../src/shared/pathSanitization'));

    // test/test-setup.js mocks fs+os to memfs and forces os.tmpdir() => "/tmp".
    // Ensure the base exists before mkdtemp (beforeEach normally creates it).
    await fs.mkdir('/tmp', { recursive: true });
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'stratosort-critical-flow-'));
    app.getPath.mockReturnValue(tmpRoot);
  });

  afterAll(async () => {
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('semantic match selects correct smart folder and move updates vector metadata', async () => {
    const vectorDb = new OramaVectorService();
    try {
      await vectorDb.initialize();

      const folderMatcher = new FolderMatchingService(vectorDb, {
        // Avoid spinning up real parallel embedding infra in unit tests
        parallelEmbeddingService: { batchEmbedTexts: jest.fn().mockResolvedValue({ results: [] }) }
      });

      const settingsService = {
        load: jest.fn(async () => ({})),
        get: jest.fn(() => null),
        save: jest.fn(async () => ({ success: true }))
      };

      const suggestionService = new OrganizationSuggestionService({
        vectorDbService: vectorDb,
        folderMatchingService: folderMatcher,
        settingsService
      });

      const smartFolders = [
        {
          id: 'folder-uncat',
          name: 'Uncategorized',
          path: 'C:\\Docs\\Uncategorized',
          description: 'Default bucket',
          isDefault: true
        },
        {
          id: 'folder-invoices',
          name: 'Invoices',
          path: 'C:\\Docs\\Invoices',
          description: 'Invoices and receipts'
        }
      ];

      const file = {
        name: 'invoice-2026-01.pdf',
        extension: 'pdf',
        path: 'C:\\Downloads\\invoice-2026-01.pdf',
        analysis: {
          category: 'financial',
          keywords: ['invoice', 'payment'],
          confidence: 0.9,
          summary: 'Invoice for services rendered'
        }
      };

      const suggestions = await suggestionService.getSuggestionsForFile(file, smartFolders, {
        routingModeOverride: 'embedding',
        routingReason: 'integration-test',
        includeAlternatives: false,
        includeStructureAnalysis: false
      });

      expect(suggestions.success).toBe(true);
      expect(suggestions.primary).toBeTruthy();
      expect(suggestions.primary.isSmartFolder).toBe(true);
      expect(suggestions.primary.folder).toBe('Invoices');

      // Insert a file embedding under the old path id
      const oldPath = file.path;
      const newPath = path.win32.join(suggestions.primary.path, file.name);
      const oldId = `file:${normalizePathForIndex(oldPath)}`;
      const newId = `file:${normalizePathForIndex(newPath)}`;

      await vectorDb.upsertFile({
        id: oldId,
        vector: new Array(EMBEDDING_DIM).fill(0.25),
        meta: {
          path: oldPath,
          fileName: path.win32.basename(oldPath),
          fileType: 'application/pdf',
          analyzedAt: new Date().toISOString()
        }
      });

      const cacheInvalidationBus = {
        invalidateForPathChange: jest.fn(),
        invalidateBatch: jest.fn(),
        invalidateForDeletion: jest.fn()
      };

      const coordinator = new FilePathCoordinator({
        vectorDbService: vectorDb,
        cacheInvalidationBus
      });

      const updateResult = await coordinator.atomicPathUpdate(oldPath, newPath, {
        type: 'move',
        skipAnalysisHistory: true,
        skipEmbeddingQueue: true,
        skipProcessingState: true
      });

      expect(updateResult.success).toBe(true);
      expect(cacheInvalidationBus.invalidateForPathChange).toHaveBeenCalled();

      // Old id should be gone; new id should exist with updated metadata
      await expect(vectorDb.getFile(oldId)).resolves.toBeNull();
      const updated = await vectorDb.getFile(newId);
      expect(updated).toBeTruthy();
      expect(updated.filePath).toBe(newPath);
      expect(updated.fileName).toBe(path.win32.basename(newPath));
    } finally {
      // Ensure timers/persistence don't leak into later tests.
      await vectorDb.cleanup();
    }
  });
});
