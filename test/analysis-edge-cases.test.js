const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { analyzeImageFile } = require('../src/main/analysis/ollamaImageAnalysis');
const { analyzeDocumentFile } = require('../src/main/analysis/ollamaDocumentAnalysis');

// Mock ollamaDetection to simulate online state
jest.mock('../src/main/utils/ollamaDetection', () => ({
  isOllamaRunning: jest.fn().mockResolvedValue(true),
  isOllamaInstalled: jest.fn().mockResolvedValue(true)
}));

/**
 * These tests focus on negative/edge-case inputs to ensure the analysers fail
 * gracefully and return structured error objects instead of throwing.
 * NOTE:  Ollama calls are mocked implicitly by the existing jest mock in
 * ../mocks/ollama.js so tests run fast and offline.
 */

describe('Analysis edge cases', () => {
  test('Image analyser rejects unsupported extension', async () => {
    expect.assertions(2);
    const tmpFile = path.join(os.tmpdir(), 'sample.unsupported');
    await fs.writeFile(tmpFile, 'dummy');

    const result = await analyzeImageFile(tmpFile);
    await fs.unlink(tmpFile);

    expect(result).toHaveProperty('error');
    expect(result.category).toBe('unsupported');
  });

  test('Image analyser handles zero-byte PNG with fallback', async () => {
    // FIX: Updated test to match new fallback behavior
    // When vision model isn't loaded, uses filename-based fallback instead of erroring
    expect.assertions(2);
    const tmpFile = path.join(os.tmpdir(), 'empty.png');
    await fs.writeFile(tmpFile, Buffer.alloc(0));

    const result = await analyzeImageFile(tmpFile);
    await fs.unlink(tmpFile);

    // Should return fallback analysis instead of error
    expect(result).toHaveProperty('category');
    expect(result.extractionMethod).toBe('filename_fallback');
  });

  test('Document analyser handles non-PDF unknown extension via fallback', async () => {
    expect.assertions(1);
    const tmpFile = path.join(os.tmpdir(), 'notes.xyz');
    await fs.writeFile(tmpFile, 'Project Alpha draft');

    const result = await analyzeDocumentFile(tmpFile, []);
    await fs.unlink(tmpFile);

    expect(result).toHaveProperty('category');
    // Should not throw even though extension unsupported
  });
});
