// Create a more realistic mock of the electronAPI exposed by the preload script.
const electronAPI = {
  files: {
    select: jest.fn().mockResolvedValue({ canceled: false, filePaths: ['/test/file.txt'] }),
    selectDirectory: jest.fn().mockResolvedValue({ canceled: false, filePaths: ['/test/dir'] }),
    getDocumentsPath: jest.fn().mockResolvedValue('/test/documents'),
    createFolder: jest.fn().mockResolvedValue({ success: true }),
    normalizePath: jest.fn((p) => p),
    getStats: jest.fn().mockResolvedValue({ size: 1024, mtimeMs: Date.now() }),
    getDirectoryContents: jest.fn().mockResolvedValue(['file1.txt', 'file2.txt']),
    organize: jest.fn().mockResolvedValue({ success: true, results: [] }),
    performOperation: jest.fn().mockResolvedValue({ success: true, results: [] }),
    delete: jest.fn().mockResolvedValue({ success: true }),
    open: jest.fn().mockResolvedValue({ success: true }),
    reveal: jest.fn().mockResolvedValue({ success: true }),
    copy: jest.fn().mockResolvedValue({ success: true }),
    openFolder: jest.fn().mockResolvedValue({ success: true }),
    analyze: jest.fn().mockResolvedValue({
      suggestedName: 'analyzed-file.txt',
      category: 'test'
    })
  },
  smartFolders: {
    get: jest.fn().mockResolvedValue([]),
    save: jest.fn().mockResolvedValue({ success: true }),
    updateCustom: jest.fn().mockResolvedValue({ success: true }),
    getCustom: jest.fn().mockResolvedValue([]),
    scanStructure: jest.fn().mockResolvedValue({ success: true, folders: [] }),
    add: jest.fn().mockResolvedValue({ success: true }),
    edit: jest.fn().mockResolvedValue({ success: true }),
    delete: jest.fn().mockResolvedValue({ success: true }),
    match: jest.fn().mockResolvedValue({ success: true, match: null })
  },
  analysis: {
    document: jest.fn().mockResolvedValue({ suggestedName: 'document.txt', category: 'docs' }),
    image: jest.fn().mockResolvedValue({ suggestedName: 'image.png', category: 'images' }),
    extractText: jest.fn().mockResolvedValue({ success: true, text: 'extracted text' })
  },
  analysisHistory: {
    get: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue([]),
    getStatistics: jest.fn().mockResolvedValue({ total: 0 }),
    getFileHistory: jest.fn().mockResolvedValue([]),
    clear: jest.fn().mockResolvedValue({ success: true }),
    export: jest.fn().mockResolvedValue({ success: true })
  },
  embeddings: {
    rebuildFolders: jest.fn().mockResolvedValue({ success: true }),
    rebuildFiles: jest.fn().mockResolvedValue({ success: true }),
    clearStore: jest.fn().mockResolvedValue({ success: true })
  },
  suggestions: {
    getFileSuggestions: jest.fn().mockResolvedValue([]),
    getBatchSuggestions: jest.fn().mockResolvedValue([]),
    recordFeedback: jest.fn().mockResolvedValue({ success: true }),
    getStrategies: jest.fn().mockResolvedValue([]),
    applyStrategy: jest.fn().mockResolvedValue({ success: true }),
    getUserPatterns: jest.fn().mockResolvedValue([]),
    clearPatterns: jest.fn().mockResolvedValue({ success: true }),
    analyzeFolderStructure: jest.fn().mockResolvedValue({ success: true }),
    suggestNewFolder: jest.fn().mockResolvedValue({ success: true })
  },
  organize: {
    auto: jest.fn().mockResolvedValue({ success: true }),
    batch: jest.fn().mockResolvedValue({ success: true }),
    processNew: jest.fn().mockResolvedValue({ success: true }),
    getStats: jest.fn().mockResolvedValue({ total: 0 }),
    updateThresholds: jest.fn().mockResolvedValue({ success: true })
  },
  undoRedo: {
    undo: jest.fn().mockResolvedValue({ success: true }),
    redo: jest.fn().mockResolvedValue({ success: true }),
    getHistory: jest.fn().mockResolvedValue([]),
    clear: jest.fn().mockResolvedValue({ success: true }),
    canUndo: jest.fn().mockResolvedValue(false),
    canRedo: jest.fn().mockResolvedValue(false)
  },
  system: {
    getMetrics: jest.fn().mockResolvedValue({ cpu: 0, mem: 0 }),
    getApplicationStatistics: jest.fn().mockResolvedValue({ files: 0 }),
    applyUpdate: jest.fn().mockResolvedValue(undefined)
  },
  window: {
    minimize: jest.fn(),
    maximize: jest.fn(),
    unmaximize: jest.fn(),
    toggleMaximize: jest.fn(),
    isMaximized: jest.fn().mockResolvedValue(false),
    close: jest.fn()
  },
  ollama: {
    getModels: jest.fn().mockResolvedValue([]),
    testConnection: jest.fn().mockResolvedValue({ success: true }),
    pullModels: jest.fn().mockResolvedValue({ success: true }),
    deleteModel: jest.fn().mockResolvedValue({ success: true })
  },
  events: {
    onOperationProgress: jest.fn(() => () => {}),
    onAppError: jest.fn(() => () => {}),
    onAppUpdate: jest.fn(() => () => {})
  },
  settings: {
    get: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockResolvedValue({ success: true })
  }
};

module.exports = {
  contextBridge: {
    exposeInMainWorld: jest.fn((apiKey, api) => {
      if (apiKey === 'electronAPI') {
        global.window.electronAPI = api;
      }
    })
  },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
    removeListener: jest.fn()
  },
  ipcMain: {
    _handlers: new Map(),
    handle: jest.fn(function (channel, handler) {
      module.exports.ipcMain._handlers.set(channel, handler);
    })
  },
  dialog: {
    showOpenDialog: jest.fn().mockResolvedValue({ canceled: true, filePaths: [] })
  },
  shell: {
    openPath: jest.fn().mockResolvedValue(null),
    showItemInFolder: jest.fn()
  },
  app: {
    getPath: jest.fn(() => '/test/path'),
    on: jest.fn(),
    once: jest.fn(),
    quit: jest.fn()
  },
  // Expose the mock API for tests to use
  electronAPI: electronAPI
};

// Also attach the mock to the global window object for tests that access it directly
if (typeof global.window !== 'undefined') {
  global.window.electronAPI = electronAPI;
}
