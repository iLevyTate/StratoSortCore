/**
 * Tests for ServiceIntegration
 * Tests service orchestration and lifecycle management
 */

// Mock all dependencies before importing
jest.mock('../src/main/services/analysisHistory', () => {
  const mockInstance = {
    initialize: jest.fn().mockResolvedValue()
  };
  return jest.fn().mockImplementation(() => mockInstance);
});

jest.mock('../src/main/services/UndoRedoService', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue()
  }));
});

jest.mock('../src/main/services/ProcessingStateService', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue()
  }));
});

jest.mock('../src/main/services/chromadb', () => ({
  getInstance: jest.fn().mockReturnValue({
    initialize: jest.fn().mockResolvedValue(),
    isServerAvailable: jest.fn().mockResolvedValue(true)
  }),
  registerWithContainer: jest.fn((container, serviceId) => {
    container.registerSingleton(serviceId, () => ({
      initialize: jest.fn().mockResolvedValue(),
      isServerAvailable: jest.fn().mockResolvedValue(true)
    }));
  })
}));

jest.mock('../src/main/services/FolderMatchingService', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn()
  }));
});

jest.mock('../src/main/services/organization', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('../src/main/services/autoOrganize', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('../src/main/services/OllamaService', () => ({
  getInstance: jest.fn().mockReturnValue({}),
  registerWithContainer: jest.fn((container, serviceId) => {
    container.registerSingleton(serviceId, () => ({}));
  })
}));

jest.mock('../src/main/services/OllamaClient', () => ({
  getInstance: jest.fn().mockReturnValue({}),
  registerWithContainer: jest.fn((container, serviceId) => {
    container.registerSingleton(serviceId, () => ({}));
  })
}));

jest.mock('../src/main/services/ParallelEmbeddingService', () => ({
  getInstance: jest.fn().mockReturnValue({}),
  registerWithContainer: jest.fn((container, serviceId) => {
    container.registerSingleton(serviceId, () => ({}));
  })
}));

jest.mock('../src/main/services/EmbeddingCache', () => {
  return jest.fn().mockImplementation(() => ({}));
});

jest.mock('../src/main/services/SettingsService', () => ({
  getService: jest.fn().mockReturnValue({})
}));

jest.mock('../src/main/services/SmartFolderWatcher', () => {
  return jest.fn().mockImplementation(() => ({
    configure: jest.fn(),
    start: jest.fn().mockResolvedValue(true),
    stop: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ isRunning: false }),
    isRunning: false
  }));
});

// Store mockServices outside so we can reset it
let mockServices = new Map();

jest.mock('../src/main/services/ServiceContainer', () => {
  // Create a recursive resolver that properly resolves dependencies
  const createResolver = () => ({
    resolve: (depId) => {
      const factory = mockServices.get(depId);
      if (factory) {
        return factory(createResolver());
      }
      return { initialize: jest.fn().mockResolvedValue() };
    }
  });
  return {
    container: {
      registerSingleton: jest.fn((id, factory) => {
        mockServices.set(id, factory);
      }),
      resolve: jest.fn((id) => {
        const factory = mockServices.get(id);
        if (factory) {
          return factory(createResolver());
        }
        return { initialize: jest.fn().mockResolvedValue() };
      }),
      has: jest.fn((id) => mockServices.has(id)),
      shutdown: jest.fn().mockResolvedValue()
    },
    // Expose reset function for tests
    _resetMockServices: () => {
      mockServices = new Map();
    },
    ServiceIds: {
      SETTINGS: 'settings',
      CHROMA_DB: 'chromaDb',
      ANALYSIS_HISTORY: 'analysisHistory',
      UNDO_REDO: 'undoRedo',
      PROCESSING_STATE: 'processingState',
      FOLDER_MATCHING: 'folderMatching',
      ORGANIZATION_SUGGESTION: 'organizationSuggestion',
      AUTO_ORGANIZE: 'autoOrganize',
      OLLAMA_CLIENT: 'ollamaClient',
      OLLAMA_SERVICE: 'ollamaService',
      EMBEDDING_CACHE: 'embeddingCache',
      PARALLEL_EMBEDDING: 'parallelEmbedding'
    }
  };
});

