const { ipcMain } = require('./mocks/electron');

jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});

// Force deterministic similarity in tests by using simple vectors
jest.mock('../src/main/services/FolderMatchingService', () => {
  const embedText = jest.fn();
  const service = {
    initialize: jest.fn().mockResolvedValue(undefined),
    embedText
  };
  return {
    getInstance: jest.fn(() => service),
    __service: service,
    __embedText: embedText
  };
});

jest.mock('../src/main/services/LlamaService', () => {
  const llama = {
    initialize: jest.fn().mockResolvedValue(undefined),
    generateText: jest.fn().mockResolvedValue({ response: '{"index":1,"reason":"ok"}' })
  };
  return {
    getInstance: jest.fn(() => llama),
    __llama: llama
  };
});

jest.mock('../src/shared/promiseUtils', () => ({
  ...jest.requireActual('../src/shared/promiseUtils'),
  withAbortableTimeout: jest.fn(async (fn) => fn({ signal: new AbortController().signal }))
}));

describe('SmartFolders IPC - MATCH', () => {
  beforeEach(() => {
    ipcMain._handlers.clear();
    ipcMain.handle.mockClear();
    jest.clearAllMocks();
  });

  function register() {
    const registerSmartFoldersIpc = require('../src/main/ipc/smartFolders');
    const { IPC_CHANNELS } = require('../src/shared/constants');

    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

    registerSmartFoldersIpc({
      ipcMain,
      IPC_CHANNELS,
      logger,
      getCustomFolders: jest.fn(() => []),
      setCustomFolders: jest.fn(async () => ({ success: true })),
      saveCustomFolders: jest.fn(async () => ({ success: true })),
      scanDirectory: jest.fn(async () => ({ success: true })),
      getServiceIntegration: jest.fn(() => ({ smartFolderWatcher: null }))
    });

    return { IPC_CHANNELS };
  }

  test('embeddings path enriches filename-like input (extension) and selects best folder', async () => {
    const { IPC_CHANNELS } = register();
    const semanticExt = require('../src/main/analysis/semanticExtensionMap');
    const folderMatching = require('../src/main/services/FolderMatchingService');

    // Query embedding: ensure first embedText call corresponds to enriched query text
    const filename = 'project-report.md';
    const enrichedQuery = semanticExt.enrichFileTextForEmbedding(filename, '.md');
    folderMatching.__embedText.mockImplementation(async (text) => {
      const t = String(text);
      // Query embedding
      if (t === enrichedQuery) return { vector: [1, 0], model: 'mock' };

      // Folder embeddings
      if (t.toLowerCase().includes('finance')) return { vector: [1, 0], model: 'mock' };
      return { vector: [0, 1], model: 'mock' };
    });

    const handler = ipcMain._handlers.get(IPC_CHANNELS.SMART_FOLDERS.MATCH);

    const res = await handler(null, {
      text: filename,
      smartFolders: [
        { id: 'p', name: 'Projects', description: 'Project reports and planning' },
        { id: 'f', name: 'Finance', description: 'Budgets, invoices, financial statements' }
      ]
    });

    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        method: 'embeddings',
        folder: expect.objectContaining({ name: 'Finance' })
      })
    );

    // First call to embedText should be for the query and should be enriched
    expect(folderMatching.__embedText).toHaveBeenCalledWith(enrichedQuery);
  });

  test('falls back to LLM when embedding generation throws', async () => {
    const { IPC_CHANNELS } = register();
    const folderMatching = require('../src/main/services/FolderMatchingService');

    folderMatching.__embedText.mockRejectedValue(new Error('embedding failed'));

    const handler = ipcMain._handlers.get(IPC_CHANNELS.SMART_FOLDERS.MATCH);
    const res = await handler(null, {
      text: 'contract.txt',
      smartFolders: [
        { id: 'legal', name: 'Legal', description: 'Contracts and compliance' },
        { id: 'misc', name: 'Misc', description: '' }
      ]
    });

    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        method: 'llm',
        folder: expect.objectContaining({ name: 'Legal' })
      })
    );
  });

  test('falls back to keyword scoring if embeddings and LLM fail', async () => {
    const { IPC_CHANNELS } = register();
    const folderMatching = require('../src/main/services/FolderMatchingService');
    const llama = require('../src/main/services/LlamaService');

    folderMatching.__embedText.mockRejectedValue(new Error('embedding failed'));
    llama.__llama.generateText.mockRejectedValue(new Error('llm down'));

    const handler = ipcMain._handlers.get(IPC_CHANNELS.SMART_FOLDERS.MATCH);

    // Representative excerpt from `test/test-files/project-report.md`
    const reportText =
      '# PROJECT STATUS REPORT\n' +
      'Project Name: Stratosort AI Integration\n' +
      'The team has successfully integrated in-process AI capabilities.\n' +
      'Expected Folder: Projects/Reports\n';

    const res = await handler(null, {
      text: reportText,
      smartFolders: [
        { id: 'projects', name: 'Projects', description: 'Project report status milestones' },
        { id: 'audio', name: 'Audio', description: 'Music and mp3 files' }
      ]
    });

    expect(res).toEqual(
      expect.objectContaining({
        success: true,
        method: 'fallback',
        folder: expect.objectContaining({ name: 'Projects' })
      })
    );
  });
});
