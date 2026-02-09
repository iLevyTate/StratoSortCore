/**
 * Tests for asyncSpawnUtils listener cleanup after process exit.
 *
 * Verifies that child process stdout/stderr/close/error listeners
 * are removed after resolution (close, error, or timeout).
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }))
}));

/**
 * Create a mock child process that tracks listeners manually.
 * Avoids EventEmitter's special 'error' throw-on-unhandled behavior.
 */
function makeEmitter() {
  const ls = {};
  return {
    on(event, fn) {
      (ls[event] = ls[event] || []).push(fn);
    },
    emit(event, ...args) {
      (ls[event] || []).slice().forEach((fn) => fn(...args));
    },
    removeAllListeners(event) {
      if (event) {
        delete ls[event];
      } else {
        Object.keys(ls).forEach((k) => delete ls[k]);
      }
    },
    listenerCount(event) {
      return (ls[event] || []).length;
    }
  };
}

// Module-level mock for child_process (hoisted by Jest)
const mockSpawnFn = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawnFn
}));

describe('asyncSpawnUtils - listener cleanup after process exit', () => {
  let asyncSpawn;

  function createMockChild() {
    const child = makeEmitter();
    child.stdout = makeEmitter();
    child.stderr = makeEmitter();
    child.kill = jest.fn();
    return child;
  }

  beforeEach(() => {
    jest.resetModules();
    mockSpawnFn.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('removes all listeners after process closes', async () => {
    const mockChild = createMockChild();
    mockSpawnFn.mockReturnValue(mockChild);

    ({ asyncSpawn } = require('../src/main/utils/asyncSpawnUtils'));
    const resultPromise = asyncSpawn('echo', ['hello'], { timeout: 99999 });

    // Verify listeners are registered
    expect(mockChild.listenerCount('close')).toBeGreaterThan(0);
    expect(mockChild.listenerCount('error')).toBeGreaterThan(0);
    expect(mockChild.stdout.listenerCount('data')).toBeGreaterThan(0);

    // Emit data then close
    mockChild.stdout.emit('data', 'hello');
    mockChild.emit('close', 0, null);

    const result = await resultPromise;
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('hello');

    // Verify all listeners were removed by cleanupChild
    expect(mockChild.listenerCount('close')).toBe(0);
    expect(mockChild.listenerCount('error')).toBe(0);
    expect(mockChild.stdout.listenerCount('data')).toBe(0);
    expect(mockChild.stderr.listenerCount('data')).toBe(0);
  });

  test('removes all listeners on timeout', async () => {
    jest.useFakeTimers();

    const mockChild = createMockChild();
    mockSpawnFn.mockReturnValue(mockChild);

    ({ asyncSpawn } = require('../src/main/utils/asyncSpawnUtils'));
    const resultPromise = asyncSpawn('slow-cmd', [], { timeout: 1000 });

    // Verify listeners are registered before timeout
    expect(mockChild.listenerCount('close')).toBeGreaterThan(0);

    // Advance past the timeout
    await jest.advanceTimersByTimeAsync(1100);

    const result = await resultPromise;
    expect(result.timedOut).toBe(true);
    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Verify all listeners were removed by cleanupChild
    expect(mockChild.listenerCount('close')).toBe(0);
    expect(mockChild.listenerCount('error')).toBe(0);
    expect(mockChild.stdout.listenerCount('data')).toBe(0);
    expect(mockChild.stderr.listenerCount('data')).toBe(0);
  });

  test('removes all listeners on process error', async () => {
    const mockChild = createMockChild();
    mockSpawnFn.mockReturnValue(mockChild);

    ({ asyncSpawn } = require('../src/main/utils/asyncSpawnUtils'));
    const resultPromise = asyncSpawn('bad-cmd', [], { timeout: 99999 });

    // Verify error listener is registered before emitting
    expect(mockChild.listenerCount('error')).toBeGreaterThan(0);

    // Simulate process error
    mockChild.emit('error', new Error('spawn failed'));

    const result = await resultPromise;
    expect(result.error.message).toBe('spawn failed');

    // Verify all listeners were removed by cleanupChild
    expect(mockChild.listenerCount('close')).toBe(0);
    expect(mockChild.listenerCount('error')).toBe(0);
    expect(mockChild.stdout.listenerCount('data')).toBe(0);
    expect(mockChild.stderr.listenerCount('data')).toBe(0);
  });
});
