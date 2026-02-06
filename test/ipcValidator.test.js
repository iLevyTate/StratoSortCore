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
});
