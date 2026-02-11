const { createIpcValidator } = require('../src/preload/ipcValidator');

describe('ipcValidator', () => {
  test('validateEventSource requires sender object', () => {
    const { validateEventSource } = createIpcValidator();
    expect(validateEventSource(null)).toBe(false);
    expect(validateEventSource({})).toBe(false);
    expect(validateEventSource({ sender: {} })).toBe(true);
  });

  test('validateResult handles system metrics', () => {
    const { validateResult } = createIpcValidator();
    const result = validateResult({ uptime: 10 }, 'system:get-metrics');
    expect(result).toEqual({ uptime: 10 });
    expect(validateResult(null, 'system:get-metrics')).toBeNull();
  });

  test('validateResult handles select-directory fallback', () => {
    const { validateResult } = createIpcValidator();
    const result = validateResult(null, 'files:select-directory');
    expect(result).toEqual({ success: false, path: null });
  });

  test('rejects oversized payloads for generic channels', () => {
    const { validateResult } = createIpcValidator();
    const huge = { value: 'x'.repeat(500001) };
    expect(validateResult(huge, 'llama:get-models')).toBeNull();
  });

  test('applies safe fallback for oversized select-directory payload', () => {
    const { validateResult } = createIpcValidator();
    const huge = { value: 'x'.repeat(500001) };
    expect(validateResult(huge, 'files:select-directory')).toEqual({ success: false, path: null });
  });
});
