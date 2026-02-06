/**
 * @jest-environment node
 */
const { IpcServiceContext } = require('../src/main/ipc/IpcServiceContext');
const { registerSuggestionsIpc } = require('../src/main/ipc/suggestions');
const { IPC_CHANNELS } = require('../src/shared/constants');

// Mock dependencies
jest.mock('../src/main/services/organization', () => {
  return jest.fn().mockImplementation(() => ({
    getSuggestionsForFile: jest.fn(),
    getBatchSuggestions: jest.fn(),
    recordFeedback: jest.fn(),
    recordFeedbackNote: jest.fn(),
    addFeedbackMemory: jest.fn(),
    listFeedbackMemory: jest.fn(),
    deleteFeedbackMemory: jest.fn(),
    updateFeedbackMemory: jest.fn()
  }));
});

jest.mock('../src/shared/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  };
  return { createLogger: jest.fn(() => logger) };
});

jest.mock('../src/main/ipc/ipcWrappers', () => ({
  createHandler: jest.fn(({ handler }) => handler),
  createErrorResponse: jest.fn((err) => ({ success: false, error: err.message })),
  safeHandle: jest.fn()
}));

describe('Suggestions IPC', () => {
  let mockIpcMain;
  let mockSettingsService;
  let mockFoldersService;
  let mockServiceIntegration;
  let mockVectorDbService;
  let mockFolderMatchingService;
  let OrganizationSuggestionService;
  let safeHandle;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    OrganizationSuggestionService = require('../src/main/services/organization');
    safeHandle = require('../src/main/ipc/ipcWrappers').safeHandle;

    mockIpcMain = { handle: jest.fn() };
    mockSettingsService = { get: jest.fn() };
    mockFoldersService = { getCustomFolders: jest.fn(() => []) };
    mockVectorDbService = { name: 'MockVectorDb' };
    mockFolderMatchingService = { name: 'MockFolderMatching' };

    mockServiceIntegration = {
      vectorDbService: mockVectorDbService,
      folderMatchingService: mockFolderMatchingService
    };

    // Use plain object for legacy compatibility
    const context = {
      ipcMain: mockIpcMain,
      IPC_CHANNELS,
      settingsService: mockSettingsService,
      foldersService: mockFoldersService,
      getServiceIntegration: () => mockServiceIntegration,
      // Legacy params expected by createFromLegacyParams
      getCustomFolders: mockFoldersService.getCustomFolders
    };

    // Inject mock folders service into context.folders
    // context.setFolders(mockFoldersService); // Not needed for plain object

    // Register the IPC handlers
    const { registerSuggestionsIpc } = require('../src/main/ipc/suggestions');
    registerSuggestionsIpc(context);
  });

  test('registers all suggestion channels', () => {
    expect(safeHandle).toHaveBeenCalledWith(
      mockIpcMain,
      IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS,
      expect.any(Function)
    );
    expect(safeHandle).toHaveBeenCalledWith(
      mockIpcMain,
      IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS,
      expect.any(Function)
    );
    expect(safeHandle).toHaveBeenCalledWith(
      mockIpcMain,
      IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK,
      expect.any(Function)
    );
  });

  test('GET_FILE_SUGGESTIONS calls service.getSuggestionsForFile', async () => {
    // Get the registered handler
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS
    );
    const handler = handlerCall[2];

    // Setup service mock
    const mockService = new OrganizationSuggestionService();
    mockService.getSuggestionsForFile.mockResolvedValue({
      primary: { folder: 'Finance' },
      confidence: 0.9
    });

    // Call handler
    const result = await handler(
      {}, // event
      { file: { name: 'invoice.pdf' } }, // args
      mockService // service instance (injected by createHandler wrapper logic in real app, passed manually here)
    );

    expect(mockService.getSuggestionsForFile).toHaveBeenCalledWith(
      { name: 'invoice.pdf' },
      [], // smartFolders
      expect.anything() // options
    );
    expect(result).toEqual({
      primary: { folder: 'Finance' },
      confidence: 0.9
    });
  });

  test('GET_BATCH_SUGGESTIONS calls service.getBatchSuggestions', async () => {
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.SUGGESTIONS.GET_BATCH_SUGGESTIONS
    );
    const handler = handlerCall[2];

    const mockService = new OrganizationSuggestionService();
    mockService.getBatchSuggestions.mockResolvedValue({
      groups: [{ name: 'Group 1' }]
    });

    const result = await handler(
      {},
      { files: [{ name: 'a.pdf' }, { name: 'b.pdf' }] },
      mockService
    );

    expect(mockService.getBatchSuggestions).toHaveBeenCalledWith(
      [{ name: 'a.pdf' }, { name: 'b.pdf' }],
      []
    );
    expect(result).toEqual({
      groups: [{ name: 'Group 1' }]
    });
  });

  test('RECORD_FEEDBACK calls service.recordFeedback', async () => {
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.SUGGESTIONS.RECORD_FEEDBACK
    );
    const handler = handlerCall[2];

    const mockService = new OrganizationSuggestionService();
    mockService.recordFeedback.mockResolvedValue(true);

    const result = await handler(
      {},
      {
        file: { name: 'test.pdf' },
        suggestion: { folder: 'Finance' },
        accepted: true,
        note: 'Good match'
      },
      mockService
    );

    expect(mockService.recordFeedback).toHaveBeenCalled();
    expect(mockService.recordFeedbackNote).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  test('handles service errors gracefully', async () => {
    const handlerCall = safeHandle.mock.calls.find(
      (call) => call[1] === IPC_CHANNELS.SUGGESTIONS.GET_FILE_SUGGESTIONS
    );
    const handler = handlerCall[2];
    const mockService = new OrganizationSuggestionService();

    mockService.getSuggestionsForFile.mockRejectedValue(new Error('Service error'));

    const result = await handler({}, { file: { name: 'error.pdf' } }, mockService);

    expect(result).toEqual({
      success: false,
      error: 'Service error'
    });
  });
});
