/**
 * @jest-environment node
 */

const mockExposeInMainWorld = jest.fn();
const mockInvoke = jest.fn();
const mockOn = jest.fn();
const mockRemoveListener = jest.fn();
const mockSend = jest.fn();

jest.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mockExposeInMainWorld },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
    send: mockSend
  }
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
    checkRateLimit: jest.fn(() => true)
  }))
}));

jest.mock('../src/preload/ipcSanitizer', () => ({
  createIpcSanitizer: jest.fn(() => ({
    sanitizeArguments: jest.fn((args) => args)
  }))
}));

jest.mock('../src/preload/ipcValidator', () => ({
  createIpcValidator: jest.fn(() => ({
    validateResult: jest.fn((result) => result),
    validateEventSource: jest.fn(() => true),
    isValidSystemMetrics: jest.fn(() => true)
  }))
}));

jest.mock('../src/shared/pathSanitization', () => ({
  sanitizePath: jest.fn((p) => p)
}));

jest.mock('../src/shared/performanceConstants', () => ({
  LIMITS: {
    MAX_IPC_REQUESTS_PER_SECOND: 200,
    IPC_INVOKE_TIMEOUT: 50
  },
  TIMEOUTS: {
    DIRECTORY_SCAN: 75,
    AI_ANALYSIS_LONG: 120,
    AI_ANALYSIS_BATCH: 160
  }
}));

jest.mock('../src/shared/securityConfig', () => ({
  ALLOWED_RECEIVE_CHANNELS: ['operation-progress', 'system-metrics'],
  ALLOWED_SEND_CHANNELS: ['renderer-error-report']
}));

describe('preload timeout and retry behavior', () => {
  const getApi = () => {
    const exposeCall = mockExposeInMainWorld.mock.calls[0];
    if (!exposeCall) {
      throw new Error('electronAPI was not exposed');
    }
    return exposeCall[1];
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (channel) => {
      // Stub out the logging channel so it doesn't interfere with our tests
      if (channel === 'system:log') return { success: true };
      return new Promise(() => {}); // default to hanging
    });

    jest.resetModules();
    global.window = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };

    require('../src/preload/preload');
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('safeInvoke times out and rejects when invoke never resolves', async () => {
    // The default mockImplementation hangs for non-log channels
    const electronAPI = getApi();

    const pending = electronAPI.files.select().catch((error) => error);
    await jest.advanceTimersByTimeAsync(80);
    const error = await pending;

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('IPC timeout after 50ms');

    const selectCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'files:select');
    expect(selectCalls.length).toBe(1);
  });

  test('safeInvoke retries transient "No handler registered" errors with backoff', async () => {
    const noHandlerError = new Error('No handler registered for channel');
    let selectAttempt = 0;

    mockInvoke.mockImplementation(async (channel) => {
      if (channel === 'system:log') return { success: true };

      if (channel === 'files:select') {
        selectAttempt++;
        if (selectAttempt <= 2) {
          throw noHandlerError;
        }
        return { success: true, attempt: selectAttempt };
      }
      return new Promise(() => {});
    });

    const electronAPI = getApi();
    const pending = electronAPI.files.select();

    // In a test with fake timers and retries with Promises,
    // it's safest to simply execute pending microtasks completely before advancing time.
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(100);

    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(200);

    const result = await pending;

    expect(result).toEqual({ success: true, attempt: 3 });
    const selectCalls = mockInvoke.mock.calls.filter((c) => c[0] === 'files:select');
    expect(selectCalls.length).toBe(3);
  });
});
