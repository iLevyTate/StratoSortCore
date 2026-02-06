jest.mock('../src/shared/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  },
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    setContext: jest.fn()
  }))
}));

const { tracePathEvent } = require('../src/shared/pathTraceLogger');

describe('pathTraceLogger', () => {
  test('tracePathEvent returns structured event', () => {
    const event = tracePathEvent({
      stage_name: 'move-start',
      old_path: 'C:\\a.txt',
      new_path: 'C:\\b.txt',
      reason: 'user-move',
      source: 'test',
      success: true
    });
    expect(event.file_id).toMatch(/^file:/);
    expect(event.stage_name).toBe('move-start');
  });
});
