const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const mockImageCacheStore = new Map();
const mockImageCache = {
  get: jest.fn((key) => (mockImageCacheStore.has(key) ? mockImageCacheStore.get(key) : null)),
  set: jest.fn((key, value) => {
    mockImageCacheStore.set(key, value);
  }),
  clear: jest.fn(() => {
    mockImageCacheStore.clear();
  })
};

const mockLlamaService = {
  getConfig: jest.fn(),
  testConnection: jest.fn(),
  listModels: jest.fn(),
  analyzeImage: jest.fn(),
  supportsVisionInput: jest.fn()
};

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  })
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

jest.mock('../src/main/services/AnalysisCacheService', () => ({
  getImageAnalysisCache: () => mockImageCache
}));

jest.mock('../src/main/utils/llmOptimization', () => ({
  globalDeduplicator: {
    generateKey: jest.fn(() => 'mock-key'),
    deduplicate: jest.fn((key, fn) => fn())
  }
}));

jest.mock('../src/main/analysis/semanticFolderMatcher', () => ({
  applySemanticFolderMatching: jest.fn(async () => {}),
  getServices: jest.fn(() => ({})),
  resetSingletons: jest.fn()
}));

describe('per-file analysis cache (image)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockImageCache.clear();
    mockLlamaService.getConfig.mockResolvedValue({ visionModel: 'mock-vision' });
    mockLlamaService.testConnection.mockResolvedValue({ success: true, status: 'healthy' });
    mockLlamaService.listModels.mockResolvedValue([{ name: 'mock-vision' }]);
    mockLlamaService.supportsVisionInput.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('second analyzeImageFile call hits cache and avoids AI call', async () => {
    expect.assertions(3);
    // 1x1 px transparent PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9tmvxOgAAAAASUVORK5CYII=';
    const buffer = Buffer.from(pngBase64, 'base64');
    const tmp = path.posix.join(os.tmpdir(), `img-cache-${Date.now()}.png`);
    await fs.writeFile(tmp, buffer);

    mockLlamaService.analyzeImage.mockResolvedValue({
      response: JSON.stringify({
        project: 'Img',
        purpose: 'Img purpose',
        category: 'image',
        keywords: ['a', 'b', 'c'],
        confidence: 90,
        suggestedName: 'img_file'
      })
    });

    const { analyzeImageFile } = require('../src/main/analysis/imageAnalysis');

    const r1 = await analyzeImageFile(tmp, []);
    const r2 = await analyzeImageFile(tmp, []);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(mockLlamaService.analyzeImage).toHaveBeenCalledTimes(1);

    await fs.unlink(tmp);
  });

  test('cache signature changes when smart folder descriptions change', async () => {
    expect.assertions(1);
    // 1x1 px transparent PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9tmvxOgAAAAASUVORK5CYII=';
    const buffer = Buffer.from(pngBase64, 'base64');
    const tmp = path.posix.join(os.tmpdir(), `img-cache-desc-${Date.now()}.png`);
    await fs.writeFile(tmp, buffer);

    mockLlamaService.analyzeImage.mockResolvedValue({
      response: JSON.stringify({
        project: 'Img',
        purpose: 'Img purpose',
        category: 'image',
        keywords: ['a', 'b', 'c'],
        confidence: 90,
        suggestedName: 'img_file'
      })
    });

    const { analyzeImageFile } = require('../src/main/analysis/imageAnalysis');

    const foldersA = [{ name: 'Screenshots', description: 'App and UI captures' }];
    const foldersB = [{ name: 'Screenshots', description: 'Receipts and documents' }];

    await analyzeImageFile(tmp, foldersA);
    await analyzeImageFile(tmp, foldersB);

    expect(mockLlamaService.analyzeImage).toHaveBeenCalledTimes(2);

    await fs.unlink(tmp);
  });
});
