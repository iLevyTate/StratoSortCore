/**
 * Tests for IpcServiceContext
 * Tests IPC service context dependency grouping and management
 */

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

describe('IpcServiceContext', () => {
  let IpcServiceContext;
  let createFromLegacyParams;
  let context;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    const module = require('../src/main/ipc/IpcServiceContext');
    IpcServiceContext = module.IpcServiceContext;
    createFromLegacyParams = module.createFromLegacyParams;

    context = new IpcServiceContext();
  });

  describe('constructor', () => {
    test('initializes with null service groups', () => {
      expect(context.core).toBeNull();
      expect(context.electron).toBeNull();
      expect(context.folders).toBeNull();
      expect(context.analysis).toBeNull();
      expect(context.ollama).toBeNull();
      expect(context.settings).toBeNull();
      expect(context.systemAnalytics).toBeNull();
      expect(context.getServiceIntegration).toBeNull();
    });
  });

  describe('setCore', () => {
    test('sets core services', () => {
      const coreServices = {
        ipcMain: { handle: jest.fn() },
        IPC_CHANNELS: { TEST: 'test' },
        logger: { info: jest.fn() }
      };

      const result = context.setCore(coreServices);

      expect(context.core).toBe(coreServices);
      expect(result).toBe(context); // Supports chaining
    });
  });

  describe('setElectron', () => {
    test('sets Electron services', () => {
      const electronServices = {
        dialog: { showOpenDialog: jest.fn() },
        shell: { openPath: jest.fn() },
        getMainWindow: jest.fn()
      };

      const result = context.setElectron(electronServices);

      expect(context.electron).toBe(electronServices);
      expect(result).toBe(context);
    });
  });

  describe('setFolders', () => {
    test('sets folder services', () => {
      const folderServices = {
        getCustomFolders: jest.fn(),
        setCustomFolders: jest.fn(),
        saveCustomFolders: jest.fn(),
        scanDirectory: jest.fn()
      };

      const result = context.setFolders(folderServices);

      expect(context.folders).toBe(folderServices);
      expect(result).toBe(context);
    });
  });

  describe('setAnalysis', () => {
    test('sets analysis services', () => {
      const analysisServices = {
        analyzeDocumentFile: jest.fn(),
        analyzeImageFile: jest.fn(),
        tesseract: {}
      };

      const result = context.setAnalysis(analysisServices);

      expect(context.analysis).toBe(analysisServices);
      expect(result).toBe(context);
    });
  });

  describe('setOllama', () => {
    test('sets Ollama configuration', () => {
      const ollamaConfig = {
        getOllama: jest.fn(),
        getOllamaHost: jest.fn(),
        setOllamaHost: jest.fn(),
        getOllamaModel: jest.fn()
      };

      const result = context.setOllama(ollamaConfig);

      expect(context.ollama).toBe(ollamaConfig);
      expect(result).toBe(context);
    });
  });

  describe('setSettings', () => {
    test('sets settings services', () => {
      const settingsServices = {
        settingsService: { get: jest.fn() },
        onSettingsChanged: jest.fn()
      };

      const result = context.setSettings(settingsServices);

      expect(context.settings).toBe(settingsServices);
      expect(result).toBe(context);
    });
  });

  describe('setSystemAnalytics', () => {
    test('sets system analytics instance', () => {
      const analytics = { trackEvent: jest.fn() };

      const result = context.setSystemAnalytics(analytics);

      expect(context.systemAnalytics).toBe(analytics);
      expect(result).toBe(context);
    });
  });

  describe('setServiceIntegration', () => {
    test('sets service integration getter', () => {
      const getter = jest.fn(() => ({ initialized: true }));

      const result = context.setServiceIntegration(getter);

      expect(context.getServiceIntegration).toBe(getter);
      expect(result).toBe(context);
    });
  });

  describe('chaining', () => {
    test('supports fluent API chaining', () => {
      const result = context
        .setCore({ ipcMain: {}, IPC_CHANNELS: {}, logger: {} })
        .setElectron({ dialog: {}, shell: {}, getMainWindow: () => {} })
        .setFolders({ getCustomFolders: () => [], setCustomFolders: () => {} })
        .setAnalysis({ analyzeDocumentFile: () => {} })
        .setOllama({ getOllama: () => {} })
        .setSettings({ settingsService: {} })
        .setSystemAnalytics({})
        .setServiceIntegration(() => {});

      expect(result).toBe(context);
      expect(context.core).not.toBeNull();
      expect(context.electron).not.toBeNull();
    });
  });

  describe('get', () => {
    beforeEach(() => {
      context
        .setCore({
          ipcMain: { handle: 'ipcMainHandle' },
          IPC_CHANNELS: { TEST: 'test-channel' },
          logger: { info: 'loggerInfo' }
        })
        .setElectron({
          dialog: { open: 'dialogOpen' },
          shell: { exec: 'shellExec' },
          getMainWindow: 'windowGetter'
        })
        .setFolders({
          getCustomFolders: 'customFoldersGetter',
          setCustomFolders: 'customFoldersSetter',
          saveCustomFolders: 'customFoldersSaver',
          scanDirectory: 'dirScanner'
        })
        .setAnalysis({
          analyzeDocumentFile: 'docAnalyzer',
          analyzeImageFile: 'imgAnalyzer',
          tesseract: 'tesseractLib'
        })
        .setOllama({
          getOllama: 'ollamaGetter',
          getOllamaHost: 'hostGetter',
          setOllamaHost: 'hostSetter'
        })
        .setSettings({
          settingsService: 'settingsSvc',
          onSettingsChanged: 'settingsCallback'
        })
        .setSystemAnalytics('analyticsInstance')
        .setServiceIntegration('integrationGetter');
    });

    test('retrieves core services by name', () => {
      // get('ipcMain') returns the whole ipcMain object
      expect(context.get('ipcMain')).toEqual({ handle: 'ipcMainHandle' });
      expect(context.get('IPC_CHANNELS')).toEqual({ TEST: 'test-channel' });
      expect(context.get('logger')).toEqual({ info: 'loggerInfo' });
    });

    test('retrieves Electron services by name', () => {
      expect(context.get('dialog')).toEqual({ open: 'dialogOpen' });
      expect(context.get('shell')).toEqual({ exec: 'shellExec' });
      expect(context.get('getMainWindow')).toBe('windowGetter');
    });

    test('retrieves folder services by name', () => {
      expect(context.get('getCustomFolders')).toBe('customFoldersGetter');
      expect(context.get('setCustomFolders')).toBe('customFoldersSetter');
      expect(context.get('saveCustomFolders')).toBe('customFoldersSaver');
      expect(context.get('scanDirectory')).toBe('dirScanner');
    });

    test('retrieves analysis services by name', () => {
      expect(context.get('analyzeDocumentFile')).toBe('docAnalyzer');
      expect(context.get('analyzeImageFile')).toBe('imgAnalyzer');
      expect(context.get('tesseract')).toBe('tesseractLib');
    });

    test('retrieves Ollama config by name', () => {
      expect(context.get('getOllama')).toBe('ollamaGetter');
      expect(context.get('getOllamaHost')).toBe('hostGetter');
      expect(context.get('setOllamaHost')).toBe('hostSetter');
    });

    test('retrieves settings services by name', () => {
      expect(context.get('settingsService')).toBe('settingsSvc');
      expect(context.get('onSettingsChanged')).toBe('settingsCallback');
    });

    test('retrieves system analytics by name', () => {
      expect(context.get('systemAnalytics')).toBe('analyticsInstance');
    });

    test('retrieves service integration by name', () => {
      expect(context.get('getServiceIntegration')).toBe('integrationGetter');
    });

    test('returns null for unknown service names', () => {
      expect(context.get('unknownService')).toBeNull();
      expect(context.get('')).toBeNull();
    });

    test('handles missing service groups gracefully', () => {
      const emptyContext = new IpcServiceContext();

      expect(emptyContext.get('ipcMain')).toBeUndefined();
      expect(emptyContext.get('dialog')).toBeUndefined();
    });
  });

  describe('validate', () => {
    test('returns valid when core services are present', () => {
      context.setCore({
        ipcMain: { handle: jest.fn() },
        IPC_CHANNELS: {},
        logger: { info: jest.fn() }
      });

      const result = context.validate();

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('returns invalid when ipcMain is missing', () => {
      context.setCore({
        IPC_CHANNELS: {},
        logger: {}
      });

      const result = context.validate();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('ipcMain');
    });

    test('returns invalid when IPC_CHANNELS is missing', () => {
      context.setCore({
        ipcMain: {},
        logger: {}
      });

      const result = context.validate();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('IPC_CHANNELS');
    });

    test('returns invalid when logger is missing', () => {
      context.setCore({
        ipcMain: {},
        IPC_CHANNELS: {}
      });

      const result = context.validate();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('logger');
    });

    test('adds warnings for missing optional services', () => {
      context.setCore({
        ipcMain: {},
        IPC_CHANNELS: {},
        logger: {}
      });

      const result = context.validate();

      expect(result.warnings).toContain('getMainWindow');
      expect(result.warnings).toContain('getServiceIntegration');
    });

    test('no warnings when optional services are present', () => {
      context
        .setCore({
          ipcMain: {},
          IPC_CHANNELS: {},
          logger: {}
        })
        .setElectron({
          getMainWindow: jest.fn()
        })
        .setServiceIntegration(jest.fn());

      const result = context.validate();

      expect(result.warnings).not.toContain('getMainWindow');
      expect(result.warnings).not.toContain('getServiceIntegration');
    });

    test('returns all missing services', () => {
      const emptyContext = new IpcServiceContext();

      const result = emptyContext.validate();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('ipcMain');
      expect(result.missing).toContain('IPC_CHANNELS');
      expect(result.missing).toContain('logger');
    });
  });

  describe('toLegacyParams', () => {
    test('converts context to legacy parameter object', () => {
      context
        .setCore({
          ipcMain: 'ipc',
          IPC_CHANNELS: 'channels',
          logger: 'log'
        })
        .setElectron({
          dialog: 'dlg',
          shell: 'sh',
          getMainWindow: 'getWin'
        })
        .setFolders({
          getCustomFolders: 'getFolders',
          setCustomFolders: 'setFolders',
          saveCustomFolders: 'saveFolders',
          scanDirectory: 'scan'
        })
        .setAnalysis({
          analyzeDocumentFile: 'analyzeDoc',
          analyzeImageFile: 'analyzeImg',
          tesseract: 'tess'
        })
        .setOllama({
          getOllama: 'ollama',
          getOllamaHost: 'host',
          setOllamaHost: 'setHost',
          getOllamaModel: 'model',
          setOllamaModel: 'setModel',
          getOllamaVisionModel: 'vision',
          setOllamaVisionModel: 'setVision',
          getOllamaEmbeddingModel: 'embed',
          setOllamaEmbeddingModel: 'setEmbed',
          buildOllamaOptions: 'buildOpts'
        })
        .setSettings({
          settingsService: 'settings',
          onSettingsChanged: 'onChange'
        })
        .setSystemAnalytics('analytics')
        .setServiceIntegration('integration');

      const params = context.toLegacyParams();

      expect(params.ipcMain).toBe('ipc');
      expect(params.IPC_CHANNELS).toBe('channels');
      expect(params.logger).toBe('log');
      expect(params.dialog).toBe('dlg');
      expect(params.shell).toBe('sh');
      expect(params.getMainWindow).toBe('getWin');
      expect(params.getCustomFolders).toBe('getFolders');
      expect(params.setCustomFolders).toBe('setFolders');
      expect(params.saveCustomFolders).toBe('saveFolders');
      expect(params.scanDirectory).toBe('scan');
      expect(params.analyzeDocumentFile).toBe('analyzeDoc');
      expect(params.analyzeImageFile).toBe('analyzeImg');
      expect(params.tesseract).toBe('tess');
      expect(params.getOllama).toBe('ollama');
      expect(params.getOllamaHost).toBe('host');
      expect(params.setOllamaHost).toBe('setHost');
      expect(params.getOllamaModel).toBe('model');
      expect(params.setOllamaModel).toBe('setModel');
      expect(params.getOllamaVisionModel).toBe('vision');
      expect(params.setOllamaVisionModel).toBe('setVision');
      expect(params.getOllamaEmbeddingModel).toBe('embed');
      expect(params.setOllamaEmbeddingModel).toBe('setEmbed');
      expect(params.buildOllamaOptions).toBe('buildOpts');
      expect(params.settingsService).toBe('settings');
      expect(params.onSettingsChanged).toBe('onChange');
      expect(params.systemAnalytics).toBe('analytics');
      expect(params.getServiceIntegration).toBe('integration');
    });

    test('handles undefined service groups', () => {
      const params = new IpcServiceContext().toLegacyParams();

      expect(params.ipcMain).toBeUndefined();
      expect(params.dialog).toBeUndefined();
      expect(params.getCustomFolders).toBeUndefined();
    });
  });

  describe('createFromLegacyParams', () => {
    test('creates context from legacy parameters', () => {
      const legacyParams = {
        ipcMain: 'ipc',
        IPC_CHANNELS: 'channels',
        logger: 'log',
        dialog: 'dlg',
        shell: 'sh',
        getMainWindow: 'getWin',
        getCustomFolders: 'getFolders',
        setCustomFolders: 'setFolders',
        saveCustomFolders: 'saveFolders',
        scanDirectory: 'scan',
        analyzeDocumentFile: 'analyzeDoc',
        analyzeImageFile: 'analyzeImg',
        tesseract: 'tess',
        getOllama: 'ollama',
        getOllamaHost: 'host',
        setOllamaHost: 'setHost',
        getOllamaModel: 'model',
        setOllamaModel: 'setModel',
        getOllamaVisionModel: 'vision',
        setOllamaVisionModel: 'setVision',
        getOllamaEmbeddingModel: 'embed',
        setOllamaEmbeddingModel: 'setEmbed',
        buildOllamaOptions: 'buildOpts',
        settingsService: 'settings',
        onSettingsChanged: 'onChange',
        systemAnalytics: 'analytics',
        getServiceIntegration: 'integration'
      };

      const ctx = createFromLegacyParams(legacyParams);

      expect(ctx).toBeInstanceOf(IpcServiceContext);
      expect(ctx.core.ipcMain).toBe('ipc');
      expect(ctx.core.IPC_CHANNELS).toBe('channels');
      expect(ctx.core.logger).toBe('log');
      expect(ctx.electron.dialog).toBe('dlg');
      expect(ctx.electron.shell).toBe('sh');
      expect(ctx.electron.getMainWindow).toBe('getWin');
      expect(ctx.folders.getCustomFolders).toBe('getFolders');
      expect(ctx.analysis.analyzeDocumentFile).toBe('analyzeDoc');
      expect(ctx.ollama.getOllama).toBe('ollama');
      expect(ctx.settings.settingsService).toBe('settings');
      expect(ctx.systemAnalytics).toBe('analytics');
      expect(ctx.getServiceIntegration).toBe('integration');
    });

    test('round-trips through toLegacyParams', () => {
      const originalParams = {
        ipcMain: 'ipc',
        IPC_CHANNELS: 'channels',
        logger: 'log',
        dialog: 'dlg',
        shell: 'sh',
        getMainWindow: 'getWin',
        systemAnalytics: 'analytics',
        getServiceIntegration: 'integration'
      };

      const ctx = createFromLegacyParams(originalParams);
      const resultParams = ctx.toLegacyParams();

      expect(resultParams.ipcMain).toBe(originalParams.ipcMain);
      expect(resultParams.IPC_CHANNELS).toBe(originalParams.IPC_CHANNELS);
      expect(resultParams.logger).toBe(originalParams.logger);
      expect(resultParams.dialog).toBe(originalParams.dialog);
      expect(resultParams.shell).toBe(originalParams.shell);
      expect(resultParams.getMainWindow).toBe(originalParams.getMainWindow);
    });
  });

  describe('backward compatibility alias', () => {
    test('exports ServiceContainer as alias', () => {
      const module = require('../src/main/ipc/IpcServiceContext');

      expect(module.ServiceContainer).toBe(module.IpcServiceContext);
    });
  });
});
