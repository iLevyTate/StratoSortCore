/**
 * Tests for ModelVerifier
 * Tests model verification and AI system status
 */

// Mock dependencies
jest.mock('../src/main/ollamaUtils', () => ({
  getOllama: jest.fn().mockReturnValue({
    list: jest.fn().mockResolvedValue({ models: [] }),
    generate: jest.fn().mockResolvedValue({ response: 'OK' }),
    embeddings: jest.fn().mockResolvedValue({ embedding: [0.1, 0.2, 0.3] })
  })
}));

jest.mock('../src/main/utils/ollamaApiRetry', () => ({
  fetchWithRetry: jest.fn().mockResolvedValue({ ok: true })
}));

jest.mock('../src/main/services/PerformanceService', () => ({
  buildOllamaOptions: jest.fn().mockResolvedValue({})
}));

describe('ModelVerifier', () => {
  let ModelVerifier;
  let verifier;
  let fetchWithRetry;
  let getOllama;

  beforeEach(() => {
    jest.resetModules();

    fetchWithRetry = require('../src/main/utils/ollamaApiRetry').fetchWithRetry;
    getOllama = require('../src/main/ollamaUtils').getOllama;

    ModelVerifier = require('../src/main/services/ModelVerifier');
    verifier = new ModelVerifier();
  });

  describe('constructor', () => {
    test('initializes with default host', () => {
      expect(verifier.ollamaHost).toBe('http://127.0.0.1:11434');
    });

    test('initializes with essential models', () => {
      expect(verifier.essentialModels).toBeDefined();
      expect(verifier.essentialModels.length).toBeGreaterThan(0);
    });

    test('uses environment variable for host if set', () => {
      process.env.OLLAMA_BASE_URL = 'http://custom:11434';
      jest.resetModules();
      ModelVerifier = require('../src/main/services/ModelVerifier');
      const customVerifier = new ModelVerifier();
      expect(customVerifier.ollamaHost).toBe('http://custom:11434');
      delete process.env.OLLAMA_BASE_URL;
    });
  });

  describe('checkOllamaConnection', () => {
    test('returns connected true when server responds', async () => {
      fetchWithRetry.mockResolvedValue({ ok: true });

      const result = await verifier.checkOllamaConnection();

      expect(result.connected).toBe(true);
    });

    test('returns connected false on HTTP error', async () => {
      fetchWithRetry.mockResolvedValue({ ok: false, status: 500 });

      const result = await verifier.checkOllamaConnection();

      expect(result.connected).toBe(false);
      expect(result.error).toContain('HTTP error');
    });

    test('returns connected false on network error', async () => {
      fetchWithRetry.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await verifier.checkOllamaConnection();

      expect(result.connected).toBe(false);
      expect(result.error).toContain('Network error');
    });

    test('includes suggestion on connection failure', async () => {
      fetchWithRetry.mockRejectedValue(new Error('Connection failed'));

      const result = await verifier.checkOllamaConnection();

      expect(result.suggestion).toContain('ollama serve');
    });
  });

  describe('getInstalledModels', () => {
    test('returns models list on success', async () => {
      const mockModels = [{ name: 'llama3:latest' }, { name: 'llava:latest' }];
      getOllama().list.mockResolvedValue({ models: mockModels });

      const result = await verifier.getInstalledModels();

      expect(result.success).toBe(true);
      expect(result.models).toEqual(mockModels);
      expect(result.total).toBe(2);
    });

    test('returns empty array on failure', async () => {
      getOllama().list.mockRejectedValue(new Error('List failed'));

      const result = await verifier.getInstalledModels();

      expect(result.success).toBe(false);
      expect(result.models).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('verifyEssentialModels', () => {
    test('returns success when all models are installed', async () => {
      fetchWithRetry.mockResolvedValue({ ok: true });
      getOllama().list.mockResolvedValue({
        models: [
          { name: 'llama3.2:latest' },
          { name: 'llava:latest' },
          { name: 'mxbai-embed-large' }
        ]
      });

      const result = await verifier.verifyEssentialModels();

      expect(result.success).toBe(true);
      expect(result.missingModels.length).toBe(0);
    });

    test('returns missing models list', async () => {
      fetchWithRetry.mockResolvedValue({ ok: true });
      getOllama().list.mockResolvedValue({
        models: [{ name: 'llama3.2:latest' }]
      });

      const result = await verifier.verifyEssentialModels();

      expect(result.success).toBe(false);
      expect(result.missingModels.length).toBeGreaterThan(0);
    });

    test('returns failure when connection fails', async () => {
      fetchWithRetry.mockResolvedValue({ ok: false, status: 500 });

      const result = await verifier.verifyEssentialModels();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Ollama connection failed');
    });

    test('checks for Whisper model', async () => {
      fetchWithRetry.mockResolvedValue({ ok: true });
      getOllama().list.mockResolvedValue({
        models: [
          { name: 'llama3.2:latest' },
          { name: 'llava:latest' },
          { name: 'mxbai-embed-large' },
          { name: 'whisper:medium' }
        ]
      });

      const result = await verifier.verifyEssentialModels();

      expect(result.hasWhisper).toBe(true);
    });
  });

  describe('generateInstallCommands', () => {
    test('returns empty array when no missing models', () => {
      const commands = verifier.generateInstallCommands([]);
      expect(commands).toEqual([]);
    });

    test('generates pull commands for missing models', () => {
      const commands = verifier.generateInstallCommands(['llama3', 'mistral']);

      expect(commands.join('\n')).toContain('ollama pull llama3');
      expect(commands.join('\n')).toContain('ollama pull mistral');
    });

    test('includes verify command', () => {
      const commands = verifier.generateInstallCommands(['llama3']);

      expect(commands.join('\n')).toContain('ollama list');
    });
  });

  describe('generateRecommendations', () => {
    test('returns success recommendation when no issues', () => {
      const recommendations = verifier.generateRecommendations([], true);

      expect(recommendations[0].type).toBe('success');
    });

    test('includes recommendation for missing Whisper', () => {
      const recommendations = verifier.generateRecommendations([], false);

      const whisperRec = recommendations.find((r) => r.message.toLowerCase().includes('whisper'));
      expect(whisperRec).toBeDefined();
      expect(whisperRec.type).toBe('important');
    });

    test('includes recommendation for missing embedding model', () => {
      const recommendations = verifier.generateRecommendations(['mxbai-embed-large'], true);

      const embedRec = recommendations.find((r) => r.message.includes('mxbai-embed-large'));
      expect(embedRec).toBeDefined();
      expect(embedRec.type).toBe('feature');
    });
  });

  describe('testModelFunctionality', () => {
    test('tests text analysis model', async () => {
      getOllama().generate.mockResolvedValue({ response: 'OK' });
      getOllama().list.mockResolvedValue({ models: [{ name: 'whisper' }] });
      getOllama().embeddings.mockResolvedValue({ embedding: [0.1, 0.2] });

      const result = await verifier.testModelFunctionality();

      expect(result.tests).toBeDefined();
      const textTest = result.tests.find((t) => t.type === 'text');
      expect(textTest).toBeDefined();
    });

    test('handles test failures gracefully', async () => {
      getOllama().generate.mockRejectedValue(new Error('Generate failed'));
      getOllama().list.mockResolvedValue({ models: [] });
      getOllama().embeddings.mockRejectedValue(new Error('Embedding failed'));

      const result = await verifier.testModelFunctionality();

      expect(result.summary.failed).toBeGreaterThan(0);
    });

    test('returns success when enough tests pass', async () => {
      getOllama().generate.mockResolvedValue({ response: 'OK' });
      getOllama().list.mockResolvedValue({ models: [{ name: 'whisper' }] });
      getOllama().embeddings.mockResolvedValue({ embedding: [0.1, 0.2] });

      const result = await verifier.testModelFunctionality();

      expect(result.success).toBe(true);
    });
  });

  describe('getSystemStatus', () => {
    test('returns comprehensive status', async () => {
      fetchWithRetry.mockResolvedValue({ ok: true });
      getOllama().list.mockResolvedValue({
        models: [
          { name: 'llama3.2:latest' },
          { name: 'llava:latest' },
          { name: 'mxbai-embed-large' },
          { name: 'whisper' }
        ]
      });
      getOllama().generate.mockResolvedValue({ response: 'OK' });
      getOllama().embeddings.mockResolvedValue({ embedding: [0.1, 0.2] });

      const status = await verifier.getSystemStatus();

      expect(status.timestamp).toBeDefined();
      expect(status.connection).toBeDefined();
      expect(status.models).toBeDefined();
      expect(status.functionality).toBeDefined();
      expect(status.overall).toBeDefined();
    });

    test('reports healthy when all checks pass', async () => {
      fetchWithRetry.mockResolvedValue({ ok: true });
      getOllama().list.mockResolvedValue({
        models: [
          { name: 'llama3.2:latest' },
          { name: 'llava:latest' },
          { name: 'mxbai-embed-large' },
          { name: 'whisper' }
        ]
      });
      getOllama().generate.mockResolvedValue({ response: 'OK' });
      getOllama().embeddings.mockResolvedValue({ embedding: [0.1, 0.2] });

      const status = await verifier.getSystemStatus();

      expect(status.overall.healthy).toBe(true);
      expect(status.overall.issues.length).toBe(0);
    });

    test('reports unhealthy with issues', async () => {
      fetchWithRetry.mockResolvedValue({ ok: false, status: 500 });

      const status = await verifier.getSystemStatus();

      expect(status.overall.healthy).toBe(false);
      expect(status.overall.issues.length).toBeGreaterThan(0);
    });

    test('handles errors gracefully', async () => {
      fetchWithRetry.mockRejectedValue(new Error('Network error'));
      getOllama().list.mockRejectedValue(new Error('List error'));

      const status = await verifier.getSystemStatus();

      expect(status.overall.healthy).toBe(false);
      expect(status.timestamp).toBeDefined();
    });
  });
});
