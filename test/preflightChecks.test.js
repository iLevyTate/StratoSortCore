jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
  }
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

const fs = require('fs').promises;
const { app } = require('electron');
const { getInstance } = require('../src/main/services/LlamaService');
const {
  runPreflightChecks,
  validateEnvironmentVariables
} = require('../src/main/services/startup/preflightChecks');

describe('preflightChecks', () => {
  const originalEnv = process.env.SERVICE_CHECK_TIMEOUT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SERVICE_CHECK_TIMEOUT;
  });

  afterAll(() => {
    process.env.SERVICE_CHECK_TIMEOUT = originalEnv;
  });

  test('validateEnvironmentVariables returns error for invalid timeout', () => {
    process.env.SERVICE_CHECK_TIMEOUT = '50';
    const errors = validateEnvironmentVariables();
    expect(errors[0]).toContain('SERVICE_CHECK_TIMEOUT');
  });

  test('runPreflightChecks returns ok checks and warns on missing models', async () => {
    app.getPath.mockReturnValue('C:/user-data');
    fs.access.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    fs.unlink.mockResolvedValue();

    const llamaService = {
      testConnection: jest.fn().mockResolvedValue({
        success: true,
        status: 'ready',
        gpuBackend: 'cpu',
        modelCount: 2
      }),
      getConfig: jest.fn().mockResolvedValue({
        textModel: 'text',
        visionModel: 'vision',
        embeddingModel: 'embed'
      }),
      listModels: jest.fn().mockResolvedValue([{ name: 'text' }, { name: 'embed' }])
    };
    getInstance.mockReturnValue(llamaService);

    const errors = [];
    const reportProgress = jest.fn();
    const checks = await runPreflightChecks({ reportProgress, errors });

    const dataCheck = checks.find((c) => c.name === 'Data Directory');
    const aiCheck = checks.find((c) => c.name === 'AI Engine');
    const modelCheck = checks.find((c) => c.name === 'Models');
    const diskCheck = checks.find((c) => c.name === 'Disk Space');

    expect(dataCheck.status).toBe('ok');
    expect(aiCheck.status).toBe('ok');
    expect(modelCheck.status).toBe('warn');
    expect(modelCheck.details.missing).toEqual(['vision']);
    expect(diskCheck.status).toBe('ok');
    expect(errors).toHaveLength(1);
    expect(errors[0].check).toBe('models');
  });

  test('runPreflightChecks records data directory failure and AI error', async () => {
    process.env.SERVICE_CHECK_TIMEOUT = '70000';
    app.getPath.mockReturnValue('C:/user-data');
    fs.access.mockRejectedValue(new Error('no access'));
    fs.mkdir.mockResolvedValue();
    fs.writeFile.mockRejectedValue(new Error('write failed'));

    const llamaService = {
      testConnection: jest.fn().mockResolvedValue({
        success: false,
        error: 'AI down'
      }),
      getConfig: jest.fn().mockResolvedValue({
        textModel: 'text',
        visionModel: null,
        embeddingModel: null
      }),
      listModels: jest.fn().mockResolvedValue([{ name: 'text' }])
    };
    getInstance.mockReturnValue(llamaService);

    const errors = [];
    const reportProgress = jest.fn();
    const checks = await runPreflightChecks({ reportProgress, errors });

    const envCheck = checks.find((c) => c.name === 'Environment Variables');
    const dataCheck = checks.find((c) => c.name === 'Data Directory');
    const aiCheck = checks.find((c) => c.name === 'AI Engine');

    expect(envCheck.status).toBe('warning');
    expect(dataCheck.status).toBe('fail');
    expect(aiCheck.status).toBe('warn');
    expect(errors.some((e) => e.check === 'data-directory' && e.critical)).toBe(true);
    expect(errors.some((e) => e.check === 'ai-engine')).toBe(true);
  });

  describe('Migration: LlamaService (not Ollama) integration', () => {
    beforeEach(() => {
      app.getPath.mockReturnValue('C:/user-data');
      fs.access.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
      fs.unlink.mockResolvedValue();
    });

    test('calls LlamaService.testConnection (not Ollama health check)', async () => {
      const llamaService = {
        testConnection: jest.fn().mockResolvedValue({
          success: true,
          status: 'ready',
          gpuBackend: 'vulkan',
          modelCount: 3
        }),
        getConfig: jest.fn().mockResolvedValue({
          textModel: 'text',
          visionModel: 'vision',
          embeddingModel: 'embed'
        }),
        listModels: jest
          .fn()
          .mockResolvedValue([{ name: 'text' }, { name: 'vision' }, { name: 'embed' }])
      };
      getInstance.mockReturnValue(llamaService);

      const errors = [];
      const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

      expect(llamaService.testConnection).toHaveBeenCalled();

      const aiCheck = checks.find((c) => c.name === 'AI Engine');
      expect(aiCheck.status).toBe('ok');
      expect(aiCheck.details.gpuBackend).toBe('vulkan');
    });

    test('calls LlamaService.listModels for model availability', async () => {
      const llamaService = {
        testConnection: jest.fn().mockResolvedValue({ success: true }),
        getConfig: jest.fn().mockResolvedValue({
          textModel: 'phi3',
          visionModel: 'llava',
          embeddingModel: 'nomic'
        }),
        listModels: jest.fn().mockResolvedValue([{ name: 'phi3' }, { name: 'nomic' }])
      };
      getInstance.mockReturnValue(llamaService);

      const errors = [];
      const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

      expect(llamaService.listModels).toHaveBeenCalled();
      expect(llamaService.getConfig).toHaveBeenCalled();

      const modelCheck = checks.find((c) => c.name === 'Models');
      expect(modelCheck.status).toBe('warn');
      expect(modelCheck.details.missing).toEqual(['llava']);
    });

    test('all models available produces ok status', async () => {
      const llamaService = {
        testConnection: jest.fn().mockResolvedValue({ success: true }),
        getConfig: jest.fn().mockResolvedValue({
          textModel: 'phi3',
          visionModel: 'llava',
          embeddingModel: 'nomic'
        }),
        listModels: jest
          .fn()
          .mockResolvedValue([{ name: 'phi3' }, { name: 'llava' }, { name: 'nomic' }])
      };
      getInstance.mockReturnValue(llamaService);

      const errors = [];
      const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

      const modelCheck = checks.find((c) => c.name === 'Models');
      expect(modelCheck.status).toBe('ok');
      expect(errors.filter((e) => e.check === 'models')).toHaveLength(0);
    });

    test('graceful degradation when LlamaService is unavailable', async () => {
      getInstance.mockReturnValue({
        testConnection: jest.fn().mockRejectedValue(new Error('LlamaService not loaded')),
        getConfig: jest.fn().mockRejectedValue(new Error('not available')),
        listModels: jest.fn().mockRejectedValue(new Error('not available'))
      });

      const errors = [];
      const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

      const aiCheck = checks.find((c) => c.name === 'AI Engine');
      expect(aiCheck.status).toBe('warn');
      expect(aiCheck.error).toContain('LlamaService not loaded');

      const modelCheck = checks.find((c) => c.name === 'Models');
      expect(modelCheck.status).toBe('warn');
    });

    test('does NOT reference Ollama or ChromaDB endpoints', async () => {
      const llamaService = {
        testConnection: jest.fn().mockResolvedValue({ success: true }),
        getConfig: jest.fn().mockResolvedValue({ textModel: 'a' }),
        listModels: jest.fn().mockResolvedValue([{ name: 'a' }])
      };
      getInstance.mockReturnValue(llamaService);

      const errors = [];
      await runPreflightChecks({ reportProgress: jest.fn(), errors });

      // No Ollama or ChromaDB references should exist
      const errorStrings = errors.map((e) => JSON.stringify(e).toLowerCase());
      for (const s of errorStrings) {
        expect(s).not.toContain('ollama');
        expect(s).not.toContain('chromadb');
      }
    });

    test('AI engine check is non-critical (app can function without it)', async () => {
      getInstance.mockReturnValue({
        testConnection: jest.fn().mockResolvedValue({
          success: false,
          error: 'Models not downloaded yet'
        }),
        getConfig: jest.fn().mockResolvedValue({ textModel: 'a' }),
        listModels: jest.fn().mockResolvedValue([])
      });

      const errors = [];
      await runPreflightChecks({ reportProgress: jest.fn(), errors });

      const aiError = errors.find((e) => e.check === 'ai-engine');
      expect(aiError).toBeDefined();
      expect(aiError.critical).toBe(false);
    });
  });
});
