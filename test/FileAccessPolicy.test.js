/**
 * Tests for FileAccessPolicy
 */

jest.mock('../src/shared/logger', () => ({
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  })
}));

const FileAccessPolicy = require('../src/main/services/FileAccessPolicy');

describe('FileAccessPolicy', () => {
  test('sanitizeFilename replaces invalid characters', () => {
    const policy = new FileAccessPolicy();
    const result = policy.sanitizeFilename('bad<>:"/\\|?*name.txt');
    expect(result).toBe('bad_________name.txt');
  });

  test('sanitizeFilename handles reserved names', () => {
    const policy = new FileAccessPolicy();
    const result = policy.sanitizeFilename('con.txt');
    expect(result.startsWith('_')).toBe(true);
  });

  test('sanitizeFilename trims dots and spaces', () => {
    const policy = new FileAccessPolicy();
    expect(policy.sanitizeFilename('  .file.  ')).toBe('file');
  });

  test('sanitizeFilename returns fallback for empty input', () => {
    const policy = new FileAccessPolicy();
    expect(policy.sanitizeFilename('')).toBe('unnamed_file');
  });

  test('isPathSafe rejects hidden files', () => {
    const policy = new FileAccessPolicy();
    expect(policy.isPathSafe('/tmp/.secret')).toBe(false);
  });

  test('isPathSafe rejects unsafe segments', () => {
    const policy = new FileAccessPolicy();
    expect(policy.isPathSafe('/tmp/node_modules/file.txt')).toBe(false);
  });

  test('isPathSafe accepts normal paths', () => {
    const policy = new FileAccessPolicy();
    expect(policy.isPathSafe('/tmp/docs/file.txt')).toBe(true);
  });
});
