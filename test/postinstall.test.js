/**
 * postinstall tests
 *
 * Ensures postinstall remains best-effort and never fails installs due to
 * optional dependency setup failures (Ollama/ChromaDB).
 */

const { main } = require('../scripts/postinstall');

describe('scripts/postinstall.js', () => {
  test('returns 0 even when dependency setup commands fail', () => {
    const spawnSyncImpl = jest
      .fn()
      // install-app-deps (not CI, not SKIP_APP_DEPS)
      .mockReturnValueOnce({ status: 0 })
      // setup-ollama fails (should be ignored)
      .mockReturnValueOnce({ status: 1, error: new Error('ollama missing') })
      // setup-chromadb fails (should be ignored)
      .mockReturnValueOnce({ status: 1, error: new Error('python missing') });

    const log = { warn: jest.fn(), log: jest.fn() };

    const code = main({
      env: { CI: 'false', SKIP_APP_DEPS: 'false' },
      platform: 'win32',
      spawnSyncImpl,
      log
    });

    expect(code).toBe(0);
    expect(spawnSyncImpl).toHaveBeenCalledTimes(4);
    // failures should be warned but not crash
    expect(log.warn).toHaveBeenCalled();
  });

  test('skips install-app-deps in CI and still runs setup scripts', () => {
    const spawnSyncImpl = jest.fn().mockReturnValue({ status: 0 });

    const code = main({
      env: { CI: 'true', SKIP_APP_DEPS: 'false' },
      platform: 'win32',
      spawnSyncImpl,
      log: { warn: jest.fn(), log: jest.fn() }
    });

    expect(code).toBe(0);
    // should run only setup scripts (3 commands)
    expect(spawnSyncImpl).toHaveBeenCalledTimes(3);
  });

  test('respects SKIP_APP_DEPS and skips install-app-deps when set', () => {
    const spawnSyncImpl = jest.fn().mockReturnValue({ status: 0 });

    const code = main({
      env: { CI: 'false', SKIP_APP_DEPS: 'true' },
      platform: 'win32',
      spawnSyncImpl,
      log: { warn: jest.fn(), log: jest.fn() }
    });

    expect(code).toBe(0);
    // should run only setup scripts (3 commands)
    expect(spawnSyncImpl).toHaveBeenCalledTimes(3);
  });
});
