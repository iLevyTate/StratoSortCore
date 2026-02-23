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

describe('executeRollback', () => {
  let log;

  beforeEach(() => {
    jest.clearAllMocks();
    log = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
  });

  test('creates recovery manifest and deletes it on full success', async () => {
    const completedOperations = [
      { source: '/src/a.txt', destination: '/dst/a.txt' },
      { source: '/src/b.txt', destination: '/dst/b.txt' }
    ];

    const result = await executeRollback(
      completedOperations,
      [{ success: true }, { success: true }],
      0,
      'test',
      'batch-1',
      log
    );

    expect(mockFsPromises.mkdir).toHaveBeenCalled();
    expect(mockFsPromises.writeFile).toHaveBeenCalled();

    const [tmpPath, manifestJson] = mockFsPromises.writeFile.mock.calls[0];
    expect(JSON.parse(manifestJson).status).toBe('pending');

    // writeFileAtomic writes to a tmp file then renames it to the manifest path,
    // plus 2 rollback renames = 3 total rename calls
    expect(mockFsPromises.rename).toHaveBeenCalledTimes(3);
    // The manifest path is the second arg of the first rename call (writeFileAtomic)
    const manifestPath = mockFsPromises.rename.mock.calls[0][1];
    expect(manifestPath).toContain('rollback_batch-1.json');
    expect(mockFsPromises.unlink).toHaveBeenCalledWith(manifestPath);
    expect(result.rolledBack).toBe(true);
    expect(result.rollbackFailCount).toBe(0);
  });

  test('uses cross-device move on EXDEV errors', async () => {
    const exdevError = new Error('EXDEV');
    exdevError.code = 'EXDEV';
    // First rename call is from writeFileAtomic (manifest creation) - let it succeed.
    // Second rename call is the actual rollback rename - make it throw EXDEV.
    mockFsPromises.rename
      .mockResolvedValueOnce(undefined) // writeFileAtomic: tmp -> manifest
      .mockRejectedValueOnce(exdevError); // rollback rename: dst -> src

    await executeRollback(
      [{ source: '/src/a.txt', destination: '/dst/a.txt' }],
      [],
      1,
      'test',
      'batch-2',
      log
    );

    expect(mockFsPromises.mkdir).toHaveBeenCalledWith('/src', { recursive: true });
    expect(mockCrossDeviceMove).toHaveBeenCalledWith('/dst/a.txt', '/src/a.txt', { verify: true });
  });

  test('updates recovery manifest on partial failure', async () => {
    // writeFileAtomic for initial manifest: writeFile(tmp) + rename(tmp -> manifest) succeed.
    // Then rollback renames: first rollback op fails (reversed order: b.txt first),
    // second rollback op succeeds.
    mockFsPromises.rename
      .mockResolvedValueOnce(undefined) // writeFileAtomic: tmp -> manifest
      .mockRejectedValueOnce(new Error('Rename failed')) // rollback of b.txt fails
      .mockResolvedValueOnce(undefined) // rollback of a.txt succeeds
      .mockResolvedValueOnce(undefined); // writeFileAtomic: tmp -> manifest (update)

    mockFsPromises.readFile.mockResolvedValueOnce(
      JSON.stringify({ status: 'pending', results: [] })
    );

    const result = await executeRollback(
      [
        { source: '/src/a.txt', destination: '/dst/a.txt' },
        { source: '/src/b.txt', destination: '/dst/b.txt' }
      ],
      [],
      2,
      'test',
      'batch-3',
      log
    );

    // The last writeFile call is for the updated manifest (via writeFileAtomic)
    const lastWriteCall =
      mockFsPromises.writeFile.mock.calls[mockFsPromises.writeFile.mock.calls.length - 1];
    const updatedManifest = JSON.parse(lastWriteCall[1]);

    expect(updatedManifest.status).toBe('partial_failure');
    expect(updatedManifest.results.length).toBeGreaterThan(0);
    expect(result.rollbackFailCount).toBeGreaterThan(0);
  });
});
