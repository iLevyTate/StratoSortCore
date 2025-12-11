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
      const err = new FSLikeError(error.code || 'UNKNOWN', {
        ...context,
        originalError: error.message
      });
      return err;
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
      WRITE_FAILED: 'WRITE_FAILED'
    }
  };
});
jest.mock('os', () => ({
  tmpdir: () => '/tmp'
}));

const fs = require('fs');
const path = require('path');
const { AtomicFileOperations } = require('../src/shared/atomicFileOperations');

describe('AtomicFileOperations (memfs)', () => {
  let ops;

  beforeEach(() => {
    jest.resetModules();
    ops = new AtomicFileOperations();
  });

  test('initializeBackupDirectory creates and reuses directory', async () => {
    const dir1 = await ops.initializeBackupDirectory();
    const dir2 = await ops.initializeBackupDirectory();
    expect(dir1).toBe(dir2);
    await expect(fs.promises.stat(dir1)).resolves.toBeDefined();
  });

  test('createBackup copies file and preserves size', async () => {
    const tx = await ops.beginTransaction();
    const filePath = '/tmp/source.txt';
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, 'hello backup');

    const backup = await ops.createBackup(filePath, tx);
    const [srcStat, backupStat] = await Promise.all([
      fs.promises.stat(filePath),
      fs.promises.stat(backup)
    ]);
    expect(srcStat.size).toBe(backupStat.size);
  });

  test('executeOperation moves file with backup', async () => {
    const tx = await ops.beginTransaction();
    const src = '/tmp/fileA.txt';
    const dest = '/tmp/dest/fileA.txt';
    await fs.promises.mkdir('/tmp', { recursive: true });
    await fs.promises.writeFile(src, 'content');

    await ops.executeOperation(tx, { type: 'move', source: src, destination: dest });
    await expect(fs.promises.access(dest)).resolves.toBeUndefined();
    await expect(fs.promises.access(src)).rejects.toBeDefined();
    // Backup should exist
    const txData = ops.activeTransactions.get(tx);
    expect(txData.backups.length).toBeGreaterThan(0);
  });

  test('executeOperation delete removes file and stores backup', async () => {
    const tx = await ops.beginTransaction();
    const src = '/tmp/fileB.txt';
    await fs.promises.writeFile(src, 'delete me');

    await ops.executeOperation(tx, { type: 'delete', source: src });
    await expect(fs.promises.access(src)).rejects.toBeDefined();
    const txData = ops.activeTransactions.get(tx);
    expect(txData.backups.length).toBeGreaterThan(0);
  });
});
