/**
 * FileSystemError - Structured error system for file system operations
 *
 * Provides consistent error handling with error codes, user-friendly messages,
 * and actionable recovery steps for all file system operations.
 */

const path = require('path');

/**
 * Error codes for file system operations
 * These codes provide machine-readable error identification
 */
const FILE_SYSTEM_ERROR_CODES = {
  // Access and permission errors
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Write and modification errors
  WRITE_FAILED: 'WRITE_FAILED',
  READ_FAILED: 'READ_FAILED',
  DELETE_FAILED: 'DELETE_FAILED',
  RENAME_FAILED: 'RENAME_FAILED',
  COPY_FAILED: 'COPY_FAILED',
  MOVE_FAILED: 'MOVE_FAILED',

  // Directory errors
  MKDIR_FAILED: 'MKDIR_FAILED',
  RMDIR_FAILED: 'RMDIR_FAILED',
  DIRECTORY_NOT_EMPTY: 'DIRECTORY_NOT_EMPTY',
  NOT_A_DIRECTORY: 'NOT_A_DIRECTORY',
  NOT_A_FILE: 'NOT_A_FILE',

  // Space and resource errors
  DISK_FULL: 'DISK_FULL',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TOO_MANY_OPEN_FILES: 'TOO_MANY_OPEN_FILES',

  // File state errors
  FILE_IN_USE: 'FILE_IN_USE',
  FILE_LOCKED: 'FILE_LOCKED',
  FILE_EXISTS: 'FILE_EXISTS',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  // Path errors
  PATH_TOO_LONG: 'PATH_TOO_LONG',
  INVALID_PATH: 'INVALID_PATH',
  CROSS_DEVICE_LINK: 'CROSS_DEVICE_LINK',

  // Integrity errors
  CHECKSUM_MISMATCH: 'CHECKSUM_MISMATCH',
  SIZE_MISMATCH: 'SIZE_MISMATCH',
  PARTIAL_WRITE: 'PARTIAL_WRITE',
  CORRUPTED_FILE: 'CORRUPTED_FILE',

  // Watcher errors
  WATCHER_FAILED: 'WATCHER_FAILED',
  WATCHER_CLOSED: 'WATCHER_CLOSED',

  // Atomic operation errors
  ATOMIC_OPERATION_FAILED: 'ATOMIC_OPERATION_FAILED',
  ROLLBACK_FAILED: 'ROLLBACK_FAILED',
  TRANSACTION_TIMEOUT: 'TRANSACTION_TIMEOUT',

  // I/O errors
  IO_ERROR: 'IO_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',

  // Generic
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Maps Node.js error codes to FileSystemError codes
 */
const NODE_ERROR_CODE_MAP = {
  ENOENT: FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND,
  EACCES: FILE_SYSTEM_ERROR_CODES.FILE_ACCESS_DENIED,
  EPERM: FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED,
  EEXIST: FILE_SYSTEM_ERROR_CODES.FILE_EXISTS,
  ENOTDIR: FILE_SYSTEM_ERROR_CODES.NOT_A_DIRECTORY,
  EISDIR: FILE_SYSTEM_ERROR_CODES.NOT_A_FILE,
  ENOTEMPTY: FILE_SYSTEM_ERROR_CODES.DIRECTORY_NOT_EMPTY,
  ENOSPC: FILE_SYSTEM_ERROR_CODES.DISK_FULL,
  EDQUOT: FILE_SYSTEM_ERROR_CODES.QUOTA_EXCEEDED,
  EMFILE: FILE_SYSTEM_ERROR_CODES.TOO_MANY_OPEN_FILES,
  ENFILE: FILE_SYSTEM_ERROR_CODES.TOO_MANY_OPEN_FILES,
  EBUSY: FILE_SYSTEM_ERROR_CODES.FILE_IN_USE,
  ETXTBSY: FILE_SYSTEM_ERROR_CODES.FILE_IN_USE,
  EXDEV: FILE_SYSTEM_ERROR_CODES.CROSS_DEVICE_LINK,
  ENAMETOOLONG: FILE_SYSTEM_ERROR_CODES.PATH_TOO_LONG,
  EINVAL: FILE_SYSTEM_ERROR_CODES.INVALID_PATH,
  EIO: FILE_SYSTEM_ERROR_CODES.IO_ERROR,
  ENETUNREACH: FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR,
  ETIMEDOUT: FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR
};

/**
 * FileSystemError - Base class for all file system errors
 */
class FileSystemError extends Error {
  /**
   * Create a FileSystemError
   * @param {string} code - Error code from FILE_SYSTEM_ERROR_CODES
   * @param {Object} metadata - Additional context about the error
   * @param {string} [metadata.path] - File or directory path involved
   * @param {string} [metadata.operation] - Operation that failed (read, write, etc.)
   * @param {string} [metadata.originalError] - Original error message
   * @param {string} [metadata.originalCode] - Original Node.js error code
   */
  constructor(code, metadata = {}) {
    super();
    this.name = 'FileSystemError';
    this.code = code;
    this.metadata = {
      ...metadata,
      fileName: metadata.path ? path.basename(metadata.path) : undefined,
      directory: metadata.path ? path.dirname(metadata.path) : undefined
    };
    this.isOperational = true;
    this.isFileSystemError = true;
    this.timestamp = new Date().toISOString();

    // Generate message after metadata is set
    this.message = this.generateMessage();

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Generate technical error message
   */
  generateMessage() {
    const messages = {
      [FILE_SYSTEM_ERROR_CODES.FILE_ACCESS_DENIED]: `Access denied to file: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND]: `File not found: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.DIRECTORY_NOT_FOUND]: `Directory not found: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED]: `Permission denied: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.WRITE_FAILED]: `Failed to write file: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.READ_FAILED]: `Failed to read file: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.DELETE_FAILED]: `Failed to delete: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.RENAME_FAILED]: `Failed to rename: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.COPY_FAILED]: `Failed to copy: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.MOVE_FAILED]: `Failed to move: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.MKDIR_FAILED]: `Failed to create directory: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.RMDIR_FAILED]: `Failed to remove directory: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.DIRECTORY_NOT_EMPTY]: `Directory not empty: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.NOT_A_DIRECTORY]: `Path is not a directory: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.NOT_A_FILE]: `Path is not a file: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.DISK_FULL]: 'Disk is full - no space left on device',
      [FILE_SYSTEM_ERROR_CODES.QUOTA_EXCEEDED]: 'Disk quota exceeded',
      [FILE_SYSTEM_ERROR_CODES.TOO_MANY_OPEN_FILES]:
        'Too many open files - system resource limit reached',
      [FILE_SYSTEM_ERROR_CODES.FILE_IN_USE]: `File is in use by another process: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.FILE_LOCKED]: `File is locked: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.FILE_EXISTS]: `File already exists: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.FILE_TOO_LARGE]: `File too large: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.PATH_TOO_LONG]: `Path too long: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.INVALID_PATH]: `Invalid path: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.CROSS_DEVICE_LINK]: `Cannot move across different drives: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.CHECKSUM_MISMATCH]: `File checksum mismatch - possible corruption: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.SIZE_MISMATCH]: `File size mismatch after operation: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.PARTIAL_WRITE]: `Partial write detected: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.CORRUPTED_FILE]: `File appears corrupted: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.WATCHER_FAILED]: `File watcher failed: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.WATCHER_CLOSED]: 'File watcher was closed unexpectedly',
      [FILE_SYSTEM_ERROR_CODES.ATOMIC_OPERATION_FAILED]: `Atomic operation failed: ${this.metadata.operation || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.ROLLBACK_FAILED]: 'Failed to rollback file operation',
      [FILE_SYSTEM_ERROR_CODES.TRANSACTION_TIMEOUT]: 'File operation transaction timed out',
      [FILE_SYSTEM_ERROR_CODES.IO_ERROR]: `I/O error occurred: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR]: `Network error accessing file: ${this.metadata.path || 'unknown'}`,
      [FILE_SYSTEM_ERROR_CODES.UNKNOWN_ERROR]: `Unknown file system error: ${this.metadata.originalError || 'unknown'}`
    };

    return messages[this.code] || `File system error: ${this.code}`;
  }

  /**
   * Get user-friendly error message suitable for display in UI
   */
  getUserFriendlyMessage() {
    const userMessages = {
      [FILE_SYSTEM_ERROR_CODES.FILE_ACCESS_DENIED]:
        'Cannot access this file. It may be protected or you may not have permission.',
      [FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND]:
        'The file could not be found. It may have been moved or deleted.',
      [FILE_SYSTEM_ERROR_CODES.DIRECTORY_NOT_FOUND]:
        'The folder could not be found. It may have been moved or deleted.',
      [FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED]:
        'You do not have permission to perform this action. Try running as administrator.',
      [FILE_SYSTEM_ERROR_CODES.WRITE_FAILED]:
        'Failed to save the file. Please check that the location is writable.',
      [FILE_SYSTEM_ERROR_CODES.READ_FAILED]:
        'Failed to read the file. It may be corrupted or inaccessible.',
      [FILE_SYSTEM_ERROR_CODES.DELETE_FAILED]:
        'Failed to delete. The file may be in use by another program.',
      [FILE_SYSTEM_ERROR_CODES.RENAME_FAILED]:
        'Failed to rename. The destination may already exist or be inaccessible.',
      [FILE_SYSTEM_ERROR_CODES.COPY_FAILED]:
        'Failed to copy the file. Check available disk space and permissions.',
      [FILE_SYSTEM_ERROR_CODES.MOVE_FAILED]:
        'Failed to move the file. The destination may be unavailable.',
      [FILE_SYSTEM_ERROR_CODES.MKDIR_FAILED]:
        'Failed to create the folder. Check permissions and available space.',
      [FILE_SYSTEM_ERROR_CODES.RMDIR_FAILED]:
        'Failed to remove the folder. It may contain files or be in use.',
      [FILE_SYSTEM_ERROR_CODES.DIRECTORY_NOT_EMPTY]:
        'The folder is not empty. Remove its contents first.',
      [FILE_SYSTEM_ERROR_CODES.NOT_A_DIRECTORY]: 'Expected a folder but found a file.',
      [FILE_SYSTEM_ERROR_CODES.NOT_A_FILE]: 'Expected a file but found a folder.',
      [FILE_SYSTEM_ERROR_CODES.DISK_FULL]:
        'Your disk is full. Please free up some space and try again.',
      [FILE_SYSTEM_ERROR_CODES.QUOTA_EXCEEDED]: 'Your storage quota has been exceeded.',
      [FILE_SYSTEM_ERROR_CODES.TOO_MANY_OPEN_FILES]:
        'Too many files are open. Close some applications and try again.',
      [FILE_SYSTEM_ERROR_CODES.FILE_IN_USE]:
        'The file is being used by another program. Close it and try again.',
      [FILE_SYSTEM_ERROR_CODES.FILE_LOCKED]: 'The file is locked. Close any programs using it.',
      [FILE_SYSTEM_ERROR_CODES.FILE_EXISTS]:
        'A file with this name already exists in the destination.',
      [FILE_SYSTEM_ERROR_CODES.FILE_TOO_LARGE]: 'The file is too large to process.',
      [FILE_SYSTEM_ERROR_CODES.PATH_TOO_LONG]:
        'The file path is too long. Try a shorter filename or folder path.',
      [FILE_SYSTEM_ERROR_CODES.INVALID_PATH]: 'The file path contains invalid characters.',
      [FILE_SYSTEM_ERROR_CODES.CROSS_DEVICE_LINK]:
        'Cannot move files directly between different drives.',
      [FILE_SYSTEM_ERROR_CODES.CHECKSUM_MISMATCH]:
        'File verification failed. The file may be corrupted.',
      [FILE_SYSTEM_ERROR_CODES.SIZE_MISMATCH]:
        'File size verification failed. The copy may be incomplete.',
      [FILE_SYSTEM_ERROR_CODES.PARTIAL_WRITE]:
        'Only part of the file was written. Please try again.',
      [FILE_SYSTEM_ERROR_CODES.CORRUPTED_FILE]:
        'The file appears to be corrupted and cannot be processed.',
      [FILE_SYSTEM_ERROR_CODES.WATCHER_FAILED]: 'Failed to monitor the folder for changes.',
      [FILE_SYSTEM_ERROR_CODES.WATCHER_CLOSED]: 'Folder monitoring stopped unexpectedly.',
      [FILE_SYSTEM_ERROR_CODES.ATOMIC_OPERATION_FAILED]:
        'The file operation could not be completed safely.',
      [FILE_SYSTEM_ERROR_CODES.ROLLBACK_FAILED]:
        'Failed to undo the file operation. Some files may need manual recovery.',
      [FILE_SYSTEM_ERROR_CODES.TRANSACTION_TIMEOUT]:
        'The operation took too long and was cancelled.',
      [FILE_SYSTEM_ERROR_CODES.IO_ERROR]:
        'A hardware or disk error occurred. Check your disk health.',
      [FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR]:
        'Cannot access the network location. Check your connection.',
      [FILE_SYSTEM_ERROR_CODES.UNKNOWN_ERROR]: 'An unexpected file system error occurred.'
    };

    return userMessages[this.code] || 'A file system error occurred. Please try again.';
  }

  /**
   * Get actionable steps the user can take to resolve the error
   */
  getActionableSteps() {
    const actions = {
      [FILE_SYSTEM_ERROR_CODES.FILE_ACCESS_DENIED]: [
        'Check file permissions in Properties',
        'Run the application as Administrator',
        'Ensure no antivirus is blocking access'
      ],
      [FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND]: [
        'Verify the file still exists',
        'Check if the file was moved or deleted',
        'Refresh the file list'
      ],
      [FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED]: [
        'Right-click and run as Administrator',
        'Check folder permissions',
        'Contact your system administrator'
      ],
      [FILE_SYSTEM_ERROR_CODES.DISK_FULL]: [
        'Delete unnecessary files',
        'Empty the Recycle Bin',
        'Move files to another drive'
      ],
      [FILE_SYSTEM_ERROR_CODES.FILE_IN_USE]: [
        'Close applications using the file',
        'Wait a moment and try again',
        'Restart your computer if the issue persists'
      ],
      [FILE_SYSTEM_ERROR_CODES.FILE_EXISTS]: [
        'Choose a different file name',
        'Delete the existing file first',
        'Enable automatic renaming in settings'
      ],
      [FILE_SYSTEM_ERROR_CODES.PATH_TOO_LONG]: [
        'Move the file to a shorter path',
        'Rename folders to shorter names',
        'Enable long path support in Windows'
      ],
      [FILE_SYSTEM_ERROR_CODES.CHECKSUM_MISMATCH]: [
        'Try the operation again',
        'Check disk for errors',
        'Verify the source file is not corrupted'
      ],
      [FILE_SYSTEM_ERROR_CODES.IO_ERROR]: [
        'Check your disk health',
        'Run disk check (chkdsk)',
        'Try a different storage location'
      ],
      [FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR]: [
        'Check your network connection',
        'Verify the network share is accessible',
        'Try again later'
      ]
    };

    return actions[this.code] || ['Try the operation again', 'Check file and folder permissions'];
  }

  /**
   * Check if this error is recoverable
   */
  isRecoverable() {
    const nonRecoverableCodes = [
      FILE_SYSTEM_ERROR_CODES.CORRUPTED_FILE,
      FILE_SYSTEM_ERROR_CODES.CHECKSUM_MISMATCH,
      FILE_SYSTEM_ERROR_CODES.DISK_FULL,
      FILE_SYSTEM_ERROR_CODES.QUOTA_EXCEEDED
    ];
    return !nonRecoverableCodes.includes(this.code);
  }

  /**
   * Check if the operation should be retried
   */
  shouldRetry() {
    const retryableCodes = [
      FILE_SYSTEM_ERROR_CODES.FILE_IN_USE,
      FILE_SYSTEM_ERROR_CODES.FILE_LOCKED,
      FILE_SYSTEM_ERROR_CODES.TOO_MANY_OPEN_FILES,
      FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR,
      FILE_SYSTEM_ERROR_CODES.IO_ERROR
    ];
    return retryableCodes.includes(this.code);
  }

  /**
   * Get suggested retry delay in milliseconds
   */
  getRetryDelay() {
    const delays = {
      [FILE_SYSTEM_ERROR_CODES.FILE_IN_USE]: 1000,
      [FILE_SYSTEM_ERROR_CODES.FILE_LOCKED]: 2000,
      [FILE_SYSTEM_ERROR_CODES.TOO_MANY_OPEN_FILES]: 500,
      [FILE_SYSTEM_ERROR_CODES.NETWORK_ERROR]: 3000,
      [FILE_SYSTEM_ERROR_CODES.IO_ERROR]: 1000
    };
    return delays[this.code] || 1000;
  }

  /**
   * Convert to JSON for logging/serialization
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.getUserFriendlyMessage(),
      metadata: this.metadata,
      timestamp: this.timestamp,
      isRecoverable: this.isRecoverable(),
      shouldRetry: this.shouldRetry(),
      actionableSteps: this.getActionableSteps()
    };
  }

  /**
   * Create a FileSystemError from a Node.js error
   * @param {Error} nodeError - Original Node.js error
   * @param {Object} context - Additional context
   * @returns {FileSystemError}
   */
  static fromNodeError(nodeError, context = {}) {
    const code = NODE_ERROR_CODE_MAP[nodeError.code] || FILE_SYSTEM_ERROR_CODES.UNKNOWN_ERROR;

    return new FileSystemError(code, {
      ...context,
      originalError: nodeError.message,
      originalCode: nodeError.code,
      stack: nodeError.stack
    });
  }

  /**
   * Create error for a specific operation type
   */
  static forOperation(operation, nodeError, filePath) {
    const operationCodeMap = {
      read: FILE_SYSTEM_ERROR_CODES.READ_FAILED,
      write: FILE_SYSTEM_ERROR_CODES.WRITE_FAILED,
      delete: FILE_SYSTEM_ERROR_CODES.DELETE_FAILED,
      rename: FILE_SYSTEM_ERROR_CODES.RENAME_FAILED,
      copy: FILE_SYSTEM_ERROR_CODES.COPY_FAILED,
      move: FILE_SYSTEM_ERROR_CODES.MOVE_FAILED,
      mkdir: FILE_SYSTEM_ERROR_CODES.MKDIR_FAILED,
      rmdir: FILE_SYSTEM_ERROR_CODES.RMDIR_FAILED
    };

    // Use operation-specific code if no specific Node error code match
    const code =
      NODE_ERROR_CODE_MAP[nodeError?.code] ||
      operationCodeMap[operation] ||
      FILE_SYSTEM_ERROR_CODES.UNKNOWN_ERROR;

    return new FileSystemError(code, {
      path: filePath,
      operation,
      originalError: nodeError?.message,
      originalCode: nodeError?.code
    });
  }
}

/**
 * Convenience class for file not found errors
 */
class FileNotFoundError extends FileSystemError {
  constructor(filePath) {
    super(FILE_SYSTEM_ERROR_CODES.FILE_NOT_FOUND, { path: filePath });
  }
}

/**
 * Convenience class for permission denied errors
 */
class PermissionDeniedError extends FileSystemError {
  constructor(filePath, operation) {
    super(FILE_SYSTEM_ERROR_CODES.PERMISSION_DENIED, {
      path: filePath,
      operation
    });
  }
}

/**
 * Convenience class for write failed errors
 */
class WriteFailedError extends FileSystemError {
  constructor(filePath, originalError) {
    super(FILE_SYSTEM_ERROR_CODES.WRITE_FAILED, {
      path: filePath,
      originalError: originalError?.message,
      originalCode: originalError?.code
    });
  }
}

/**
 * Convenience class for watcher errors
 */
class WatcherError extends FileSystemError {
  constructor(watchPath, originalError) {
    super(FILE_SYSTEM_ERROR_CODES.WATCHER_FAILED, {
      path: watchPath,
      originalError: originalError?.message,
      originalCode: originalError?.code
    });
  }
}

/**
 * Convenience class for atomic operation errors
 */
class AtomicOperationError extends FileSystemError {
  constructor(operation, originalError, metadata = {}) {
    super(FILE_SYSTEM_ERROR_CODES.ATOMIC_OPERATION_FAILED, {
      operation,
      originalError: originalError?.message,
      originalCode: originalError?.code,
      ...metadata
    });
  }
}

/**
 * Convenience class for integrity errors (checksum/size mismatch)
 */
class IntegrityError extends FileSystemError {
  constructor(code, filePath, metadata = {}) {
    super(code, {
      path: filePath,
      ...metadata
    });
  }
}

module.exports = {
  FileSystemError,
  FileNotFoundError,
  PermissionDeniedError,
  WriteFailedError,
  WatcherError,
  AtomicOperationError,
  IntegrityError,
  FILE_SYSTEM_ERROR_CODES,
  NODE_ERROR_CODE_MAP
};
