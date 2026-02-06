const mockExposeInMainWorld = jest.fn();
const mockIpcRenderer = {
  invoke: jest.fn(),
  send: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn()
};

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: mockIpcRenderer
}));

jest.mock('../src/shared/logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    setContext: jest.fn(),
    setLevel: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  })),
  LOG_LEVELS: { DEBUG: 'debug', INFO: 'info' }
}));

jest.mock('../src/preload/ipcRateLimiter', () => ({
  IpcRateLimiter: jest.fn().mockImplementation(() => ({
    checkRateLimit: jest.fn()
  }))
}));

jest.mock('../src/preload/ipcSanitizer', () => ({
  createIpcSanitizer: jest.fn(() => ({
    sanitizeArguments: (args) => args
  }))
}));

jest.mock('../src/preload/ipcValidator', () => ({
  createIpcValidator: jest.fn(() => ({
    validateEventSource: () => true,
    validateResult: (result) => result
  }))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  sanitizePath: jest.fn((p) => p)
}));

jest.mock('../src/shared/performanceConstants', () => ({
  LIMITS: { RATE_LIMIT_CLEANUP_THRESHOLD: 10 },
  TIMEOUTS: { IPC: 1000 }
}));

jest.mock('../src/shared/securityConfig', () => ({
  ALLOWED_RECEIVE_CHANNELS: [],
  ALLOWED_SEND_CHANNELS: []
}));

const mockChannelGroup = new Proxy(
  {},
  {
    get: (_t, prop) => `chan:${String(prop)}`
  }
);

jest.mock('../src/shared/constants', () => ({
  IPC_CHANNELS: {
    FILES: mockChannelGroup,
    SMART_FOLDERS: mockChannelGroup,
    ANALYSIS: mockChannelGroup,
    SETTINGS: mockChannelGroup,
    LLAMA: mockChannelGroup,
    UNDO_REDO: mockChannelGroup,
    ANALYSIS_HISTORY: mockChannelGroup,
    EMBEDDINGS: mockChannelGroup,
    SYSTEM: mockChannelGroup,
    WINDOW: mockChannelGroup,
    SUGGESTIONS: mockChannelGroup,
    ORGANIZE: mockChannelGroup,
    VECTOR_DB: mockChannelGroup,
    CHAT: mockChannelGroup,
    KNOWLEDGE: mockChannelGroup
  }
}));

describe('preload', () => {
  test('exposes electronAPI via contextBridge', () => {
    global.window = { addEventListener: jest.fn() };
    global.navigator = { platform: 'Win32' };
    require('../src/preload/preload');
    expect(mockExposeInMainWorld).toHaveBeenCalledWith('electronAPI', expect.any(Object));
  });
});
