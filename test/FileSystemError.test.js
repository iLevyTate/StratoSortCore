/**
 * Tests for FileSystemError
 * Tests error code mapping, user messages, and recovery suggestions
 */

describe('FileSystemError', () => {
  let FileSystemError;
  let FileNotFoundError;
  let PermissionDeniedError;
  let WriteFailedError;
  let WatcherError;
  let AtomicOperationError;
  let IntegrityError;
  let FILE_SYSTEM_ERROR_CODES;
  let NODE_ERROR_CODE_MAP;

  beforeEach(() => {
    jest.resetModules();
    const module = require('../src/main/errors/FileSystemError');
    FileSystemError = module.FileSystemError;
    FileNotFoundError = module.FileNotFoundError;
    PermissionDeniedError = module.PermissionDeniedError;
    WriteFailedError = module.WriteFailedError;
    WatcherError = module.WatcherError;
    AtomicOperationError = module.AtomicOperationError;
    IntegrityError = module.IntegrityError;
    FILE_SYSTEM_ERROR_CODES = module.FILE_SYSTEM_ERROR_CODES;
    NODE_ERROR_CODE_MAP = module.NODE_ERROR_CODE_MAP;
  });

  describe('FileSystemError base class', () => {
    test('creates error with code and metadata', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {
        path: '/test/file.txt'
      });

      expect(error.name).toBe('FileSystemError');
      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.metadata.path).toBe('/test/file.txt');
      expect(error.isOperational).toBe(true);
      expect(error.isFileSystemError).toBe(true);
    });

    test('extracts fileName and directory from path', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {
        path: '/home/user/documents/file.txt'
      });

      expect(error.metadata.fileName).toBe('file.txt');
      expect(error.metadata.directory).toContain('documents');
    });

    test('generates appropriate message for each error code', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.DISK_FULL, {});

      expect(error.message).toContain('Disk is full');
    });

    test('includes timestamp', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {});

      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp)).toBeInstanceOf(Date);
    });

    test('captures stack trace', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {});

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('FileSystemError');
    });
  });

  describe('getUserFriendlyMessage', () => {
    test('returns user-friendly message for file not found', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {
        path: '/test.txt'
      });

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('could not be found');
    });

    test('returns user-friendly message for disk full', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.DISK_FULL, {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('disk is full');
    });

    test('returns user-friendly message for permission denied', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED, {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('permission');
    });

    test('returns default message for unknown code', () => {
      const error = new FileSystemError('UNKNOWN_CODE', {});

      const message = error.getUserFriendlyMessage();

      expect(message).toContain('file system error');
    });
  });

  describe('getActionableSteps', () => {
    test('returns steps for file access denied', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_ACCESS_DENIED, {});

      const steps = error.getActionableSteps();

      expect(steps.length).toBeGreaterThan(0);
      expect(steps.some((s) => s.toLowerCase().includes('permission'))).toBe(true);
    });

    test('returns steps for disk full', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.DISK_FULL, {});

      const steps = error.getActionableSteps();

      expect(steps).toContain('Delete unnecessary files');
    });

    test('returns default steps for unknown error', () => {
      const error = new FileSystemError('UNKNOWN_CODE', {});

      const steps = error.getActionableSteps();

      expect(steps.length).toBeGreaterThan(0);
    });
  });

  describe('isRecoverable', () => {
    test('returns false for corrupted file', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.CORRUPTED_FILE, {});

      expect(error.isRecoverable()).toBe(false);
    });

    test('returns false for disk full', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.DISK_FULL, {});

      expect(error.isRecoverable()).toBe(false);
    });

    test('returns true for file in use', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_IN_USE, {});

      expect(error.isRecoverable()).toBe(true);
    });

    test('returns true for file not found', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {});

      expect(error.isRecoverable()).toBe(true);
    });
  });

  describe('shouldRetry', () => {
    test('returns true for file in use', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_IN_USE, {});

      expect(error.shouldRetry()).toBe(true);
    });

    test('returns true for network error', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR, {});

      expect(error.shouldRetry()).toBe(true);
    });

    test('returns false for file not found', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {});

      expect(error.shouldRetry()).toBe(false);
    });
  });

  describe('getRetryDelay', () => {
    test('returns delay for file in use', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_IN_USE, {});

      expect(error.getRetryDelay()).toBe(1000);
    });

    test('returns delay for network error', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR, {});

      expect(error.getRetryDelay()).toBe(3000);
    });

    test('returns default delay for unknown error', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {});

      expect(error.getRetryDelay()).toBe(1000);
    });
  });

  describe('toJSON', () => {
    test('serializes error to JSON', () => {
      const error = new FileSystemError(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, {
        path: '/test.txt'
      });

      const json = error.toJSON();

      expect(json.name).toBe('FileSystemError');
      expect(json.code).toBe('FILE_NOT_FOUND');
      expect(json.message).toBeDefined();
      expect(json.userMessage).toBeDefined();
      expect(json.metadata).toBeDefined();
      expect(json.timestamp).toBeDefined();
      expect(json.isRecoverable).toBe(true);
      expect(json.actionableSteps).toBeInstanceOf(Array);
    });
  });

  describe('fromNodeError', () => {
    test('maps ENOENT to FILE_NOT_FOUND', () => {
      const nodeError = new Error('ENOENT: no such file');
      nodeError.code = 'ENOENT';

      const error = FileSystemError.fromNodeError(nodeError, { path: '/test.txt' });

      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.metadata.originalCode).toBe('ENOENT');
    });

    test('maps EACCES to FILE_ACCESS_DENIED', () => {
      const nodeError = new Error('EACCES: permission denied');
      nodeError.code = 'EACCES';

      const error = FileSystemError.fromNodeError(nodeError);

      expect(error.code).toBe('FILE_ACCESS_DENIED');
    });

    test('maps ENOSPC to DISK_FULL', () => {
      const nodeError = new Error('ENOSPC: no space left');
      nodeError.code = 'ENOSPC';

      const error = FileSystemError.fromNodeError(nodeError);

      expect(error.code).toBe('DISK_FULL');
    });

    test('maps unknown code to UNKNOWN_ERROR', () => {
      const nodeError = new Error('Unknown error');
      nodeError.code = 'EUNKNOWN';

      const error = FileSystemError.fromNodeError(nodeError);

      expect(error.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('forOperation', () => {
    test('creates error for read operation', () => {
      const nodeError = new Error('Read failed');

      const error = FileSystemError.forOperation('read', nodeError, '/test.txt');

      expect(error.metadata.operation).toBe('read');
      expect(error.metadata.path).toBe('/test.txt');
    });

    test('uses Node error code when available', () => {
      const nodeError = new Error('ENOENT');
      nodeError.code = 'ENOENT';

      const error = FileSystemError.forOperation('read', nodeError, '/test.txt');

      expect(error.code).toBe('FILE_NOT_FOUND');
    });

    test('uses operation-specific code when no Node code', () => {
      const error = FileSystemError.forOperation('write', null, '/test.txt');

      expect(error.code).toBe('WRITE_FAILED');
    });
  });

  describe('convenience classes', () => {
    test('FileNotFoundError creates correct error', () => {
      const error = new FileNotFoundError('/missing/file.txt');

      expect(error.code).toBe('FILE_NOT_FOUND');
      expect(error.metadata.path).toBe('/missing/file.txt');
    });

    test('PermissionDeniedError creates correct error', () => {
      const error = new PermissionDeniedError('/protected/file.txt', 'write');

      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.metadata.operation).toBe('write');
    });

    test('WriteFailedError creates correct error', () => {
      const originalError = new Error('Write failed');
      const error = new WriteFailedError('/test.txt', originalError);

      expect(error.code).toBe('WRITE_FAILED');
      expect(error.metadata.originalError).toBe('Write failed');
    });

    test('WatcherError creates correct error', () => {
      const error = new WatcherError('/watched/folder');

      expect(error.code).toBe('WATCHER_FAILED');
    });

    test('AtomicOperationError creates correct error', () => {
      const error = new AtomicOperationError('rename', new Error('Failed'));

      expect(error.code).toBe('ATOMIC_OPERATION_FAILED');
      expect(error.metadata.operation).toBe('rename');
    });

    test('IntegrityError creates correct error', () => {
      const error = new IntegrityError(FILE_SYSTEM_ERROR_CODES.CHECKSUM_MISMATCH, '/file.txt', {
        expected: 'abc',
        actual: 'def'
      });

      expect(error.code).toBe('CHECKSUM_MISMATCH');
      expect(error.metadata.expected).toBe('abc');
    });
  });

  describe('NODE_ERROR_CODE_MAP', () => {
    test('maps common Node.js error codes', () => {
      expect(NODE_ERROR_CODE_MAP['ENOENT']).toBe('FILE_NOT_FOUND');
      expect(NODE_ERROR_CODE_MAP['EACCES']).toBe('FILE_ACCESS_DENIED');
      expect(NODE_ERROR_CODE_MAP['EPERM']).toBe('PERMISSION_DENIED');
      expect(NODE_ERROR_CODE_MAP['EEXIST']).toBe('FILE_EXISTS');
      expect(NODE_ERROR_CODE_MAP['ENOSPC']).toBe('DISK_FULL');
      expect(NODE_ERROR_CODE_MAP['EBUSY']).toBe('FILE_IN_USE');
    });
  });
});
