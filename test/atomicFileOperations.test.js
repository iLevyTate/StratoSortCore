/**
 * @jest-environment node
 */
/**
 * Tests for AtomicFileOperations
 * Tests transactional file operations with rollback capabilities
 */

// Unmock fs to use real filesystem for these tests
// The global test-setup mocks fs with memfs, but this causes path resolution
// issues on Windows. These tests need the real filesystem.
jest.unmock('fs');
jest.unmock('fs/promises');
jest.unmock('os');

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

describe('AtomicFileOperations', () => {
  let AtomicFileOperations;
  let atomicFileOps;
  let crossDeviceMove;
  let organizeFilesAtomically;
  let testDir;

  beforeEach(async () => {
    // Create temp directory for tests
    testDir = path.join(os.tmpdir(), `atomic-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Clear module cache to ensure fresh imports
    jest.resetModules();

    const module = require('../src/shared/atomicFileOperations');
    AtomicFileOperations = module.AtomicFileOperations;
    atomicFileOps = module.atomicFileOps;
    crossDeviceMove = module.crossDeviceMove;
    organizeFilesAtomically = module.organizeFilesAtomically;
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('AtomicFileOperations class', () => {
    test('constructor initializes with defaults', () => {
      const ops = new AtomicFileOperations();
      expect(ops.activeTransactions).toBeInstanceOf(Map);
      expect(ops.backupDirectory).toBeNull();
      expect(ops.operationTimeout).toBe(30000);
    });

    test('generateTransactionId creates unique IDs', () => {
      const ops = new AtomicFileOperations();
      const id1 = ops.generateTransactionId();
      const id2 = ops.generateTransactionId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toHaveLength(32); // 16 bytes hex
    });
  });

  describe('fileExists', () => {
    test('returns true for existing file', async () => {
      const filePath = path.join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'content');

      const result = await atomicFileOps.fileExists(filePath);
      expect(result).toBe(true);
    });

    test('returns false for non-existing file', async () => {
      const filePath = path.join(testDir, 'not-exists.txt');

      const result = await atomicFileOps.fileExists(filePath);
      expect(result).toBe(false);
    });
  });

  describe('generateUniqueFilename', () => {
    test('returns original path if no conflict', async () => {
      const filePath = path.join(testDir, 'unique.txt');

      const result = await atomicFileOps.generateUniqueFilename(filePath);
      expect(result).toBe(filePath);
    });

    test('generates unique filename when conflict exists', async () => {
      const filePath = path.join(testDir, 'conflict.txt');
      await fs.writeFile(filePath, 'content');

      const result = await atomicFileOps.generateUniqueFilename(filePath);
      expect(result).toBe(path.join(testDir, 'conflict_1.txt'));
    });

    test('increments counter for multiple conflicts', async () => {
      const filePath = path.join(testDir, 'multi.txt');
      await fs.writeFile(filePath, 'content');
      await fs.writeFile(path.join(testDir, 'multi_1.txt'), 'content');
      await fs.writeFile(path.join(testDir, 'multi_2.txt'), 'content');

      const result = await atomicFileOps.generateUniqueFilename(filePath);
      expect(result).toBe(path.join(testDir, 'multi_3.txt'));
    });
  });

  describe('beginTransaction', () => {
    test('creates transaction with unique ID', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();

      expect(id).toBeDefined();
      expect(ops.activeTransactions.has(id)).toBe(true);
    });

    test('transaction has correct initial state', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();
      const transaction = ops.activeTransactions.get(id);

      expect(transaction.status).toBe('active');
      expect(transaction.operations).toEqual([]);
      expect(transaction.backups).toEqual([]);
      expect(transaction.startTime).toBeDefined();
    });

    test('accepts initial operations', async () => {
      const ops = new AtomicFileOperations();
      const initialOps = [{ type: 'move', source: 'a', destination: 'b' }];
      const id = await ops.beginTransaction(initialOps);
      const transaction = ops.activeTransactions.get(id);

      expect(transaction.operations).toHaveLength(1);
    });
  });

  describe('addOperation', () => {
    test('adds operation to transaction', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();

      ops.addOperation(id, { type: 'move', source: 'a', destination: 'b' });

      const transaction = ops.activeTransactions.get(id);
      expect(transaction.operations).toHaveLength(1);
      expect(transaction.operations[0].type).toBe('move');
    });

    test('throws for non-existent transaction', () => {
      const ops = new AtomicFileOperations();

      expect(() => {
        ops.addOperation('invalid-id', { type: 'move' });
      }).toThrow('Transaction invalid-id not found');
    });

    test('adds timestamp and id to operation', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();

      ops.addOperation(id, { type: 'move', source: 'a', destination: 'b' });

      const transaction = ops.activeTransactions.get(id);
      expect(transaction.operations[0].id).toBeDefined();
      expect(transaction.operations[0].timestamp).toBeDefined();
    });
  });

  describe('atomicMove', () => {
    test('moves file to destination', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      const result = await atomicFileOps.atomicMove(source, dest);

      expect(result).toBe(dest);
      expect(await atomicFileOps.fileExists(source)).toBe(false);
      expect(await atomicFileOps.fileExists(dest)).toBe(true);
    });

    test('creates destination directory if needed', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'subdir', 'dest.txt');
      await fs.writeFile(source, 'content');

      await atomicFileOps.atomicMove(source, dest);

      expect(await atomicFileOps.fileExists(dest)).toBe(true);
    });

    test('overwrites existing file on conflict', async () => {
      // Note: fs.rename overwrites existing files on both Windows and Unix
      // The EEXIST handling in atomicMove is for edge cases (e.g., renaming to directory)
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'new content');
      await fs.writeFile(dest, 'existing');

      const result = await atomicFileOps.atomicMove(source, dest);

      expect(result).toBe(dest);
      // Verify the file was overwritten with new content
      const content = await fs.readFile(dest, 'utf8');
      expect(content).toBe('new content');
    });
  });

  describe('atomicCopy', () => {
    test('copies file to destination', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      await fs.writeFile(source, 'content');

      const result = await atomicFileOps.atomicCopy(source, dest);

      expect(result).toBe(dest);
      expect(await atomicFileOps.fileExists(source)).toBe(true);
      expect(await atomicFileOps.fileExists(dest)).toBe(true);
    });

    test('verifies copy integrity', async () => {
      const source = path.join(testDir, 'source.txt');
      const dest = path.join(testDir, 'dest.txt');
      const content = 'test content for integrity check';
      await fs.writeFile(source, content);

      await atomicFileOps.atomicCopy(source, dest);

      const sourceStats = await fs.stat(source);
      const destStats = await fs.stat(dest);
      expect(destStats.size).toBe(sourceStats.size);
    });
  });

  describe('atomicCreate', () => {
    test('creates file with content', async () => {
      const filePath = path.join(testDir, 'new.txt');
      const content = 'new content';

      const result = await atomicFileOps.atomicCreate(filePath, content);

      expect(result).toBe(filePath);
      const readContent = await fs.readFile(filePath, 'utf8');
      expect(readContent).toBe(content);
    });

    test('creates directory if needed', async () => {
      const filePath = path.join(testDir, 'newdir', 'new.txt');
      const content = 'content';

      await atomicFileOps.atomicCreate(filePath, content);

      expect(await atomicFileOps.fileExists(filePath)).toBe(true);
    });

    test('handles Buffer content', async () => {
      const filePath = path.join(testDir, 'buffer.txt');
      const content = Buffer.from('buffer content');

      await atomicFileOps.atomicCreate(filePath, content);

      const readContent = await fs.readFile(filePath);
      expect(readContent.toString()).toBe('buffer content');
    });
  });

  describe('createBackup', () => {
    test('creates backup copy of file', async () => {
      const ops = new AtomicFileOperations();
      const source = path.join(testDir, 'to-backup.txt');
      await fs.writeFile(source, 'backup content');

      const id = ops.generateTransactionId();
      const backupPath = await ops.createBackup(source, id);

      expect(backupPath).toBeDefined();
      expect(await ops.fileExists(backupPath)).toBe(true);
    });

    test('backup has same size as original', async () => {
      const ops = new AtomicFileOperations();
      const source = path.join(testDir, 'to-backup.txt');
      const content = 'backup content with some data';
      await fs.writeFile(source, content);

      const id = ops.generateTransactionId();
      const backupPath = await ops.createBackup(source, id);

      const sourceStats = await fs.stat(source);
      const backupStats = await fs.stat(backupPath);
      expect(backupStats.size).toBe(sourceStats.size);
    });
  });

  describe('getTransactionStatus', () => {
    test('returns null for non-existent transaction', () => {
      const ops = new AtomicFileOperations();
      const status = ops.getTransactionStatus('invalid-id');
      expect(status).toBeNull();
    });

    test('returns correct status for active transaction', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();
      ops.addOperation(id, { type: 'move', source: 'a', destination: 'b' });

      const status = ops.getTransactionStatus(id);

      expect(status.id).toBe(id);
      expect(status.status).toBe('active');
      expect(status.operationCount).toBe(1);
      expect(status.backupCount).toBe(0);
      expect(status.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getActiveTransactions', () => {
    test('returns empty array when no transactions', () => {
      const ops = new AtomicFileOperations();
      const active = ops.getActiveTransactions();
      expect(active).toEqual([]);
    });

    test('returns all active transactions', async () => {
      const ops = new AtomicFileOperations();
      await ops.beginTransaction();
      await ops.beginTransaction();

      const active = ops.getActiveTransactions();
      expect(active).toHaveLength(2);
    });
  });

  describe('cleanupStaleTransactions', () => {
    test('removes transactions older than maxAge', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();

      // Manually set old start time
      ops.activeTransactions.get(id).startTime = Date.now() - 7200000; // 2 hours ago

      const removed = await ops.cleanupStaleTransactions(3600000); // 1 hour

      expect(removed).toBe(1);
      expect(ops.activeTransactions.has(id)).toBe(false);
    });

    test('keeps recent transactions', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();

      const removed = await ops.cleanupStaleTransactions(3600000);

      expect(removed).toBe(0);
      expect(ops.activeTransactions.has(id)).toBe(true);
    });
  });

  describe('crossDeviceMove', () => {
    test('copies file and deletes source', async () => {
      const source = path.join(testDir, 'cross-source.txt');
      const dest = path.join(testDir, 'cross-dest.txt');
      await fs.writeFile(source, 'cross device content');

      await crossDeviceMove(source, dest);

      expect(await atomicFileOps.fileExists(source)).toBe(false);
      expect(await atomicFileOps.fileExists(dest)).toBe(true);
    });

    test('verifies file size by default', async () => {
      const source = path.join(testDir, 'verify-source.txt');
      const dest = path.join(testDir, 'verify-dest.txt');
      const content = 'content for verification';
      await fs.writeFile(source, content);

      await crossDeviceMove(source, dest);

      const destContent = await fs.readFile(dest, 'utf8');
      expect(destContent).toBe(content);
    });

    test('skips verification when verify is false', async () => {
      const source = path.join(testDir, 'no-verify-source.txt');
      const dest = path.join(testDir, 'no-verify-dest.txt');
      await fs.writeFile(source, 'content');

      await crossDeviceMove(source, dest, { verify: false });

      expect(await atomicFileOps.fileExists(dest)).toBe(true);
    });
  });

  describe('commitTransaction', () => {
    test('executes all operations successfully', async () => {
      const ops = new AtomicFileOperations();
      const source = path.join(testDir, 'commit-source.txt');
      const dest = path.join(testDir, 'commit-dest.txt');
      await fs.writeFile(source, 'content');

      const id = await ops.beginTransaction();
      ops.addOperation(id, { type: 'move', source, destination: dest });

      const result = await ops.commitTransaction(id);

      expect(result.success).toBe(true);
      expect(await ops.fileExists(dest)).toBe(true);
    });

    test('sets transaction status to committed', async () => {
      const ops = new AtomicFileOperations();
      const id = await ops.beginTransaction();

      await ops.commitTransaction(id);

      const transaction = ops.activeTransactions.get(id);
      expect(transaction.status).toBe('committed');
    });
  });

  describe('rollbackTransaction', () => {
    test('throws for non-existent transaction', async () => {
      const ops = new AtomicFileOperations();

      await expect(ops.rollbackTransaction('invalid-id')).rejects.toThrow();
    });
  });

  describe('organizeFilesAtomically', () => {
    test('moves multiple files atomically', async () => {
      const source1 = path.join(testDir, 'org-source1.txt');
      const source2 = path.join(testDir, 'org-source2.txt');
      const dest1 = path.join(testDir, 'organized', 'dest1.txt');
      const dest2 = path.join(testDir, 'organized', 'dest2.txt');

      await fs.writeFile(source1, 'content1');
      await fs.writeFile(source2, 'content2');

      const result = await organizeFilesAtomically([
        { originalPath: source1, targetPath: dest1 },
        { originalPath: source2, targetPath: dest2 },
      ]);

      expect(result.success).toBe(true);
    });
  });
});
