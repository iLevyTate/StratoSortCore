/**
 * @jest-environment node
 *
 * Tests for llamaBackendSelector.js covering:
 *  - buildBackendCandidates() for CUDA, Metal, Vulkan, and unknown GPU types
 *  - initLlamaWithBackend() happy path: GPU backend selected
 *  - initLlamaWithBackend() fallback: GPU fails, CPU succeeds
 *  - initLlamaWithBackend() fatal: all backends fail
 *  - Null/missing gpuInfo handling
 */

const {
  buildBackendCandidates,
  initLlamaWithBackend
} = require('../src/main/utils/llamaBackendSelector');

describe('llamaBackendSelector', () => {
  // ─── buildBackendCandidates ─────────────────────────────────

  describe('buildBackendCandidates', () => {
    test('returns [cuda, auto] for CUDA GPU', () => {
      expect(buildBackendCandidates({ type: 'cuda' })).toEqual(['cuda', 'auto']);
    });

    test('returns [metal, auto] for Metal GPU', () => {
      expect(buildBackendCandidates({ type: 'metal' })).toEqual(['metal', 'auto']);
    });

    test('returns [vulkan, auto] for Vulkan GPU', () => {
      expect(buildBackendCandidates({ type: 'vulkan' })).toEqual(['vulkan', 'auto']);
    });

    test('returns [auto] for unknown GPU type', () => {
      expect(buildBackendCandidates({ type: 'directx' })).toEqual(['auto']);
    });

    test('returns [auto] when gpuInfo is null', () => {
      expect(buildBackendCandidates(null)).toEqual(['auto']);
    });

    test('returns [auto] when gpuInfo.type is missing', () => {
      expect(buildBackendCandidates({ name: 'GPU' })).toEqual(['auto']);
    });

    test('normalizes type to lowercase', () => {
      expect(buildBackendCandidates({ type: 'CUDA' })).toEqual(['cuda', 'auto']);
      expect(buildBackendCandidates({ type: 'Metal' })).toEqual(['metal', 'auto']);
    });
  });

  // ─── initLlamaWithBackend ──────────────────────────────────

  describe('initLlamaWithBackend', () => {
    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('selects CUDA backend when getLlama succeeds', async () => {
      const mockLlama = { gpu: 'cuda' };
      const getLlama = jest.fn().mockResolvedValue(mockLlama);

      const result = await initLlamaWithBackend({
        getLlama,
        gpuInfo: { type: 'cuda', name: 'RTX 4090' },
        logger: mockLogger,
        context: 'test'
      });

      expect(result.llama).toBe(mockLlama);
      expect(result.backend).toBe('cuda');
      expect(result.selection.selected).toBe('cuda');
      expect(result.selection.attempted).toHaveLength(1);
      expect(result.selection.attempted[0].success).toBe(true);
      expect(getLlama).toHaveBeenCalledWith({ gpu: 'cuda' });
    });

    test('falls back from CUDA to auto when CUDA fails', async () => {
      const mockLlama = { gpu: 'vulkan' };
      const getLlama = jest
        .fn()
        .mockRejectedValueOnce(new Error('CUDA init failed'))
        .mockResolvedValueOnce(mockLlama);

      const result = await initLlamaWithBackend({
        getLlama,
        gpuInfo: { type: 'cuda' },
        logger: mockLogger,
        context: 'test'
      });

      expect(result.backend).toBe('vulkan');
      expect(result.selection.attempted).toHaveLength(2);
      expect(result.selection.attempted[0].success).toBe(false);
      expect(result.selection.attempted[1].success).toBe(true);
    });

    test('falls back to CPU when all GPU backends fail', async () => {
      const mockLlama = { gpu: false };
      const getLlama = jest
        .fn()
        .mockRejectedValueOnce(new Error('CUDA failed'))
        .mockRejectedValueOnce(new Error('Auto failed'))
        .mockResolvedValueOnce(mockLlama); // CPU fallback

      const result = await initLlamaWithBackend({
        getLlama,
        gpuInfo: { type: 'cuda' },
        logger: mockLogger,
        context: 'test'
      });

      expect(result.backend).toBe('cpu');
      expect(result.selection.selected).toBe('cpu');
      expect(result.selection.attempted).toHaveLength(3);
      // Last call should be with { gpu: false }
      expect(getLlama).toHaveBeenLastCalledWith({ gpu: false });
    });

    test('throws fatal error when all backends including CPU fail', async () => {
      const getLlama = jest.fn().mockRejectedValue(new Error('fatal init failure'));

      await expect(
        initLlamaWithBackend({
          getLlama,
          gpuInfo: { type: 'cuda' },
          logger: mockLogger,
          context: 'test'
        })
      ).rejects.toThrow(/Failed to initialize Llama backend/);

      // Should have attempted: cuda, auto, cpu
      expect(getLlama).toHaveBeenCalledTimes(3);
    });

    test('fatal error includes attempt details', async () => {
      const getLlama = jest.fn().mockRejectedValue(new Error('init error'));

      try {
        await initLlamaWithBackend({
          getLlama,
          gpuInfo: { type: 'metal' },
          logger: mockLogger,
          context: 'test'
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error.attempts).toBeDefined();
        // metal and auto are recorded; CPU failure is captured as originalError
        expect(error.attempts).toHaveLength(2); // metal, auto
        expect(error.originalError).toBeDefined();
        expect(error.message).toMatch(/metal, auto/);
      }
    });

    test('works with null gpuInfo (auto-only candidates)', async () => {
      const mockLlama = { gpu: 'cpu' };
      const getLlama = jest.fn().mockResolvedValue(mockLlama);

      const result = await initLlamaWithBackend({
        getLlama,
        gpuInfo: null,
        logger: mockLogger,
        context: 'test'
      });

      expect(result.backend).toBe('cpu');
      expect(getLlama).toHaveBeenCalledWith({ gpu: 'auto' });
      expect(result.selection.detectedGpu).toBeNull();
    });

    test('uses console when no logger provided', async () => {
      const mockLlama = { gpu: 'auto' };
      const getLlama = jest.fn().mockResolvedValue(mockLlama);

      // Should not throw even without logger
      const result = await initLlamaWithBackend({
        getLlama,
        gpuInfo: null,
        context: 'test'
      });

      expect(result.llama).toBe(mockLlama);
    });
  });
});
