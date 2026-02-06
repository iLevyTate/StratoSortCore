const { IpcRateLimiter } = require('../src/preload/ipcRateLimiter');

describe('IpcRateLimiter', () => {
  test('checkRateLimit enforces max per second', () => {
    const limiter = new IpcRateLimiter({
      maxRequestsPerSecond: 2,
      perfLimits: { RATE_LIMIT_CLEANUP_THRESHOLD: 10, RATE_LIMIT_STALE_MS: 1000 }
    });

    expect(limiter.checkRateLimit('test')).toBe(true);
    expect(limiter.checkRateLimit('test')).toBe(true);
    expect(() => limiter.checkRateLimit('test')).toThrow(/Rate limit exceeded/);
  });

  test('cleanup removes stale entries', () => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    const limiter = new IpcRateLimiter({
      maxRequestsPerSecond: 5,
      perfLimits: { RATE_LIMIT_CLEANUP_THRESHOLD: 0, RATE_LIMIT_STALE_MS: 0 }
    });

    limiter.checkRateLimit('a');
    jest.setSystemTime(2000);
    jest.runAllTimers();
    expect(limiter.rateLimiter.size).toBe(0);
    jest.useRealTimers();
  });
});
