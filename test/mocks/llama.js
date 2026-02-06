// Simple mock for Llama used by unit tests

// Provide a mock class with the minimal API used by analysis modules
class Llama {
  constructor() {}
  async generate() {
    return {
      response: JSON.stringify({
        category: 'General',
        keywords: ['mock'],
        confidence: 80,
        suggestedName: 'mock_file'
      })
    };
  }
  // Legacy API (deprecated)
  async embeddings() {
    return { embedding: Array.from({ length: 10 }, () => 0.1) };
  }
  // New API - uses 'input' parameter and returns 'embeddings' array
  async embed() {
    return { embeddings: [Array.from({ length: 10 }, () => 0.1)] };
  }
  async list() {
    return { models: [{ name: 'llama3.2:latest' }] };
  }
}

const mockLlamaService = {
  analyze: jest.fn(),
  isConnected: jest.fn()
};

module.exports = { mockLlamaService, Llama };
