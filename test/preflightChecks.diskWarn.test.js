/**
 * Tests for preflightChecks disk space warning propagation fix
 *
 * Verifies that when disk space < 10GB, the check correctly
 * reports 'warn' status instead of silently swallowing it as 'ok'.
 */

jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    mkdir: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn()
  }
}));

jest.mock('fs/promises', () => ({
  statfs: jest.fn()
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn()
  }
}));

jest.mock('../src/shared/logger', () => ({
  createLogger: jest.fn(() => ({
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }))
}));

jest.mock('../src/shared/promiseUtils', () => ({
  withTimeout: jest.fn((promise) => promise)
}));

jest.mock('../src/main/services/LlamaService', () => ({
  getInstance: jest.fn()
}));

const fs = require('fs').promises;
const { statfs } = require('fs/promises');
const { app } = require('electron');
const { getInstance } = require('../src/main/services/LlamaService');
const { runPreflightChecks } = require('../src/main/services/startup/preflightChecks');

describe('preflightChecks - disk space warning', () => {
  const mockLlamaService = {
    testConnection: jest.fn().mockResolvedValue({ success: true }),
    getConfig: jest.fn().mockResolvedValue({ textModel: 'a' }),
    listModels: jest.fn().mockResolvedValue([{ name: 'a' }])
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app.getPath.mockReturnValue('C:/user-data');
    fs.access.mockResolvedValue();
    fs.writeFile.mockResolvedValue();
    fs.unlink.mockResolvedValue();
    getInstance.mockReturnValue(mockLlamaService);
  });

  test('propagates warn status when disk space < 10GB', async () => {
    // Simulate 5GB free: bavail * bsize = 5GB
    const bsize = 4096;
    const bavail = Math.floor((5 * 1024 * 1024 * 1024) / bsize);
    statfs.mockResolvedValue({ bavail, bsize });

    const errors = [];
    const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

    const diskCheck = checks.find((c) => c.name === 'Disk Space');
    expect(diskCheck).toBeDefined();
    expect(diskCheck.status).toBe('warn');
    expect(diskCheck.message).toMatch(/Low disk space/);
    expect(diskCheck.message).toContain('5.0');

    // Should also add a non-critical error
    const diskError = errors.find((e) => e.check === 'disk-space');
    expect(diskError).toBeDefined();
    expect(diskError.critical).toBe(false);
  });

  test('reports ok status when disk space >= 10GB', async () => {
    // Simulate 50GB free
    const bsize = 4096;
    const bavail = Math.floor((50 * 1024 * 1024 * 1024) / bsize);
    statfs.mockResolvedValue({ bavail, bsize });

    const errors = [];
    const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

    const diskCheck = checks.find((c) => c.name === 'Disk Space');
    expect(diskCheck).toBeDefined();
    expect(diskCheck.status).toBe('ok');
    expect(diskCheck.freeGB).toBeCloseTo(50, 0);

    // No disk error should be added
    expect(errors.find((e) => e.check === 'disk-space')).toBeUndefined();
  });

  test('reports ok when statfs is unavailable', async () => {
    statfs.mockRejectedValue(new Error('Not supported'));

    const errors = [];
    const checks = await runPreflightChecks({ reportProgress: jest.fn(), errors });

    const diskCheck = checks.find((c) => c.name === 'Disk Space');
    expect(diskCheck).toBeDefined();
    // Should still be ok (non-fatal)
    expect(diskCheck.status).toBe('ok');
  });
});
