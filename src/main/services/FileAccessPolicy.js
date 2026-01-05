const path = require('path');
const { logger } = require('../../shared/logger');

/**
 * FileAccessPolicy
 * Centralizes policy logic for file access, sanitization, and safety checks.
 */
class FileAccessPolicy {
  constructor() {
    this.unsafePatterns = [
      /^\./, // Hidden files
      /node_modules/,
      /\.git/,
      /\.env/
    ];

    // Windows reserved names
    this.reservedNames = [
      'CON',
      'PRN',
      'AUX',
      'NUL',
      'COM1',
      'COM2',
      'COM3',
      'COM4',
      'COM5',
      'COM6',
      'COM7',
      'COM8',
      'COM9',
      'LPT1',
      'LPT2',
      'LPT3',
      'LPT4',
      'LPT5',
      'LPT6',
      'LPT7',
      'LPT8',
      'LPT9'
    ];
  }

  /**
   * Sanitize a filename to be safe for the filesystem
   * Replaces invalid characters with underscores
   */
  sanitizeFilename(filename) {
    if (!filename) return 'unnamed_file';

    // Remove null bytes
    let safe = filename.replace(/\0/g, '');

    // Replace invalid characters based on OS (assuming restrictive Windows rules for cross-platform safety)
    // < > : " / \ | ? *
    safe = safe.replace(/[<>:"/\\|?*]/g, '_');

    // Trim spaces and dots from ends (Windows issue)
    safe = safe.replace(/^[.\s]+|[.\s]+$/g, '');

    // Check reserved names
    const nameWithoutExt = path.parse(safe).name.toUpperCase();
    if (this.reservedNames.includes(nameWithoutExt)) {
      safe = `_${safe}`;
    }

    // Truncate if too long (255 is safe limit for most FS)
    if (safe.length > 255) {
      const ext = path.extname(safe);
      const base = path.basename(safe, ext);
      safe = base.slice(0, 255 - ext.length) + ext;
    }

    return safe || 'unnamed_file';
  }

  /**
   * Check if a path is considered safe to access
   * (Not a system file, not hidden, etc.)
   */
  isPathSafe(filePath) {
    try {
      if (!filePath) return false;

      const basename = path.basename(filePath);

      // Check hidden files (unix style)
      if (basename.startsWith('.') && basename !== '.') return false;

      // Check unsafe patterns
      if (this.unsafePatterns.some((p) => p.test(filePath))) {
        return false;
      }

      return true;
    } catch (e) {
      logger.error('Error checking path safety:', e);
      return false;
    }
  }
}

// Export singleton
const { createSingletonHelpers } = require('../../shared/singletonFactory');

const { getInstance, createInstance, registerWithContainer } = createSingletonHelpers({
  ServiceClass: FileAccessPolicy,
  serviceId: 'FILE_ACCESS_POLICY',
  serviceName: 'FileAccessPolicy',
  containerPath: './ServiceContainer'
});

module.exports = FileAccessPolicy;
module.exports.getInstance = getInstance;
module.exports.createInstance = createInstance;
module.exports.registerWithContainer = registerWithContainer;