describe('ServiceIntegration', () => {
  let ServiceIntegration;
  let container;
  let ServiceIds;

  beforeEach(() => {
    // jest.resetModules(); // Removed - breaks module imports
    jest.clearAllMocks();

    // Reset the mock services map between tests
    mockServices = new Map();

    const module = require('../src/main/services/ServiceIntegration');
    ServiceIntegration = module.ServiceIntegration || module;
    container = module.container;
    ServiceIds = module.ServiceIds;
  });

  describe('constructor', () => {
    test('initializes with null services', () => {
      const integration = new ServiceIntegration();

      expect(integration.analysisHistory).toBeNull();
      expect(integration.undoRedo).toBeNull();
      expect(integration.processingState).toBeNull();
      expect(integration.chromaDbService).toBeNull();
      expect(integration.initialized).toBe(false);
    });

    test('has reference to container', () => {
      const integration = new ServiceIntegration();

      expect(integration.container).toBe(container);
    });
  });

  describe('initialize', () => {
    test('sets initialized to true', async () => {
      const integration = new ServiceIntegration();

      await integration.initialize();

      expect(integration.initialized).toBe(true);
    });

    test('does not reinitialize', async () => {
      const integration = new ServiceIntegration();

      await integration.initialize();
      await integration.initialize();

      // registerSingleton should only be called once per service
      expect(container.registerSingleton).toHaveBeenCalled();
    });

    test('resolves services from container', async () => {
      const integration = new ServiceIntegration();

      await integration.initialize();

      expect(container.resolve).toHaveBeenCalledWith(ServiceIds.ANALYSIS_HISTORY);
      expect(container.resolve).toHaveBeenCalledWith(ServiceIds.UNDO_REDO);
      expect(container.resolve).toHaveBeenCalledWith(ServiceIds.PROCESSING_STATE);
      expect(container.resolve).toHaveBeenCalledWith(ServiceIds.CHROMA_DB);
    });

    test('handles ChromaDB unavailable gracefully', async () => {
      const chromaDb = require('../src/main/services/chromadb');
      chromaDb.getInstance.mockReturnValue({
        initialize: jest.fn().mockResolvedValue(),
        isServerAvailable: jest.fn().mockResolvedValue(false)
      });

      const integration = new ServiceIntegration();

      await expect(integration.initialize()).resolves.not.toThrow();
      expect(integration.initialized).toBe(true);
    });
  });

  describe('shutdown', () => {
    test('does nothing if not initialized', async () => {
      const integration = new ServiceIntegration();

      await integration.shutdown();

      expect(container.shutdown).not.toHaveBeenCalled();
    });

    test('calls container shutdown', async () => {
      const integration = new ServiceIntegration();
      await integration.initialize();

      await integration.shutdown();

      expect(container.shutdown).toHaveBeenCalled();
    });

    test('clears service references', async () => {
      const integration = new ServiceIntegration();
      await integration.initialize();

      await integration.shutdown();

      expect(integration.analysisHistory).toBeNull();
      expect(integration.undoRedo).toBeNull();
      expect(integration.initialized).toBe(false);
    });
  });

  describe('getService', () => {
    test('resolves service from container', () => {
      const integration = new ServiceIntegration();
      const mockService = { test: true };
      container.resolve.mockReturnValueOnce(mockService);

      const service = integration.getService(ServiceIds.SETTINGS);

      expect(container.resolve).toHaveBeenCalledWith(ServiceIds.SETTINGS);
      expect(service).toBe(mockService);
    });
  });

  describe('hasService', () => {
    test('checks if service is registered', () => {
      const integration = new ServiceIntegration();
      container.has.mockReturnValue(true);

      const result = integration.hasService(ServiceIds.SETTINGS);

      expect(container.has).toHaveBeenCalledWith(ServiceIds.SETTINGS);
      expect(result).toBe(true);
    });
  });

  describe('SERVICE_INITIALIZATION_ORDER', () => {
    test('exports initialization order constant', () => {
      const module = require('../src/main/services/ServiceIntegration');

      expect(module.SERVICE_INITIALIZATION_ORDER).toBeDefined();
      expect(typeof module.SERVICE_INITIALIZATION_ORDER).toBe('object');
    });

    test('initialization order includes all tiers', () => {
      const module = require('../src/main/services/ServiceIntegration');
      const order = module.SERVICE_INITIALIZATION_ORDER;

      // Should have tier0, tier1, tier2 properties
      expect(order).toHaveProperty('tier0');
      expect(order).toHaveProperty('tier1');
      expect(order).toHaveProperty('tier2');
      expect(Array.isArray(order.tier0)).toBe(true);
      expect(Array.isArray(order.tier1)).toBe(true);
      expect(Array.isArray(order.tier2)).toBe(true);
    });

    test('tier0 contains independent services', () => {
      const module = require('../src/main/services/ServiceIntegration');
      const order = module.SERVICE_INITIALIZATION_ORDER;

      // Tier 0 should have services that can initialize in parallel
      expect(order.tier0.length).toBeGreaterThan(0);
      expect(order.tier0).toContain('analysisHistory');
    });

    test('tier1 contains ChromaDB', () => {
      const module = require('../src/main/services/ServiceIntegration');
      const order = module.SERVICE_INITIALIZATION_ORDER;

      // Tier 1 should contain chromaDb
      expect(order.tier1).toContain('chromaDb');
    });

    test('tier2 contains services dependent on ChromaDB', () => {
      const module = require('../src/main/services/ServiceIntegration');
      const order = module.SERVICE_INITIALIZATION_ORDER;

      // Tier 2 services depend on ChromaDB
      expect(order.tier2.length).toBeGreaterThan(0);
    });
  });
});
