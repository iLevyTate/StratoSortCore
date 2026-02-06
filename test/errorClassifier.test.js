/**
 * Tests for errorClassifier utility
 */

const {
  ErrorCategory,
  getErrorCategory,
  getUserMessage,
  classifyError,
  isRetryable,
  isNetworkError,
  isPermissionError,
  isNotFoundError,
  isCrossDeviceError,
  isExistsError,
  isCriticalError
} = require('../src/shared/errorClassifier');

describe('errorClassifier', () => {
  describe('getErrorCategory', () => {
    test('classifies ENOENT as FILE_NOT_FOUND', () => {
      const error = { code: 'ENOENT', message: 'no such file or directory' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.FILE_NOT_FOUND);
    });

    test('classifies EACCES as PERMISSION_DENIED', () => {
      const error = { code: 'EACCES', message: 'permission denied' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.PERMISSION_DENIED);
    });

    test('classifies EPERM as PERMISSION_DENIED', () => {
      const error = { code: 'EPERM', message: 'operation not permitted' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.PERMISSION_DENIED);
    });

    test('classifies EEXIST as FILE_EXISTS', () => {
      const error = { code: 'EEXIST', message: 'file already exists' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.FILE_EXISTS);
    });

    test('classifies EBUSY as FILE_IN_USE', () => {
      const error = { code: 'EBUSY', message: 'resource busy' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.FILE_IN_USE);
    });

    test('classifies ENOSPC as DISK_FULL', () => {
      const error = { code: 'ENOSPC', message: 'no space left' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.DISK_FULL);
    });

    test('classifies EXDEV as CROSS_DEVICE', () => {
      const error = { code: 'EXDEV', message: 'cross-device link' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.CROSS_DEVICE);
    });

    test('classifies ECONNREFUSED as NETWORK_ERROR', () => {
      const error = { code: 'ECONNREFUSED', message: 'connection refused' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.NETWORK_ERROR);
    });

    test('classifies ETIMEDOUT as TIMEOUT', () => {
      const error = { code: 'ETIMEDOUT', message: 'connection timed out' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.TIMEOUT);
    });

    test('classifies timeout message as TIMEOUT', () => {
      const error = { message: 'Request timed out after 5000ms' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.TIMEOUT);
    });

    test('classifies network message as NETWORK_ERROR', () => {
      const error = { message: 'Network connection failed' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.NETWORK_ERROR);
    });

    test('classifies permission message as PERMISSION_DENIED', () => {
      const error = { message: 'Permission denied for file access' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.PERMISSION_DENIED);
    });

    test('returns UNKNOWN for unrecognized errors', () => {
      const error = { message: 'Something went wrong' };
      expect(getErrorCategory(error)).toBe(ErrorCategory.UNKNOWN);
    });

    test('returns UNKNOWN for null error', () => {
      expect(getErrorCategory(null)).toBe(ErrorCategory.UNKNOWN);
    });

    test('returns UNKNOWN for undefined error', () => {
      expect(getErrorCategory(undefined)).toBe(ErrorCategory.UNKNOWN);
    });
  });

  describe('getUserMessage', () => {
    test('returns user-friendly message for FILE_NOT_FOUND', () => {
      const error = { code: 'ENOENT' };
      expect(getUserMessage(error)).toBe('File or directory not found');
    });

    test('returns user-friendly message for PERMISSION_DENIED', () => {
      const error = { code: 'EACCES' };
      expect(getUserMessage(error)).toBe('Permission denied - check file permissions');
    });

    test('customizes message with context', () => {
      const error = { code: 'ENOENT' };
      expect(getUserMessage(error, 'folder')).toBe('Folder not found');
    });

    test('customizes permission message with context', () => {
      const error = { code: 'EACCES' };
      expect(getUserMessage(error, 'file')).toBe('Permission denied - cannot access file');
    });

    test('returns default message for unknown errors', () => {
      const error = { message: 'weird error' };
      expect(getUserMessage(error)).toBe('An unexpected error occurred');
    });
  });

  describe('isRetryable', () => {
    test('returns true for EBUSY', () => {
      expect(isRetryable({ code: 'EBUSY' })).toBe(true);
    });

    test('returns true for EPERM (Windows lock)', () => {
      expect(isRetryable({ code: 'EPERM' })).toBe(true);
    });

    test('returns true for ETIMEDOUT', () => {
      expect(isRetryable({ code: 'ETIMEDOUT' })).toBe(true);
    });

    test('returns true for timeout message', () => {
      expect(isRetryable({ message: 'Operation timed out' })).toBe(true);
    });

    test('returns false for ENOENT', () => {
      expect(isRetryable({ code: 'ENOENT' })).toBe(false);
    });

    test('returns false for ENOSPC', () => {
      expect(isRetryable({ code: 'ENOSPC' })).toBe(false);
    });

    test('returns false for null', () => {
      expect(isRetryable(null)).toBe(false);
    });
  });

  describe('isNetworkError', () => {
    test('returns true for ECONNREFUSED', () => {
      expect(isNetworkError({ code: 'ECONNREFUSED' })).toBe(true);
    });

    test('returns true for ENOTFOUND', () => {
      expect(isNetworkError({ code: 'ENOTFOUND' })).toBe(true);
    });

    test('returns true for network message', () => {
      expect(isNetworkError({ message: 'Network error occurred' })).toBe(true);
    });

    test('returns true for ECONNREFUSED message', () => {
      expect(isNetworkError({ message: 'ECONNREFUSED 127.0.0.1:9999' })).toBe(true);
    });

    test('returns false for ENOENT', () => {
      expect(isNetworkError({ code: 'ENOENT' })).toBe(false);
    });

    test('returns false for null', () => {
      expect(isNetworkError(null)).toBe(false);
    });
  });

  describe('isPermissionError', () => {
    test('returns true for EACCES', () => {
      expect(isPermissionError({ code: 'EACCES' })).toBe(true);
    });

    test('returns true for EPERM', () => {
      expect(isPermissionError({ code: 'EPERM' })).toBe(true);
    });

    test('returns true for permission message', () => {
      expect(isPermissionError({ message: 'Permission denied' })).toBe(true);
    });

    test('returns true for access denied message', () => {
      expect(isPermissionError({ message: 'Access denied to file' })).toBe(true);
    });

    test('returns false for ENOENT', () => {
      expect(isPermissionError({ code: 'ENOENT' })).toBe(false);
    });
  });

  describe('isNotFoundError', () => {
    test('returns true for ENOENT', () => {
      expect(isNotFoundError({ code: 'ENOENT' })).toBe(true);
    });

    test('returns true for not found message', () => {
      expect(isNotFoundError({ message: 'File not found' })).toBe(true);
    });

    test('returns true for no such file message', () => {
      expect(isNotFoundError({ message: 'no such file or directory' })).toBe(true);
    });

    test('returns false for other errors', () => {
      expect(isNotFoundError({ code: 'EACCES' })).toBe(false);
    });
  });

  describe('isCrossDeviceError', () => {
    test('returns true for EXDEV', () => {
      expect(isCrossDeviceError({ code: 'EXDEV' })).toBe(true);
    });

    test('returns false for other codes', () => {
      expect(isCrossDeviceError({ code: 'ENOENT' })).toBe(false);
    });

    test('returns false for null', () => {
      expect(isCrossDeviceError(null)).toBe(false);
    });
  });

  describe('isExistsError', () => {
    test('returns true for EEXIST', () => {
      expect(isExistsError({ code: 'EEXIST' })).toBe(true);
    });

    test('returns false for other codes', () => {
      expect(isExistsError({ code: 'ENOENT' })).toBe(false);
    });
  });

  describe('isCriticalError', () => {
    test('returns true for PERMISSION_DENIED', () => {
      expect(isCriticalError({ code: 'EACCES' })).toBe(true);
    });

    test('returns true for DISK_FULL', () => {
      expect(isCriticalError({ code: 'ENOSPC' })).toBe(true);
    });

    test('returns true for IO_ERROR', () => {
      expect(isCriticalError({ code: 'EIO' })).toBe(true);
    });

    test('returns false for FILE_NOT_FOUND', () => {
      expect(isCriticalError({ code: 'ENOENT' })).toBe(false);
    });

    test('returns false for NETWORK_ERROR', () => {
      expect(isCriticalError({ code: 'ECONNREFUSED' })).toBe(false);
    });
  });

  describe('classifyError', () => {
    test('returns comprehensive classification for ENOENT', () => {
      const error = new Error('no such file');
      error.code = 'ENOENT';

      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.FILE_NOT_FOUND);
      expect(result.userMessage).toBe('File or directory not found');
      expect(result.isRetryable).toBe(false);
      expect(result.isNotFoundError).toBe(true);
      expect(result.isNetworkError).toBe(false);
      expect(result.isCriticalError).toBe(false);
      expect(result.code).toBe('ENOENT');
      expect(result.originalMessage).toBe('no such file');
    });

    test('returns comprehensive classification for EACCES', () => {
      const error = new Error('permission denied');
      error.code = 'EACCES';

      const result = classifyError(error, { context: 'file' });

      expect(result.category).toBe(ErrorCategory.PERMISSION_DENIED);
      expect(result.userMessage).toBe('Permission denied - cannot access file');
      expect(result.isRetryable).toBe(false);
      expect(result.isPermissionError).toBe(true);
      expect(result.isCriticalError).toBe(true);
    });

    test('returns comprehensive classification for network error', () => {
      const error = { code: 'ECONNREFUSED', message: 'connection refused' };

      const result = classifyError(error);

      expect(result.category).toBe(ErrorCategory.NETWORK_ERROR);
      expect(result.isNetworkError).toBe(true);
      expect(result.isRetryable).toBe(true);
      expect(result.isCriticalError).toBe(false);
    });

    test('handles null error', () => {
      const result = classifyError(null);

      expect(result.category).toBe(ErrorCategory.UNKNOWN);
      expect(result.originalMessage).toBe('Unknown error');
      expect(result.code).toBe(null);
    });
  });
});
