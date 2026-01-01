/**
 * Tests for Ollama Utilities
 * Tests Ollama client management and model configuration
 */

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/mock-electron')
  }
}));

// Mock ollama
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    list: jest.fn().mockResolvedValue({ models: [] })
  }))
}));

// Mock SettingsService
const mockSettingsService = {
  load: jest.fn().mockResolvedValue({}),
  save: jest.fn().mockResolvedValue({}),
  getInstance: jest.fn()
};
mockSettingsService.getInstance.mockReturnValue(mockSettingsService);

jest.mock('../src/main/services/SettingsService', () => mockSettingsService);

// Mock fs
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue()
  }
}));

// Mock logger
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('ollamaUtils', () => {
  let ollamaUtils;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSettingsService.load.mockResolvedValue({});

    // We need to re-require to get fresh module state if possible,
    // but jest.resetModules() handles that better.
    // For now we assume singleton behavior and just reset mocks.
    jest.resetModules();
    ollamaUtils = require('../src/main/ollamaUtils');
  });

  describe('getOllama', () => {
    test('returns Ollama instance', () => {
      const ollama = ollamaUtils.getOllama();
      expect(ollama).toBeDefined();
    });

    test('returns same instance on multiple calls', () => {
      const ollama1 = ollamaUtils.getOllama();
      const ollama2 = ollamaUtils.getOllama();
      expect(ollama1).toBe(ollama2);
    });
  });

  describe('getOllamaHost', () => {
    test('returns default host', () => {
      const host = ollamaUtils.getOllamaHost();
      expect(host).toBe('http://127.0.0.1:11434');
    });
  });

  describe('setOllamaHost', () => {
    test('sets host and saves to SettingsService', async () => {
      await ollamaUtils.setOllamaHost('http://localhost:11434');
      const host = ollamaUtils.getOllamaHost();
      expect(host).toBe('http://localhost:11434');
      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({ ollamaHost: 'http://localhost:11434' })
      );
    });
  });

  describe('setOllamaModel', () => {
    test('sets text model and saves to SettingsService', async () => {
      await ollamaUtils.setOllamaModel('llama3');
      expect(ollamaUtils.getOllamaModel()).toBe('llama3');
      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({ textModel: 'llama3' })
      );
    });
  });

  describe('setOllamaVisionModel', () => {
    test('sets vision model and saves to SettingsService', async () => {
      await ollamaUtils.setOllamaVisionModel('llava');
      expect(ollamaUtils.getOllamaVisionModel()).toBe('llava');
      expect(mockSettingsService.save).toHaveBeenCalledWith(
        expect.objectContaining({ visionModel: 'llava' })
      );
    });
  });

  describe('loadOllamaConfig', () => {
    test('loads config from SettingsService', async () => {
      mockSettingsService.load.mockResolvedValue({
        textModel: 'llama3',
        visionModel: 'llava',
        ollamaHost: 'http://localhost:11434'
      });

      const config = await ollamaUtils.loadOllamaConfig();

      expect(config.selectedTextModel).toBe('llama3');
      expect(config.selectedVisionModel).toBe('llava');
      expect(config.host).toBe('http://localhost:11434');
      expect(mockSettingsService.load).toHaveBeenCalled();
    });
  });
});
