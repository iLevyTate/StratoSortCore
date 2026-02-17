jest.mock('fs', () => require('memfs').fs);
jest.mock('../src/shared/logger', () => {
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
  return { logger, createLogger: jest.fn(() => logger) };
});
jest.mock('../src/main/errors/FileSystemError', () => {
  class FSLikeError extends Error {
    constructor(code, metadata = {}) {
      super(metadata.originalError || code);
      this.code = code;
      this.metadata = metadata;
      this.isFileSystemError = true;
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
      ROLLBACK_FAILED: 'ROLLBACK_FAILED'
    }
  };
});
jest.mock('os', () => ({
  tmpdir: () => '/tmp'
}));

const fs = require('fs');
const path = require('path');
const { AtomicFileOperations } = require('../src/shared/atomicFileOperations');

describe('AtomicFileOperations journal recovery', () => {
  let ops;

  beforeEach(async () => {
    jest.resetModules();
    ops = new AtomicFileOperations();
    await ops.initializeJournalDirectory();
  });

  afterEach(() => {
    if (ops && typeof ops.shutdown === 'function') {
      ops.shutdown();
    }
  });

  const writeJournal = async (id, journalData) => {
    const journalPath = path.join(ops.journalDirectory, `${id}.journal`);
    await fs.promises.writeFile(
      journalPath,
      JSON.stringify({ id, ...journalData }, null, 2),
      'utf8'
    );
    return journalPath;
  };

  test('cleans committed journals without running rollback recovery', async () => {
    const journalPath = await writeJournal('tx-committed', {
      status: 'committed',
      startTime: Date.now()
    });

    const result = await ops.recoverFromJournals();

    expect(result).toEqual({ recovered: 0, cleaned: 1, errors: 0 });
    await expect(fs.promises.access(journalPath)).rejects.toBeDefined();
  });

  test('recovers active journals by restoring backups and removing partial destinations', async () => {
    const sourcePath = '/tmp/docs/original.txt';
    const backupPath = '/tmp/backups/original.backup';
    const partialDest = '/tmp/docs/partial-destination.txt';

    await fs.promises.mkdir('/tmp/docs', { recursive: true });
    await fs.promises.mkdir('/tmp/backups', { recursive: true });
    await fs.promises.writeFile(backupPath, 'restored-content', 'utf8');
    await fs.promises.writeFile(partialDest, 'partial', 'utf8');

    const journalPath = await writeJournal('tx-active', {
      status: 'active',
      startTime: Date.now(),
      backups: [{ source: sourcePath, backup: backupPath }],
      createdDestinations: [partialDest]
    });

    const result = await ops.recoverFromJournals();

    expect(result).toEqual({ recovered: 1, cleaned: 0, errors: 0 });
    await expect(fs.promises.readFile(sourcePath, 'utf8')).resolves.toBe('restored-content');
    await expect(fs.promises.access(partialDest)).rejects.toBeDefined();
    await expect(fs.promises.access(backupPath)).rejects.toBeDefined();
    await expect(fs.promises.access(journalPath)).rejects.toBeDefined();
  });

  test('removes stale journals older than maxAge', async () => {
    const oldJournalPath = await writeJournal('tx-stale', {
      status: 'active',
      startTime: Date.now() - 5 * 60 * 1000 // 5 minutes ago
    });

    const result = await ops.recoverFromJournals(60 * 1000); // 1 minute max age

    expect(result).toEqual({ recovered: 0, cleaned: 1, errors: 0 });
    await expect(fs.promises.access(oldJournalPath)).rejects.toBeDefined();
  });

  test('counts and removes corrupt journal files', async () => {
    const corruptPath = path.join(ops.journalDirectory, 'tx-corrupt.journal');
    await fs.promises.writeFile(corruptPath, '{invalid-json', 'utf8');

    const result = await ops.recoverFromJournals();

    expect(result).toEqual({ recovered: 0, cleaned: 0, errors: 1 });
    await expect(fs.promises.access(corruptPath)).rejects.toBeDefined();
  });
});
