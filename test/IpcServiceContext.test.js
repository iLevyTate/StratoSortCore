/**
 * @jest-environment node
 *
 * IpcServiceContext Tests
 *
 * Validates context creation, service resolution via get/getService/getRequiredService,
 * validation, legacy parameter conversion, and error scenarios.
 */

const { IpcServiceContext, createFromLegacyParams } = require('../src/main/ipc/IpcServiceContext');

describe('IpcServiceContext', () => {
  let context;

  beforeEach(() => {
    context = new IpcServiceContext();
  });

  describe('Constructor', () => {
    test('initializes with all groups null', () => {
      expect(context.core).toBeNull();
      expect(context.electron).toBeNull();
      expect(context.folders).toBeNull();
      expect(context.analysis).toBeNull();
      expect(context.settings).toBeNull();
      expect(context.systemAnalytics).toBeNull();
      expect(context.getServiceIntegration).toBeNull();
    });
  });

  describe('Setters (fluent API)', () => {
    test('setCore returns this for chaining', () => {
      const result = context.setCore({ ipcMain: {}, IPC_CHANNELS: {}, logger: {} });
      expect(result).toBe(context);
    });

    test('setElectron returns this for chaining', () => {
      const result = context.setElectron({ dialog: {}, shell: {}, getMainWindow: jest.fn() });
      expect(result).toBe(context);
    });

    test('setFolders returns this for chaining', () => {
      const result = context.setFolders({ getCustomFolders: jest.fn() });
      expect(result).toBe(context);
    });

    test('setAnalysis returns this for chaining', () => {
      const result = context.setAnalysis({ analyzeDocumentFile: jest.fn() });
      expect(result).toBe(context);
    });

    test('setSettings returns this for chaining', () => {
      const result = context.setSettings({ settingsService: {} });
      expect(result).toBe(context);
    });

    test('setSystemAnalytics returns this for chaining', () => {
      const result = context.setSystemAnalytics({ track: jest.fn() });
      expect(result).toBe(context);
    });

    test('setServiceIntegration returns this for chaining', () => {
      const result = context.setServiceIntegration(jest.fn());
      expect(result).toBe(context);
    });

    test('full chaining works', () => {
      const result = context
        .setCore({ ipcMain: {}, IPC_CHANNELS: {}, logger: {} })
        .setElectron({ getMainWindow: jest.fn() })
        .setFolders({ getCustomFolders: jest.fn() })
        .setAnalysis({ analyzeDocumentFile: jest.fn() })
        .setSettings({ settingsService: {} })
        .setSystemAnalytics({})
        .setServiceIntegration(jest.fn());

      expect(result).toBe(context);
      expect(context.core).not.toBeNull();
      expect(context.electron).not.toBeNull();
    });
  });

  describe('Getters', () => {
    test('core getter returns set value', () => {
      const core = { ipcMain: {}, IPC_CHANNELS: {}, logger: {} };
      context.setCore(core);
      expect(context.core).toBe(core);
    });

    test('electron getter returns set value', () => {
      const electron = { dialog: {}, shell: {} };
      context.setElectron(electron);
      expect(context.electron).toBe(electron);
    });

    test('folders getter returns set value', () => {
      const folders = { getCustomFolders: jest.fn() };
      context.setFolders(folders);
      expect(context.folders).toBe(folders);
    });

    test('analysis getter returns set value', () => {
      const analysis = { analyzeDocumentFile: jest.fn() };
      context.setAnalysis(analysis);
      expect(context.analysis).toBe(analysis);
    });

    test('settings getter returns set value', () => {
      const settings = { settingsService: {} };
      context.setSettings(settings);
      expect(context.settings).toBe(settings);
    });

    test('systemAnalytics getter returns set value', () => {
      const analytics = { track: jest.fn() };
      context.setSystemAnalytics(analytics);
      expect(context.systemAnalytics).toBe(analytics);
    });

    test('getServiceIntegration getter returns set value', () => {
      const getter = jest.fn();
      context.setServiceIntegration(getter);
      expect(context.getServiceIntegration).toBe(getter);
    });
  });

  describe('get() - service resolution by name', () => {
    const mockIpcMain = { handle: jest.fn() };
    const mockChannels = { FILES: {} };
    const mockLogger = { info: jest.fn() };
    const mockDialog = { showOpenDialog: jest.fn() };
    const mockShell = { openPath: jest.fn() };
    const mockGetMainWindow = jest.fn();
    const mockGetCustomFolders = jest.fn();
    const mockSetCustomFolders = jest.fn();
    const mockSaveCustomFolders = jest.fn();
    const mockScanDirectory = jest.fn();
    const mockAnalyzeDoc = jest.fn();
    const mockAnalyzeImg = jest.fn();
    const mockSettingsService = { get: jest.fn() };
    const mockOnSettingsChanged = jest.fn();
    const mockAnalytics = { track: jest.fn() };
    const mockIntegrationGetter = jest.fn();

    beforeEach(() => {
      context
        .setCore({ ipcMain: mockIpcMain, IPC_CHANNELS: mockChannels, logger: mockLogger })
        .setElectron({ dialog: mockDialog, shell: mockShell, getMainWindow: mockGetMainWindow })
        .setFolders({
          getCustomFolders: mockGetCustomFolders,
          setCustomFolders: mockSetCustomFolders,
          saveCustomFolders: mockSaveCustomFolders,
          scanDirectory: mockScanDirectory
        })
        .setAnalysis({ analyzeDocumentFile: mockAnalyzeDoc, analyzeImageFile: mockAnalyzeImg })
        .setSettings({
          settingsService: mockSettingsService,
          onSettingsChanged: mockOnSettingsChanged
        })
        .setSystemAnalytics(mockAnalytics)
        .setServiceIntegration(mockIntegrationGetter);
    });

    test('resolves ipcMain', () => {
      expect(context.get('ipcMain')).toBe(mockIpcMain);
    });

    test('resolves IPC_CHANNELS', () => {
      expect(context.get('IPC_CHANNELS')).toBe(mockChannels);
    });

    test('resolves logger', () => {
      expect(context.get('logger')).toBe(mockLogger);
    });

    test('resolves dialog', () => {
      expect(context.get('dialog')).toBe(mockDialog);
    });

    test('resolves shell', () => {
      expect(context.get('shell')).toBe(mockShell);
    });

    test('resolves getMainWindow', () => {
      expect(context.get('getMainWindow')).toBe(mockGetMainWindow);
    });

    test('resolves getCustomFolders', () => {
      expect(context.get('getCustomFolders')).toBe(mockGetCustomFolders);
    });

    test('resolves setCustomFolders', () => {
      expect(context.get('setCustomFolders')).toBe(mockSetCustomFolders);
    });

    test('resolves saveCustomFolders', () => {
      expect(context.get('saveCustomFolders')).toBe(mockSaveCustomFolders);
    });

    test('resolves scanDirectory', () => {
      expect(context.get('scanDirectory')).toBe(mockScanDirectory);
    });

    test('resolves analyzeDocumentFile', () => {
      expect(context.get('analyzeDocumentFile')).toBe(mockAnalyzeDoc);
    });

    test('resolves analyzeImageFile', () => {
      expect(context.get('analyzeImageFile')).toBe(mockAnalyzeImg);
    });

    test('resolves settingsService', () => {
      expect(context.get('settingsService')).toBe(mockSettingsService);
    });

    test('resolves onSettingsChanged', () => {
      expect(context.get('onSettingsChanged')).toBe(mockOnSettingsChanged);
    });

    test('resolves systemAnalytics', () => {
      expect(context.get('systemAnalytics')).toBe(mockAnalytics);
    });

    test('resolves getServiceIntegration', () => {
      expect(context.get('getServiceIntegration')).toBe(mockIntegrationGetter);
    });

    test('returns null for unknown service', () => {
      expect(context.get('nonExistent')).toBeNull();
    });

    test('returns undefined via optional chaining when group not set', () => {
      const emptyCtx = new IpcServiceContext();
      expect(emptyCtx.get('ipcMain')).toBeUndefined();
      expect(emptyCtx.get('dialog')).toBeUndefined();
    });
  });

  describe('getService() - backward compatibility', () => {
    test('delegates to get()', () => {
      context.setCore({ ipcMain: 'test', IPC_CHANNELS: {}, logger: {} });
      expect(context.getService('ipcMain')).toBe('test');
    });
  });

  describe('getRequiredService()', () => {
    test('returns service when available', () => {
      context.setCore({ ipcMain: 'mock', IPC_CHANNELS: {}, logger: {} });
      expect(context.getRequiredService('ipcMain')).toBe('mock');
    });

    test('throws for null service', () => {
      expect(() => context.getRequiredService('ipcMain')).toThrow(
        "Required service 'ipcMain' is not available"
      );
    });

    test('throws for unknown service', () => {
      expect(() => context.getRequiredService('nonexistent')).toThrow(
        "Required service 'nonexistent' is not available"
      );
    });
  });

  describe('validate()', () => {
    test('reports missing core services', () => {
      const result = context.validate();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('ipcMain');
      expect(result.missing).toContain('IPC_CHANNELS');
      expect(result.missing).toContain('logger');
    });

    test('valid when core services are set', () => {
      context.setCore({
        ipcMain: { handle: jest.fn() },
        IPC_CHANNELS: {},
        logger: { info: jest.fn() }
      });

      const result = context.validate();

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('warns about missing getMainWindow', () => {
      context.setCore({ ipcMain: {}, IPC_CHANNELS: {}, logger: {} });

      const result = context.validate();

      expect(result.warnings).toContain('getMainWindow');
    });

    test('warns about missing getServiceIntegration', () => {
      context.setCore({ ipcMain: {}, IPC_CHANNELS: {}, logger: {} });

      const result = context.validate();

      expect(result.warnings).toContain('getServiceIntegration');
    });

    test('no warnings when all services set', () => {
      context
        .setCore({ ipcMain: {}, IPC_CHANNELS: {}, logger: {} })
        .setElectron({ getMainWindow: jest.fn() })
        .setServiceIntegration(jest.fn());

      const result = context.validate();

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('toLegacyParams()', () => {
    test('returns flat object with all service references', () => {
      const mockIpcMain = {};
      const mockChannels = {};
      const mockLogger = {};
      const mockDialog = {};
      const mockShell = {};
      const mockGetMainWindow = jest.fn();
      const mockAnalytics = {};
      const mockIntGetter = jest.fn();
      const mockGetFolders = jest.fn();
      const mockSetFolders = jest.fn();
      const mockSaveFolders = jest.fn();
      const mockScanDir = jest.fn();
      const mockAnalyzeDoc = jest.fn();
      const mockAnalyzeImg = jest.fn();
      const mockSettings = {};
      const mockOnChanged = jest.fn();

      context
        .setCore({ ipcMain: mockIpcMain, IPC_CHANNELS: mockChannels, logger: mockLogger })
        .setElectron({ dialog: mockDialog, shell: mockShell, getMainWindow: mockGetMainWindow })
        .setFolders({
          getCustomFolders: mockGetFolders,
          setCustomFolders: mockSetFolders,
          saveCustomFolders: mockSaveFolders,
          scanDirectory: mockScanDir
        })
        .setAnalysis({ analyzeDocumentFile: mockAnalyzeDoc, analyzeImageFile: mockAnalyzeImg })
        .setSettings({ settingsService: mockSettings, onSettingsChanged: mockOnChanged })
        .setSystemAnalytics(mockAnalytics)
        .setServiceIntegration(mockIntGetter);

      const params = context.toLegacyParams();

      expect(params.ipcMain).toBe(mockIpcMain);
      expect(params.IPC_CHANNELS).toBe(mockChannels);
      expect(params.logger).toBe(mockLogger);
      expect(params.dialog).toBe(mockDialog);
      expect(params.shell).toBe(mockShell);
      expect(params.getMainWindow).toBe(mockGetMainWindow);
      expect(params.systemAnalytics).toBe(mockAnalytics);
      expect(params.getServiceIntegration).toBe(mockIntGetter);
      expect(params.getCustomFolders).toBe(mockGetFolders);
      expect(params.setCustomFolders).toBe(mockSetFolders);
      expect(params.saveCustomFolders).toBe(mockSaveFolders);
      expect(params.scanDirectory).toBe(mockScanDir);
      expect(params.analyzeDocumentFile).toBe(mockAnalyzeDoc);
      expect(params.analyzeImageFile).toBe(mockAnalyzeImg);
      expect(params.settingsService).toBe(mockSettings);
      expect(params.onSettingsChanged).toBe(mockOnChanged);
    });

    test('returns undefined properties when groups not set', () => {
      const params = context.toLegacyParams();

      expect(params.ipcMain).toBeUndefined();
      expect(params.dialog).toBeUndefined();
      expect(params.getCustomFolders).toBeUndefined();
    });
  });

  describe('createFromLegacyParams()', () => {
    test('creates context from flat params object', () => {
      const mockIpcMain = { handle: jest.fn() };
      const mockChannels = { FILES: {} };
      const mockLogger = { info: jest.fn() };
      const mockDialog = {};
      const mockShell = {};
      const mockGetMainWindow = jest.fn();
      const mockAnalytics = {};
      const mockIntGetter = jest.fn();
      const mockGetFolders = jest.fn();
      const mockAnalyzeDoc = jest.fn();
      const mockAnalyzeImg = jest.fn();
      const mockSettings = {};

      const ctx = createFromLegacyParams({
        ipcMain: mockIpcMain,
        IPC_CHANNELS: mockChannels,
        logger: mockLogger,
        dialog: mockDialog,
        shell: mockShell,
        getMainWindow: mockGetMainWindow,
        systemAnalytics: mockAnalytics,
        getServiceIntegration: mockIntGetter,
        getCustomFolders: mockGetFolders,
        analyzeDocumentFile: mockAnalyzeDoc,
        analyzeImageFile: mockAnalyzeImg,
        settingsService: mockSettings
      });

      expect(ctx).toBeInstanceOf(IpcServiceContext);
      expect(ctx.core.ipcMain).toBe(mockIpcMain);
      expect(ctx.electron.dialog).toBe(mockDialog);
      expect(ctx.get('ipcMain')).toBe(mockIpcMain);
      expect(ctx.get('dialog')).toBe(mockDialog);
      expect(ctx.get('analyzeDocumentFile')).toBe(mockAnalyzeDoc);
      expect(ctx.getServiceIntegration).toBe(mockIntGetter);
    });

    test('round-trip: toLegacyParams -> createFromLegacyParams preserves references', () => {
      const mockIpcMain = {};
      const mockChannels = {};
      const mockLogger = {};
      const mockIntGetter = jest.fn();

      context
        .setCore({ ipcMain: mockIpcMain, IPC_CHANNELS: mockChannels, logger: mockLogger })
        .setServiceIntegration(mockIntGetter);

      const params = context.toLegacyParams();
      const restored = createFromLegacyParams(params);

      expect(restored.get('ipcMain')).toBe(mockIpcMain);
      expect(restored.get('IPC_CHANNELS')).toBe(mockChannels);
      expect(restored.getServiceIntegration).toBe(mockIntGetter);
    });
  });
});
