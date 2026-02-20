/**
 * @jest-environment node
 */

describe('ImageAnalysis startup resilience', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('loads without throwing when sharp cannot be required', () => {
    jest.isolateModules(() => {
      jest.doMock('sharp', () => {
        throw new Error('Could not load sharp');
      });

      const imageAnalysis = require('../src/main/analysis/imageAnalysis');

      expect(typeof imageAnalysis.analyzeImageFile).toBe('function');
      expect(typeof imageAnalysis.resetSingletons).toBe('function');
    });
  });
});
