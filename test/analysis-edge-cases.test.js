const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const { analyzeImageFile } = require('../src/main/analysis/imageAnalysis');
const { analyzeDocumentFile } = require('../src/main/analysis/documentAnalysis');

/**
 * These tests focus on negative/edge-case inputs to ensure the analysers fail
 * gracefully and return structured error objects instead of throwing.
 * NOTE: LlamaService calls are mocked by test setup so tests run fast and offline.
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

  test('Image analyser handles zero-byte PNG with error', async () => {
    // Zero-byte images are caught at the file-size check (before any model interaction)
    // and return a structured error object instead of throwing.
    expect.assertions(2);
    const tmpFile = path.join(os.tmpdir(), 'empty.png');
    await fs.writeFile(tmpFile, Buffer.alloc(0));

    const result = await analyzeImageFile(tmpFile);
    await fs.unlink(tmpFile);

    expect(result).toHaveProperty('error');
    expect(result.error).toMatch(/empty/i);
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
