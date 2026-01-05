/**
 * Focused tests for ServiceIntegration SmartFolderWatcher wiring / auto-start logic
 */

jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

// Minimal constructor mocks for services referenced at module load
jest.mock('../src/main/services/analysisHistory', () =>
  jest.fn().mockImplementation(() => ({ initialize: jest.fn() }))
);
jest.mock('../src/main/services/UndoRedoService', () =>
  jest.fn().mockImplementation(() => ({ initialize: jest.fn() }))
);
jest.mock('../src/main/services/ProcessingStateService', () =>
  jest.fn().mockImplementation(() => ({ initialize: jest.fn() }))
);
jest.mock('../src/main/services/FolderMatchingService', () =>
  jest.fn().mockImplementation(() => ({ initialize: jest.fn() }))
);
jest.mock('../src/main/services/organization', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/main/services/autoOrganize', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/main/services/EmbeddingCache', () => jest.fn().mockImplementation(() => ({})));
jest.mock('../src/main/services/NotificationService', () =>
  jest.fn().mockImplementation(() => ({}))
);
jest.mock('../src/main/services/SmartFolderWatcher', () =>
  jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(true),
    stop: jest.fn(),
    getStatus: jest.fn().mockReturnValue({ isRunning: false }),
    isRunning: false
  }))
);

// Stub DI container just for watcher + settings resolution
const mockWatcher = {
  start: jest.fn().mockResolvedValue(true),
  stop: jest.fn(),
  isRunning: false
};
const mockSettings = {
  load: jest.fn().mockResolvedValue({ smartFolderWatchEnabled: true })
};

jest.mock('../src/main/services/ServiceContainer', () => ({
  container: {
    registerSingleton: jest.fn(),
    resolve: jest.fn((id) => {
      if (id === 'SMART_FOLDER_WATCHER') return mockWatcher;
      if (id === 'SETTINGS') return mockSettings;
      return {};
    }),
    has: jest.fn(() => true),
    shutdown: jest.fn().mockResolvedValue(undefined)
  },
  ServiceIds: {
    SETTINGS: 'SETTINGS',
    SMART_FOLDER_WATCHER: 'SMART_FOLDER_WATCHER'
  },
  SHUTDOWN_ORDER: []
}));

describe('ServiceIntegration SmartFolderWatcher wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWatcher.start.mockClear();
    mockSettings.load.mockClear();
  });

  test('configureSmartFolderWatcher wires dependencies and triggers auto-start check', async () => {
    const ServiceIntegration = require('../src/main/services/ServiceIntegration');
    const integration = new ServiceIntegration();

    const autoStartSpy = jest
      .spyOn(integration, '_autoStartSmartFolderWatcher')
      .mockResolvedValue(undefined);

    integration.configureSmartFolderWatcher({
      getSmartFolders: () => [],
      analyzeDocumentFile: () => ({}),
      analyzeImageFile: () => ({})
    });

    expect(autoStartSpy).toHaveBeenCalled();
  });

  test('_autoStartSmartFolderWatcher starts watcher when enabled in settings', async () => {
    const ServiceIntegration = require('../src/main/services/ServiceIntegration');
    const integration = new ServiceIntegration();
    integration.smartFolderWatcher = mockWatcher;

    mockSettings.load.mockResolvedValueOnce({ smartFolderWatchEnabled: true });
    await integration._autoStartSmartFolderWatcher();

    expect(mockSettings.load).toHaveBeenCalled();
    expect(mockWatcher.start).toHaveBeenCalled();
  });

  test('_autoStartSmartFolderWatcher does not start watcher when disabled', async () => {
    const ServiceIntegration = require('../src/main/services/ServiceIntegration');
    const integration = new ServiceIntegration();
    integration.smartFolderWatcher = mockWatcher;

    mockSettings.load.mockResolvedValueOnce({ smartFolderWatchEnabled: false });
    await integration._autoStartSmartFolderWatcher();

    expect(mockWatcher.start).not.toHaveBeenCalled();
  });
});
