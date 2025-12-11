jest.mock('fs', () => require('memfs').fs);
jest.mock('../src/shared/logger', () => ({
  logger: {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));
jest.mock('../src/main/errors/FileSystemError', () => {
  class FSLikeError extends Error {
    constructor(code, metadata = {}) {
      super(metadata.originalError || code);
      this.code = code;
      this.metadata = metadata;
      this.isFileSystemError = true;
    }
    getUserFriendlyMessage() {
      return this.message;
    }
    static fromNodeError(error, context = {}) {
      return new FSLikeError(error.code || 'UNKNOWN', {
        ...context,
        originalError: error.message
      });
    }
  }
  return {
    FileSystemError: FSLikeError,
    AtomicOperationError: FSLikeError,
    IntegrityError: FSLikeError,
    FILE_SYSTEM_ERROR_CODES: {
      SIZE_MISMATCH: 'SIZE_MISMATCH',
      ATOMIC_OPERATION_FAILED: 'ATOMIC_OPERATION_FAILED',
      ROLLBACK_FAILED: 'ROLLBACK_FAILED',
      FILE_NOT_FOUND: 'FILE_NOT_FOUND',
      WRITE_FAILED: 'WRITE_FAILED',
      PARTIAL_WRITE: 'PARTIAL_WRITE'
    }
  };
});
jest.mock('os', () => ({
  tmpdir: () => '/tmp'
}));

const fs = require('fs');
const { AtomicFileOperations } = require('../src/shared/atomicFileOperations');

describe('AtomicFileOperations rollback and cross-device', () => {
  let ops;

  beforeEach(() => {
    jest.resetModules();
    ops = new AtomicFileOperations();
  });

  test('rollbackTransaction restores from backups when an operation fails', async () => {
    const tx = await ops.beginTransaction();
    const src = '/tmp/fileC.txt';
    const dest = '/tmp/dest/fileC.txt';
    await fs.promises.mkdir('/tmp/dest', { recursive: true });
    await fs.promises.writeFile(src, 'content');

    // Inject an operation that will throw (unknown type) to trigger rollback
    ops.addOperation(tx, { type: 'move', source: src, destination: dest });
    ops.addOperation(tx, { type: 'unknown-op', source: src, destination: dest });

    const result = await ops.commitTransaction(tx);
    expect(result.success).toBe(true);

    // Source should be restored after rollback (exists) and destination absent
    await expect(fs.promises.access(src)).resolves.toBeUndefined();
    await expect(fs.promises.access(dest)).rejects.toBeDefined();
  });

  test('cross-device move fallback copies and deletes source', async () => {
    const tx = await ops.beginTransaction();
    const src = '/tmp/fileD.txt';
    await fs.promises.writeFile(src, 'abc');

    // Mock rename to force EXDEV and ensure copy/delete path is used
    const renameSpy = jest.spyOn(fs.promises, 'rename').mockImplementation(() => {
      const err = new Error('cross device');
      err.code = 'EXDEV';
      throw err;
    });

    const dest = '/tmp/other/fileD.txt';
    await ops.executeOperation(tx, { type: 'move', source: src, destination: dest });

    await expect(fs.promises.access(dest)).resolves.toBeUndefined();
    await expect(fs.promises.access(src)).rejects.toBeDefined();
    renameSpy.mockRestore();
  });
});
