const fs = require('fs').promises;
const os = require('os');
const path = require('path');

describe('per-file analysis cache (image)', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('second analyzeImageFile call hits cache and avoids AI call', async () => {
    expect.assertions(3);
    // 1x1 px transparent PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAn8B9tmvxOgAAAAASUVORK5CYII=';
    const buffer = Buffer.from(pngBase64, 'base64');
    const tmp = path.join(os.tmpdir(), `img-cache-${Date.now()}.png`);
    await fs.writeFile(tmp, buffer);

    const analyzeImageMock = jest.fn(async () => ({
      response: JSON.stringify({
        project: 'Img',
        purpose: 'Img purpose',
        category: 'image',
        keywords: ['a', 'b', 'c'],
        confidence: 90,
        suggestedName: 'img_file'
      })
    }));

    jest.doMock('../src/main/services/LlamaService', () => ({
      getInstance: () => ({
        getConfig: async () => ({ visionModel: 'mock-vision' }),
        testConnection: async () => ({ success: true, status: 'healthy' }),
        listModels: async () => [{ name: 'mock-vision' }],
        analyzeImage: analyzeImageMock
      })
    }));

    const { analyzeImageFile } = require('../src/main/analysis/imageAnalysis');

    const r1 = await analyzeImageFile(tmp, []);
    const r2 = await analyzeImageFile(tmp, []);

    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(analyzeImageMock).toHaveBeenCalledTimes(1);

    await fs.unlink(tmp);
  });
});
