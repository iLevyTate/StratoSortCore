/**
 * Extended tests for batchRollback
 * Covers: empty operations, all-fail, manifest write failure,
 * reverse order verification, result structure, recovery path
 */

jest.mock('electron', () => jest.requireActual('./mocks/electron'));

const mockFsPromises = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  rename: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined)
};

const mockCrossDeviceMove = jest.fn().mockResolvedValue(undefined);

jest.mock('fs', () => ({
  promises: mockFsPromises
}));

jest.mock('../src/shared/atomicFileOperations', () => ({
  crossDeviceMove: mockCrossDeviceMove
}));

const { executeRollback } = require('../src/main/ipc/files/batchRollback');

describe('executeRollback - extended coverage', () => {
  let log;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-establish default resolved implementations after clearAllMocks
    mockFsPromises.mkdir.mockResolvedValue(undefined);
    mockFsPromises.writeFile.mockResolvedValue(undefined);
    mockFsPromises.readFile.mockReset();
    mockFsPromises.rename.mockResolvedValue(undefined);
    mockFsPromises.unlink.mockResolvedValue(undefined);
    mockCrossDeviceMove.mockResolvedValue(undefined);
    log = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
  });

  test('handles empty operations list', async () => {
    const result = await executeRollback([], [], 0, 'empty', 'batch-empty', log);

    expect(result.rolledBack).toBe(true);
    expect(result.rollbackSuccessCount).toBe(0);
    expect(result.rollbackFailCount).toBe(0);
    expect(result.rollbackResults).toEqual([]);
    expect(result.summary).toContain('0/0');
  });

  test('result structure contains all expected fields', async () => {
    const result = await executeRollback(
      [{ source: '/a.txt', destination: '/b.txt' }],
      [{ success: true }],
      1,
      'test reason',
      'batch-structure',
      log
    );

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        rolledBack: true,
        rollbackReason: 'test reason',
        results: [{ success: true }],
        rollbackResults: expect.any(Array),
        successCount: 0,
        failCount: 1,
        rollbackSuccessCount: expect.any(Number),
        rollbackFailCount: expect.any(Number),
        summary: expect.any(String),
        batchId: 'batch-structure',
        recoveryPath: expect.any(String),
        criticalError: true
      })
    );
  });

  test('processes operations in reverse order', async () => {
    const rollbackRenames = [];
    let callIndex = 0;
    mockFsPromises.rename.mockImplementation(async (from, to) => {
      callIndex++;
      // Skip the first rename call which is writeFileAtomic (tmp -> manifest)
      if (callIndex > 1) {
        rollbackRenames.push(from);
      }
    });

    const ops = [
      { source: '/src/first.txt', destination: '/dst/first.txt' },
      { source: '/src/second.txt', destination: '/dst/second.txt' },
      { source: '/src/third.txt', destination: '/dst/third.txt' }
    ];

    await executeRollback(ops, [], 0, 'test', 'batch-order', log);

    // Should reverse: third, second, first
    expect(rollbackRenames[0]).toBe('/dst/third.txt');
    expect(rollbackRenames[1]).toBe('/dst/second.txt');
    expect(rollbackRenames[2]).toBe('/dst/first.txt');
  });

  test('all operations fail - manifest updated with partial_failure', async () => {
    mockFsPromises.rename.mockRejectedValue(new Error('All fail'));
    mockFsPromises.readFile.mockResolvedValue(JSON.stringify({ status: 'pending', results: [] }));

    const ops = [
      { source: '/a.txt', destination: '/da.txt' },
      { source: '/b.txt', destination: '/db.txt' }
    ];

    const result = await executeRollback(ops, [], 2, 'test', 'batch-allfail', log);

    expect(result.rollbackSuccessCount).toBe(0);
    expect(result.rollbackFailCount).toBe(2);
    expect(result.rollbackResults.every((r) => r.success === false)).toBe(true);
    expect(result.rollbackResults.every((r) => r.error)).toBe(true);

    // Manifest should be updated, not deleted
    const lastWrite =
      mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
    const manifest = JSON.parse(lastWrite[1]);
    expect(manifest.status).toBe('partial_failure');
    expect(manifest.results).toHaveLength(2);
  });

  test('manifest write failure does not stop rollback', async () => {
    mockFsPromises.writeFile.mockRejectedValueOnce(new Error('Disk full'));

    const ops = [{ source: '/a.txt', destination: '/b.txt' }];
    const result = await executeRollback(ops, [], 1, 'test', 'batch-nomanifest', log);

    // Rollback should still proceed
    expect(result.rollbackSuccessCount).toBe(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to save recovery manifest')
    );
    // recoveryPath is set before writeFile, so it's still the intended path
    // even though the write failed
    expect(result.recoveryPath).toContain('rollback_batch-nomanifest.json');
  });

  test('rollback results include file paths', async () => {
    const ops = [
      { source: '/src/file1.txt', destination: '/dst/file1.txt' },
      { source: '/src/file2.txt', destination: '/dst/file2.txt' }
    ];

    const result = await executeRollback(ops, [], 0, 'test', 'batch-files', log);

    expect(result.rollbackResults).toEqual([
      { success: true, file: '/src/file2.txt' },
      { success: true, file: '/src/file1.txt' }
    ]);
  });

  test('EXDEV triggers crossDeviceMove with parent dir creation', async () => {
    const exdevError = new Error('EXDEV');
    exdevError.code = 'EXDEV';
    // First rename is from writeFileAtomic (manifest creation) - let it succeed.
    // Second rename is the actual rollback rename - throw EXDEV.
    mockFsPromises.rename
      .mockResolvedValueOnce(undefined) // writeFileAtomic: tmp -> manifest
      .mockRejectedValueOnce(exdevError); // rollback rename

    const ops = [
      { source: '/mnt/drive2/deep/nested/file.txt', destination: '/mnt/drive1/file.txt' }
    ];

    await executeRollback(ops, [], 1, 'test', 'batch-exdev', log);

    expect(mockFsPromises.mkdir).toHaveBeenCalledWith('/mnt/drive2/deep/nested', {
      recursive: true
    });
    expect(mockCrossDeviceMove).toHaveBeenCalledWith(
      '/mnt/drive1/file.txt',
      '/mnt/drive2/deep/nested/file.txt',
      { verify: true }
    );
  });

  test('non-EXDEV rename error propagates as rollback failure', async () => {
    const permError = new Error('Permission denied');
    permError.code = 'EACCES';
    // First rename is writeFileAtomic (manifest creation) - succeeds.
    // Second rename is the rollback rename - fails with EACCES.
    mockFsPromises.rename
      .mockResolvedValueOnce(undefined) // writeFileAtomic: tmp -> manifest
      .mockRejectedValueOnce(permError) // rollback rename fails
      .mockResolvedValueOnce(undefined); // writeFileAtomic: tmp -> manifest (update)
    mockFsPromises.readFile.mockResolvedValue(JSON.stringify({ status: 'pending', results: [] }));

    const ops = [{ source: '/a.txt', destination: '/b.txt' }];
    const result = await executeRollback(ops, [], 1, 'test', 'batch-perm', log);

    expect(result.rollbackFailCount).toBe(1);
    expect(result.rollbackResults[0]).toEqual({
      success: false,
      file: '/a.txt',
      error: 'Permission denied'
    });
  });

  test('manifest update failure is handled gracefully', async () => {
    // writeFileAtomic for initial manifest:
    //   writeFile(tmp) succeeds, rename(tmp -> manifest) succeeds
    mockFsPromises.writeFile.mockResolvedValueOnce(undefined);
    mockFsPromises.rename
      .mockResolvedValueOnce(undefined) // writeFileAtomic: tmp -> manifest (creation)
      .mockRejectedValueOnce(new Error('fail')) // rollback rename fails
      .mockResolvedValueOnce(undefined); // writeFileAtomic: tmp -> manifest (update attempt)

    // readFile for manifest update succeeds
    mockFsPromises.readFile.mockResolvedValueOnce(
      JSON.stringify({ status: 'pending', results: [] })
    );
    // Second writeFile (manifest update via writeFileAtomic) fails
    mockFsPromises.writeFile.mockRejectedValueOnce(new Error('Write failed'));

    const ops = [{ source: '/a.txt', destination: '/b.txt' }];
    const result = await executeRollback(ops, [], 1, 'test', 'batch-updatefail', log);

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update recovery manifest')
    );
    // Should still return result
    expect(result.rolledBack).toBe(true);
  });

  test('logs rollback summary with correct counts', async () => {
    mockFsPromises.rename.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('fail'));
    mockFsPromises.readFile.mockResolvedValue(JSON.stringify({ status: 'pending', results: [] }));

    const ops = [
      { source: '/a.txt', destination: '/da.txt' },
      { source: '/b.txt', destination: '/db.txt' }
    ];

    await executeRollback(ops, [], 2, 'mixed', 'batch-mixed', log);

    const summaryCall = log.warn.mock.calls.find(
      ([msg]) => typeof msg === 'string' && msg.includes('Rollback summary')
    );
    expect(summaryCall).toBeDefined();
    expect(summaryCall[1]).toEqual(
      expect.objectContaining({
        batchId: 'batch-mixed',
        completed: 2
      })
    );
  });
});
