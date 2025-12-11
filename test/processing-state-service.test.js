// This test needs real filesystem operations, so unmock fs and os
jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('os');

const fs = require('fs').promises;
const path = require('path');
const os = jest.requireActual('os');

describe('ProcessingStateService', () => {
  let tmpDir;
  let testId = 0;

  beforeEach(async () => {
    // Use unique directory per test to avoid file locking issues
    testId++;
    tmpDir = path.join(
      os.tmpdir(),
      `stratosort-processing-${Date.now()}-${testId}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(tmpDir, { recursive: true });

    // Reset modules but re-apply unmocks after
    jest.resetModules();
    jest.unmock('fs');
    jest.unmock('fs/promises');
    jest.unmock('os');

    const electron = require('./mocks/electron');
    electron.app.getPath.mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    // Small delay before cleanup to allow file handles to be released
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch (error) {
      if (error) {
        // Ignore cleanup errors
      }
    }
  });

  test('tracks analysis jobs lifecycle', async () => {
    const ProcessingStateService = require('../src/main/services/ProcessingStateService');
    const svc = new ProcessingStateService();
    const file = path.join(tmpDir, 'doc.pdf');

    await svc.markAnalysisStart(file);
    expect(svc.getIncompleteAnalysisJobs().length).toBe(1);

    await svc.markAnalysisComplete(file);
    expect(svc.getIncompleteAnalysisJobs().length).toBe(0);
  });

  test('creates and completes organize batch with progress updates', async () => {
    const ProcessingStateService = require('../src/main/services/ProcessingStateService');
    const svc = new ProcessingStateService();
    const batchId = 'batch-test';
    const ops = [
      { source: '/from/a.txt', destination: '/to/a.txt' },
      { source: '/from/b.txt', destination: '/to/b.txt' }
    ];

    // Small delay helper to avoid Windows file locking issues during rapid successive writes
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const WRITE_DELAY = process.platform === 'win32' ? 100 : 10;

    const batch = await svc.createOrLoadOrganizeBatch(batchId, ops);
    expect(batch.operations.length).toBe(2);
    expect(batch.operations[0].status).toBe('pending');

    await delay(WRITE_DELAY); // Allow file handles to be released
    await svc.markOrganizeOpStarted(batchId, 0);
    await delay(WRITE_DELAY);
    await svc.markOrganizeOpDone(batchId, 0);
    await delay(WRITE_DELAY);
    await svc.markOrganizeOpError(batchId, 1, 'Disk full');
    await delay(WRITE_DELAY);
    await svc.completeOrganizeBatch(batchId);

    const incomplete = svc.getIncompleteOrganizeBatches();
    expect(Array.isArray(incomplete)).toBe(true);
    expect(incomplete.length === 0 || incomplete.every((b) => !!b.completedAt)).toBe(true);
  });
});
