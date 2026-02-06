const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const mockLlamaService = {
  initialize: jest.fn().mockResolvedValue(undefined),
  getConfig: jest.fn().mockReturnValue({
    textModel: 'test-text.gguf',
    visionModel: 'test-vision.gguf',
    embeddingModel: 'test-embed.gguf'
  }),
  generateText: jest.fn()
};

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: () => mockLlamaService
}));

const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');
const { analyzeImageFile } = require('../src/main/analysis/imageAnalysis');

describe('Analysis success paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('Document analyser returns structured data for txt file', async () => {
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify({
        category: 'financial',
        keywords: ['invoice', 'project', 'due'],
        confidence: 0.9,
        suggestedName: 'invoice_project',
        summary: 'Invoice for project X'
      })
    });
    const tmpFile = path.join(os.tmpdir(), 'sample.txt');
    await fs.writeFile(tmpFile, 'Invoice for project X totalling $5000 due 2024-12-31');

    const result = await analyzeDocumentFile(tmpFile, []);
    await fs.unlink(tmpFile);

    expect(result).toHaveProperty('category');
    expect(result).toHaveProperty('keywords');
    expect(result.error).toBeUndefined();
  });

  test('Image analyser returns structured data for simple PNG', async () => {
    mockLlamaService.generateText.mockResolvedValue({
      response: JSON.stringify({
        category: 'documents',
        keywords: ['image', 'document'],
        confidence: 0.8,
        suggestedName: 'image_doc',
        colors: ['#ffffff'],
        has_text: false,
        content_type: 'other'
      })
    });
    // 1x1 px transparent PNG
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/ w8AAn8B9tmvxOgAAAAASUVORK5CYII=';
    const buffer = Buffer.from(pngBase64.replace(/\s+/g, ''), 'base64');
    const tmpFile = path.join(os.tmpdir(), 'pixel.png');
    await fs.writeFile(tmpFile, buffer);

    const result = await analyzeImageFile(tmpFile);
    await fs.unlink(tmpFile);

    expect(result).toHaveProperty('category');
    expect(result.error).toBeUndefined();
  });
});
