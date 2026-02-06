/**
 * Jest mock for node-llama-cpp (ESM-only in real package).
 * This keeps unit tests deterministic and avoids ESM parsing issues.
 */

class MockContext {
  async getEmbeddingFor() {
    return { vector: new Float32Array([0.1, 0.2, 0.3]) };
  }
  async dispose() {}
}

class MockModel {
  async createContext() {
    return new MockContext();
  }
  async createEmbeddingContext() {
    return new MockContext();
  }
  async dispose() {}
}

async function getLlama() {
  return {
    gpu: 'cpu',
    async loadModel() {
      return new MockModel();
    },
    async dispose() {}
  };
}

class LlamaChatSession {
  constructor() {}
  async prompt() {
    return 'mock-response';
  }
}

module.exports = { getLlama, LlamaChatSession };
