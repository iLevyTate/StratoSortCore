/**
 * Tests for Ollama Utilities
 * Tests Ollama client management and model configuration
 */

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn().mockReturnValue('/tmp/mock-electron'),
  },
}));

// Mock ollama
jest.mock('ollama', () => ({
  Ollama: jest.fn().mockImplementation(() => ({
    list: jest.fn().mockResolvedValue({ models: [] }),
  })),
}));

// Mock fs
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn().mockResolvedValue(),
    rename: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
  },
}));

describe('ollamaUtils', () => {
  let ollamaUtils;
  let fs;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks module imports
    fs = require('fs').promises;
    ollamaUtils = require('../src/main/ollamaUtils');
  });

  describe('getOllamaConfigPath', () => {
    test('returns path in userData directory', () => {
      const configPath = ollamaUtils.getOllamaConfigPath();
      expect(configPath).toContain('ollama-config.json');
    });
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

  describe('getOllamaClient', () => {
    test('is alias for getOllama', () => {
      expect(ollamaUtils.getOllamaClient).toBe(ollamaUtils.getOllama);
    });
  });

  describe('getOllamaHost', () => {
    test('returns default host', () => {
      const host = ollamaUtils.getOllamaHost();
      expect(host).toBe('http://127.0.0.1:11434');
    });
  });

  describe('setOllamaHost', () => {
    test('sets host with protocol', async () => {
      await ollamaUtils.setOllamaHost('http://localhost:11434');
      const host = ollamaUtils.getOllamaHost();
      expect(host).toBe('http://localhost:11434');
    });

    test('adds http protocol if missing', async () => {
      await ollamaUtils.setOllamaHost('localhost:11434');
      const host = ollamaUtils.getOllamaHost();
      expect(host).toBe('http://localhost:11434');
    });

    test('normalizes duplicate protocol', async () => {
      await ollamaUtils.setOllamaHost('http://http://localhost:11434');
      const host = ollamaUtils.getOllamaHost();
      expect(host).toContain('localhost');
    });

    test('trims whitespace', async () => {
      await ollamaUtils.setOllamaHost('  localhost:11434  ');
      const host = ollamaUtils.getOllamaHost();
      expect(host).not.toContain(' ');
    });

    test('ignores empty host', async () => {
      const originalHost = ollamaUtils.getOllamaHost();
      await ollamaUtils.setOllamaHost('');
      expect(ollamaUtils.getOllamaHost()).toBe(originalHost);
    });
  });

  describe('getOllamaModel', () => {
    test('returns null initially', () => {
      const model = ollamaUtils.getOllamaModel();
      expect(model).toBe(null);
    });
  });

  describe('setOllamaModel', () => {
    test('sets text model', async () => {
      await ollamaUtils.setOllamaModel('llama3');
      expect(ollamaUtils.getOllamaModel()).toBe('llama3');
    });

    test('saves config to file', async () => {
      await ollamaUtils.setOllamaModel('mistral');
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('getOllamaVisionModel', () => {
    test('returns null initially', () => {
      const model = ollamaUtils.getOllamaVisionModel();
      expect(model).toBe(null);
    });
  });

  describe('setOllamaVisionModel', () => {
    test('sets vision model', async () => {
      await ollamaUtils.setOllamaVisionModel('llava');
      expect(ollamaUtils.getOllamaVisionModel()).toBe('llava');
    });
  });

  describe('getOllamaEmbeddingModel', () => {
    test('returns null initially', () => {
      const model = ollamaUtils.getOllamaEmbeddingModel();
      expect(model).toBe(null);
    });
  });

  describe('setOllamaEmbeddingModel', () => {
    test('sets embedding model', async () => {
      await ollamaUtils.setOllamaEmbeddingModel('mxbai-embed-large');
      expect(ollamaUtils.getOllamaEmbeddingModel()).toBe('mxbai-embed-large');
    });
  });

  describe('loadOllamaConfig', () => {
    test('loads config from file', async () => {
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          selectedTextModel: 'llama3',
          selectedVisionModel: 'llava',
          host: 'http://localhost:11434',
        }),
      );

      const config = await ollamaUtils.loadOllamaConfig();

      expect(config.selectedTextModel).toBe('llama3');
    });

    test('handles missing file gracefully', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValue(error);

      await expect(ollamaUtils.loadOllamaConfig()).resolves.not.toThrow();
    });

    test('handles invalid JSON by backing up', async () => {
      fs.readFile.mockResolvedValue('invalid json {');
      fs.rename.mockResolvedValue();

      await ollamaUtils.loadOllamaConfig();

      expect(fs.rename).toHaveBeenCalled();
    });

    test('supports legacy selectedModel key', async () => {
      fs.readFile.mockResolvedValue(
        JSON.stringify({
          selectedModel: 'llama2',
        }),
      );

      await ollamaUtils.loadOllamaConfig();

      // The function migrates legacy selectedModel to internal state
      expect(ollamaUtils.getOllamaModel()).toBe('llama2');
    });
  });

  describe('saveOllamaConfig', () => {
    test('saves config to file', async () => {
      const config = { selectedTextModel: 'llama3' };

      await ollamaUtils.saveOllamaConfig(config);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    test('uses atomic write pattern', async () => {
      const config = { selectedTextModel: 'llama3' };

      await ollamaUtils.saveOllamaConfig(config);

      // Should write to temp file then rename
      const writeCall = fs.writeFile.mock.calls[0];
      expect(writeCall[0]).toContain('.tmp.');
      expect(fs.rename).toHaveBeenCalled();
    });

    test('cleans up temp file on error', async () => {
      fs.rename.mockRejectedValue(new Error('Rename failed'));

      await expect(ollamaUtils.saveOllamaConfig({})).rejects.toThrow();
      expect(fs.unlink).toHaveBeenCalled();
    });

    test('retries rename on EPERM error', async () => {
      const epermError = new Error('EPERM');
      epermError.code = 'EPERM';
      fs.rename.mockRejectedValueOnce(epermError).mockResolvedValue();

      await ollamaUtils.saveOllamaConfig({});

      expect(fs.rename).toHaveBeenCalledTimes(2);
    });
  });
});
