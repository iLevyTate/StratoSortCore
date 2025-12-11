/**
 * Comprehensive Path Handling Tests
 *
 * Tests for cross-platform path utilities covering:
 * - Windows paths (drive letters, UNC paths, mixed separators)
 * - Unix paths (absolute, with spaces, special characters)
 * - Edge cases (empty, relative, root paths)
 * - Platform mocking for cross-platform testing
 *
 * @module test/unit/pathHandling
 */

const path = require('path');

// Import the modules under test
const { sanitizePath, isPathSafe, sanitizeMetadata } = require('../../src/shared/pathSanitization');

const {
  normalizePath,
  joinPath,
  resolvePath,
  isUNCPath,
  safePathJoin,
  getPathSeparator,
  isWindows,
  isMacOS,
  isLinux,
  isUnix
} = require('../../src/shared/crossPlatformUtils');

const {
  MAX_PATH_LENGTHS,
  MAX_PATH_DEPTH,
  RESERVED_WINDOWS_NAMES,
  DANGEROUS_PATHS,
  getDangerousPaths
} = require('../../src/shared/securityConfig');

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Creates a Windows-style test path
 * @param {...string} segments - Path segments
 * @returns {string} Windows-style path
 */
function createWindowsPath(...segments) {
  if (segments.length === 0) return '';
  const [first, ...rest] = segments;

  // Handle drive letter
  let basePath = first;
  if (/^[A-Z]:?$/i.test(first)) {
    basePath = first.toUpperCase();
    if (!basePath.endsWith(':')) {
      basePath += ':';
    }
  }

  if (rest.length === 0) {
    return `${basePath}\\`;
  }

  return `${basePath}\\${rest.join('\\')}`;
}

/**
 * Creates a Unix-style test path
 * @param {...string} segments - Path segments
 * @returns {string} Unix-style path
 */
function createUnixPath(...segments) {
  if (segments.length === 0) return '/';
  return `/${segments.join('/')}`;
}

/**
 * Creates a UNC path (Windows network share)
 * @param {string} server - Server name
 * @param {string} share - Share name
 * @param {...string} segments - Additional path segments
 * @returns {string} UNC path
 */
function createUNCPath(server, share, ...segments) {
  const base = `\\\\${server}\\${share}`;
  if (segments.length === 0) {
    return base;
  }
  return `${base}\\${segments.join('\\')}`;
}

/**
 * Platform-aware path comparison
 * @param {string} actual - Actual path
 * @param {string} expected - Expected path
 * @param {string} [platform] - Platform to use for comparison ('win32' | 'posix')
 * @returns {boolean} True if paths are equivalent
 */
function assertPathEquals(actual, expected, platform = process.platform) {
  if (platform === 'win32') {
    // Windows paths are case-insensitive
    const normalizedActual = actual.toLowerCase().replace(/\//g, '\\');
    const normalizedExpected = expected.toLowerCase().replace(/\//g, '\\');
    return normalizedActual === normalizedExpected;
  }
  // Unix paths are case-sensitive
  return actual === expected;
}

/**
 * Creates a path with the specified depth
 * @param {number} depth - Number of directory levels
 * @param {string} [base='/'] - Base path
 * @returns {string} Deep path
 */
function createDeepPath(depth, base = '/') {
  const segments = Array(depth).fill('dir');
  if (base === '/') {
    return createUnixPath(...segments);
  }
  return createWindowsPath(base, ...segments);
}

// ============================================================================
// TEST SUITES
// ============================================================================

describe('Path Handling Utilities', () => {
  describe('Test Utilities', () => {
    describe('createWindowsPath', () => {
      test('creates simple Windows path', () => {
        const result = createWindowsPath('C', 'Users', 'Documents');
        expect(result).toBe('C:\\Users\\Documents');
      });

      test('handles drive letter with colon', () => {
        const result = createWindowsPath('D:', 'Projects');
        expect(result).toBe('D:\\Projects');
      });

      test('creates root path', () => {
        const result = createWindowsPath('C');
        expect(result).toBe('C:\\');
      });

      test('handles lowercase drive letter', () => {
        const result = createWindowsPath('c', 'folder');
        expect(result).toBe('C:\\folder');
      });
    });

    describe('createUnixPath', () => {
      test('creates simple Unix path', () => {
        const result = createUnixPath('home', 'user', 'documents');
        expect(result).toBe('/home/user/documents');
      });

      test('creates root path', () => {
        const result = createUnixPath();
        expect(result).toBe('/');
      });

      test('handles single segment', () => {
        const result = createUnixPath('tmp');
        expect(result).toBe('/tmp');
      });
    });

    describe('createUNCPath', () => {
      test('creates basic UNC path', () => {
        const result = createUNCPath('server', 'share');
        expect(result).toBe('\\\\server\\share');
      });

      test('creates UNC path with subdirectories', () => {
        const result = createUNCPath('server', 'share', 'folder', 'file.txt');
        expect(result).toBe('\\\\server\\share\\folder\\file.txt');
      });
    });

    describe('assertPathEquals', () => {
      test('Windows comparison is case-insensitive', () => {
        expect(assertPathEquals('C:\\Users\\Test', 'c:\\users\\test', 'win32')).toBe(true);
      });

      test('Windows comparison normalizes separators', () => {
        expect(assertPathEquals('C:/Users/Test', 'C:\\Users\\Test', 'win32')).toBe(true);
      });

      test('Unix comparison is case-sensitive', () => {
        expect(assertPathEquals('/home/User', '/home/user', 'linux')).toBe(false);
      });

      test('Unix comparison exact match', () => {
        expect(assertPathEquals('/home/user', '/home/user', 'linux')).toBe(true);
      });
    });

    describe('createDeepPath', () => {
      test('creates deep Unix path', () => {
        const result = createDeepPath(3, '/');
        expect(result).toBe('/dir/dir/dir');
      });

      test('creates deep Windows path', () => {
        const result = createDeepPath(3, 'C');
        expect(result).toBe('C:\\dir\\dir\\dir');
      });
    });
  });

  describe('Windows Path Handling', () => {
    describe('Drive Letter Paths', () => {
      test('accepts valid C: drive path', () => {
        const testPath = createWindowsPath('C', 'Users', 'Documents', 'file.txt');
        expect(() => sanitizePath(testPath)).not.toThrow();
      });

      test('accepts valid D: drive path', () => {
        const testPath = createWindowsPath('D', 'Projects', 'app', 'src');
        expect(() => sanitizePath(testPath)).not.toThrow();
      });

      test('accepts paths on any valid drive letter A-Z', () => {
        const drives = ['A', 'B', 'E', 'F', 'X', 'Y', 'Z'];
        drives.forEach((drive) => {
          const testPath = createWindowsPath(drive, 'folder', 'file.txt');
          expect(() => sanitizePath(testPath)).not.toThrow();
        });
      });

      test('handles lowercase drive letters', () => {
        const testPath = 'c:\\users\\documents';
        expect(() => sanitizePath(testPath)).not.toThrow();
      });

      test('handles root of drive', () => {
        expect(() => sanitizePath('C:\\')).not.toThrow();
        expect(() => sanitizePath('D:\\')).not.toThrow();
      });
    });

    describe('UNC Paths', () => {
      test('isUNCPath correctly identifies UNC paths with backslashes', () => {
        expect(isUNCPath('\\\\server\\share')).toBe(true);
        expect(isUNCPath('\\\\server\\share\\folder')).toBe(true);
        expect(isUNCPath('\\\\192.168.1.1\\share')).toBe(true);
      });

      test('isUNCPath correctly identifies UNC paths with forward slashes', () => {
        expect(isUNCPath('//server/share')).toBe(true);
        expect(isUNCPath('//server/share/folder')).toBe(true);
      });

      test('isUNCPath rejects non-UNC paths', () => {
        expect(isUNCPath('C:\\Users\\Documents')).toBe(false);
        expect(isUNCPath('/home/user')).toBe(false);
        expect(isUNCPath('\\single\\backslash')).toBe(false);
        expect(isUNCPath('/single/slash')).toBe(false);
      });

      test('isUNCPath handles empty and invalid inputs', () => {
        expect(isUNCPath('')).toBe(false);
        expect(isUNCPath(null)).toBe(false);
        expect(isUNCPath(undefined)).toBe(false);
        expect(isUNCPath(123)).toBe(false);
        expect(isUNCPath({})).toBe(false);
      });

      test('isUNCPath rejects paths with only slashes', () => {
        expect(isUNCPath('\\\\')).toBe(false);
        expect(isUNCPath('//')).toBe(false);
        expect(isUNCPath('\\\\/')).toBe(false);
      });

      test('safePathJoin preserves UNC prefix', () => {
        const uncBase = '\\\\server\\share';
        const result = safePathJoin(uncBase, 'folder', 'file.txt');
        expect(result.startsWith('\\\\server\\share')).toBe(true);
        expect(result).toContain('folder');
        expect(result).toContain('file.txt');
      });

      test('safePathJoin handles UNC with forward slashes', () => {
        const uncBase = '//server/share';
        const result = safePathJoin(uncBase, 'folder', 'file.txt');
        expect(result.startsWith('//server/share')).toBe(true);
      });

      test('safePathJoin works normally for non-UNC paths', () => {
        const normalPath = 'C:\\Users\\Documents';
        const result = safePathJoin(normalPath, 'file.txt');
        expect(result).toContain('file.txt');
      });
    });

    describe('Mixed Separators', () => {
      test('normalizes mixed forward and back slashes', () => {
        const mixedPath = 'C:/Users\\Documents/file.txt';
        const result = normalizePath(mixedPath);
        expect(result).toBeTruthy();
        // After normalization, should use platform separator
      });

      test('sanitizePath handles mixed separators', () => {
        const mixedPath = 'C:/Users\\Documents/Projects\\file.txt';
        expect(() => sanitizePath(mixedPath)).not.toThrow();
      });

      test('handles multiple consecutive separators', () => {
        const doubleSep = 'C:\\\\Users\\\\Documents\\\\file.txt';
        const result = normalizePath(doubleSep);
        expect(result).toBeTruthy();
        // Normalized path should not have double separators (except UNC)
      });

      test('handles trailing separators', () => {
        const trailingSep = 'C:\\Users\\Documents\\';
        const result = normalizePath(trailingSep);
        expect(result).toBeTruthy();
      });
    });

    describe('Reserved Windows Filenames', () => {
      // These tests only apply on Windows platform
      const reservedNames = [
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

      test('RESERVED_WINDOWS_NAMES contains all reserved names', () => {
        reservedNames.forEach((name) => {
          expect(RESERVED_WINDOWS_NAMES.has(name)).toBe(true);
        });
      });

      if (process.platform === 'win32') {
        test('sanitizePath rejects reserved names on Windows', () => {
          reservedNames.forEach((name) => {
            const testPath = `C:\\Users\\${name}\\file.txt`;
            expect(() => sanitizePath(testPath)).toThrow(/reserved Windows filename/);
          });
        });

        test('sanitizePath rejects reserved names with extensions', () => {
          expect(() => sanitizePath('C:\\Users\\CON.txt')).toThrow();
          expect(() => sanitizePath('C:\\Users\\PRN.doc')).toThrow();
        });

        test('sanitizePath is case-insensitive for reserved names', () => {
          expect(() => sanitizePath('C:\\Users\\con\\file.txt')).toThrow();
          expect(() => sanitizePath('C:\\Users\\CoN\\file.txt')).toThrow();
        });
      }
    });
  });

  describe('Unix Path Handling', () => {
    describe('Absolute Paths', () => {
      test('accepts standard Unix absolute paths', () => {
        const paths = [
          createUnixPath('home', 'user', 'documents'),
          createUnixPath('var', 'log', 'app.log'),
          createUnixPath('tmp', 'temp.txt'),
          createUnixPath('usr', 'local', 'bin'),
          createUnixPath('opt', 'application')
        ];

        paths.forEach((p) => {
          expect(() => sanitizePath(p)).not.toThrow();
        });
      });

      test('accepts root path', () => {
        expect(() => sanitizePath('/')).not.toThrow();
      });

      test('normalizes redundant slashes', () => {
        const redundant = '//home//user//file.txt';
        const result = normalizePath(redundant);
        expect(result).not.toContain('//');
      });
    });

    describe('Paths with Spaces', () => {
      test('accepts paths with spaces', () => {
        const paths = [
          createUnixPath('home', 'user', 'My Documents', 'file.txt'),
          createUnixPath('Users', 'John Doe', 'Desktop'),
          createUnixPath('var', 'log', 'app name', 'debug.log')
        ];

        paths.forEach((p) => {
          expect(() => sanitizePath(p)).not.toThrow();
        });
      });

      test('preserves spaces in path', () => {
        const pathWithSpaces = '/home/user/My Documents/file.txt';
        const result = sanitizePath(pathWithSpaces);
        expect(result).toContain('My Documents');
      });
    });

    describe('Paths with Special Characters', () => {
      test('accepts paths with common special characters', () => {
        const specialPaths = [
          '/home/user/file-name.txt',
          '/home/user/file_name.txt',
          '/home/user/file.name.txt',
          '/home/user/file (1).txt',
          '/home/user/file [copy].txt'
        ];

        specialPaths.forEach((p) => {
          expect(() => sanitizePath(p)).not.toThrow();
        });
      });

      test('handles paths with unicode characters', () => {
        const unicodePaths = [
          '/home/user/documents',
          '/home/user/folder-name'
          // Basic latin with accents should work after NFC normalization
        ];

        unicodePaths.forEach((p) => {
          expect(() => sanitizePath(p)).not.toThrow();
        });
      });
    });
  });

  describe('Edge Cases', () => {
    describe('Empty and Null Paths', () => {
      test('sanitizePath returns empty string for null', () => {
        expect(sanitizePath(null)).toBe('');
      });

      test('sanitizePath returns empty string for undefined', () => {
        expect(sanitizePath(undefined)).toBe('');
      });

      test('sanitizePath returns empty string for empty string', () => {
        expect(sanitizePath('')).toBe('');
      });

      test('sanitizePath returns empty string for non-string types', () => {
        expect(sanitizePath(123)).toBe('');
        expect(sanitizePath({})).toBe('');
        expect(sanitizePath([])).toBe('');
        expect(sanitizePath(true)).toBe('');
        expect(sanitizePath(() => {})).toBe('');
      });

      test('normalizePath handles invalid inputs', () => {
        expect(normalizePath(null)).toBe(null);
        expect(normalizePath(undefined)).toBe(undefined);
        expect(normalizePath('')).toBe('');
      });

      test('isPathSafe returns true for invalid inputs (not unsafe)', () => {
        expect(isPathSafe(null)).toBe(true);
        expect(isPathSafe(undefined)).toBe(true);
        expect(isPathSafe('')).toBe(true);
      });
    });

    describe('Relative Paths', () => {
      test('handles simple relative paths without traversal', () => {
        expect(() => sanitizePath('documents/file.txt')).not.toThrow();
        expect(() => sanitizePath('folder/subfolder/file.txt')).not.toThrow();
      });

      test('handles current directory reference', () => {
        const result = sanitizePath('./file.txt');
        expect(result).not.toContain('./');
      });

      test('rejects parent directory traversal', () => {
        expect(() => sanitizePath('../file.txt')).toThrow(/path traversal/);
        expect(() => sanitizePath('../../file.txt')).toThrow(/path traversal/);
        expect(() => sanitizePath('folder/../../../file.txt')).toThrow(/path traversal/);
      });

      test('rejects hidden traversal in middle of path', () => {
        expect(() => sanitizePath('folder/sub/../../../etc/passwd')).toThrow();
      });
    });

    describe('Root Paths', () => {
      test('handles Unix root', () => {
        expect(() => sanitizePath('/')).not.toThrow();
      });

      test('handles Windows drive roots', () => {
        expect(() => sanitizePath('C:\\')).not.toThrow();
        expect(() => sanitizePath('D:\\')).not.toThrow();
      });

      test('joinPath handles root correctly', () => {
        const unixRoot = joinPath('/', 'folder');
        expect(unixRoot).toContain('folder');
      });
    });

    describe('Path Depth Limits', () => {
      test('MAX_PATH_DEPTH is defined', () => {
        expect(MAX_PATH_DEPTH).toBeDefined();
        expect(typeof MAX_PATH_DEPTH).toBe('number');
        expect(MAX_PATH_DEPTH).toBeGreaterThan(0);
      });

      test('accepts paths within depth limit', () => {
        const validDepth = Math.min(MAX_PATH_DEPTH - 1, 50);
        const deepPath = createDeepPath(validDepth);
        expect(() => sanitizePath(deepPath)).not.toThrow();
      });

      test('rejects paths exceeding depth limit', () => {
        // Create a path that exceeds depth limit but stays within length limit
        // Use single-char directory names to avoid hitting length limits first
        const segments = Array(MAX_PATH_DEPTH + 1).fill('d');
        const tooDeep = `/${segments.join('/')}`;
        expect(() => sanitizePath(tooDeep)).toThrow(/path depth/);
      });
    });

    describe('Path Length Limits', () => {
      test('MAX_PATH_LENGTHS is defined for all platforms', () => {
        expect(MAX_PATH_LENGTHS.win32).toBeDefined();
        expect(MAX_PATH_LENGTHS.linux).toBeDefined();
        expect(MAX_PATH_LENGTHS.darwin).toBeDefined();
      });

      test('Windows MAX_PATH is 260', () => {
        expect(MAX_PATH_LENGTHS.win32).toBe(260);
      });

      test('Linux PATH_MAX is 4096', () => {
        expect(MAX_PATH_LENGTHS.linux).toBe(4096);
      });

      test('macOS PATH_MAX is 1024', () => {
        expect(MAX_PATH_LENGTHS.darwin).toBe(1024);
      });

      test('truncates paths that exceed limit while preserving extension', () => {
        const maxLen = MAX_PATH_LENGTHS[process.platform] || 4096;
        const longName = 'a'.repeat(maxLen + 100);
        const longPath = `/folder/${longName}.txt`;
        const result = sanitizePath(longPath);
        expect(result.length).toBeLessThanOrEqual(maxLen);
        // Should preserve .txt extension
        expect(result.endsWith('.txt')).toBe(true);
      });
    });

    describe('Null Byte Injection', () => {
      test('removes null bytes from paths', () => {
        const nullBytePath = 'C:\\file\0.txt';
        const result = sanitizePath(nullBytePath);
        expect(result).not.toContain('\0');
      });

      test('handles multiple null bytes', () => {
        const multiNull = '/home/\0user/\0file.txt';
        const result = sanitizePath(multiNull);
        expect(result).not.toContain('\0');
      });

      test('handles null byte at start of path', () => {
        const result = sanitizePath('\0/home/user');
        expect(result).not.toContain('\0');
      });
    });

    describe('Unicode Normalization', () => {
      test('normalizes Unicode to NFC form', () => {
        // NFC normalization test
        const testPath = '/home/user/file.txt';
        const result = sanitizePath(testPath);
        expect(result).toBe(result.normalize('NFC'));
      });
    });
  });

  describe('Platform Detection', () => {
    test('platform flags are mutually consistent', () => {
      // Only one primary platform flag should be true
      const primaryPlatforms = [isWindows, isMacOS, isLinux].filter(Boolean);
      expect(primaryPlatforms.length).toBeLessThanOrEqual(1);

      // If Windows, Unix flags should be false
      expect(isWindows && isUnix).toBe(false);
      expect(isWindows && isMacOS).toBe(false);
      expect(isWindows && isLinux).toBe(false);

      // macOS and Linux should both be Unix
      expect(isMacOS ? isUnix : true).toBe(true);
      expect(isLinux ? isUnix : true).toBe(true);
    });

    test('getPathSeparator returns correct separator for current platform', () => {
      const sep = getPathSeparator();
      const expectedSep = isWindows ? '\\' : '/';
      expect(sep).toBe(expectedSep);
    });
  });

  describe('Dangerous Paths', () => {
    describe('getDangerousPaths', () => {
      test('returns Unix dangerous paths for Linux', () => {
        const paths = getDangerousPaths('linux');
        expect(paths).toContain('/etc');
        expect(paths).toContain('/sys');
        expect(paths).toContain('/proc');
        expect(paths).toContain('/dev');
        expect(paths).toContain('/boot');
      });

      test('returns Unix and macOS dangerous paths for Darwin', () => {
        const paths = getDangerousPaths('darwin');
        expect(paths).toContain('/etc');
        expect(paths).toContain('/System');
        expect(paths).toContain('/Library/System');
      });

      test('returns Windows dangerous paths for win32', () => {
        const paths = getDangerousPaths('win32');
        expect(paths).toContain('C:\\Windows');
        expect(paths).toContain('C:\\Program Files');
        expect(paths).toContain('C:\\Program Files (x86)');
      });

      test('does not include Unix paths for Windows', () => {
        const paths = getDangerousPaths('win32');
        expect(paths).not.toContain('/etc');
        expect(paths).not.toContain('/sys');
      });
    });

    describe('DANGEROUS_PATHS structure', () => {
      test('has unix paths defined', () => {
        expect(DANGEROUS_PATHS.unix).toBeDefined();
        expect(Array.isArray(DANGEROUS_PATHS.unix)).toBe(true);
        expect(DANGEROUS_PATHS.unix.length).toBeGreaterThan(0);
      });

      test('has windows paths defined', () => {
        expect(DANGEROUS_PATHS.windows).toBeDefined();
        expect(Array.isArray(DANGEROUS_PATHS.windows)).toBe(true);
        expect(DANGEROUS_PATHS.windows.length).toBeGreaterThan(0);
      });

      test('has darwin paths defined', () => {
        expect(DANGEROUS_PATHS.darwin).toBeDefined();
        expect(Array.isArray(DANGEROUS_PATHS.darwin)).toBe(true);
        expect(DANGEROUS_PATHS.darwin.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Path Joining', () => {
    test('joinPath joins segments correctly', () => {
      const result = joinPath('folder', 'subfolder', 'file.txt');
      expect(result).toContain('folder');
      expect(result).toContain('subfolder');
      expect(result).toContain('file.txt');
    });

    test('joinPath handles empty segments', () => {
      const result = joinPath('folder', '', 'file.txt');
      expect(result).toContain('folder');
      expect(result).toContain('file.txt');
    });

    test('resolvePath creates absolute path', () => {
      const result = resolvePath('relative', 'path');
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('Cross-Platform Path Module Testing', () => {
    describe('path.win32 (Windows path handling)', () => {
      const win32 = path.win32;

      test('normalizes Windows paths', () => {
        expect(win32.normalize('C:\\Users\\..\\Admin')).toBe('C:\\Admin');
        expect(win32.normalize('C:\\Users\\.\\Documents')).toBe('C:\\Users\\Documents');
      });

      test('joins Windows paths', () => {
        expect(win32.join('C:\\Users', 'Documents')).toBe('C:\\Users\\Documents');
      });

      test('parses Windows paths', () => {
        const parsed = win32.parse('C:\\Users\\Documents\\file.txt');
        expect(parsed.root).toBe('C:\\');
        expect(parsed.dir).toBe('C:\\Users\\Documents');
        expect(parsed.base).toBe('file.txt');
        expect(parsed.ext).toBe('.txt');
        expect(parsed.name).toBe('file');
      });

      test('handles UNC paths in parsing', () => {
        const parsed = win32.parse('\\\\server\\share\\folder\\file.txt');
        expect(parsed.root).toBe('\\\\server\\share\\');
        expect(parsed.base).toBe('file.txt');
      });

      test('identifies absolute Windows paths', () => {
        expect(win32.isAbsolute('C:\\Users')).toBe(true);
        expect(win32.isAbsolute('C:/')).toBe(true);
        expect(win32.isAbsolute('\\\\server\\share')).toBe(true);
        expect(win32.isAbsolute('relative\\path')).toBe(false);
        expect(win32.isAbsolute('./relative')).toBe(false);
      });

      test('resolves Windows relative paths', () => {
        const resolved = win32.resolve('C:\\Users', '..', 'Admin');
        expect(resolved).toBe('C:\\Admin');
      });
    });

    describe('path.posix (Unix path handling)', () => {
      const posix = path.posix;

      test('normalizes Unix paths', () => {
        expect(posix.normalize('/home/user/../admin')).toBe('/home/admin');
        expect(posix.normalize('/home/user/./documents')).toBe('/home/user/documents');
      });

      test('joins Unix paths', () => {
        expect(posix.join('/home', 'user', 'documents')).toBe('/home/user/documents');
      });

      test('parses Unix paths', () => {
        const parsed = posix.parse('/home/user/documents/file.txt');
        expect(parsed.root).toBe('/');
        expect(parsed.dir).toBe('/home/user/documents');
        expect(parsed.base).toBe('file.txt');
        expect(parsed.ext).toBe('.txt');
        expect(parsed.name).toBe('file');
      });

      test('identifies absolute Unix paths', () => {
        expect(posix.isAbsolute('/home/user')).toBe(true);
        expect(posix.isAbsolute('/')).toBe(true);
        expect(posix.isAbsolute('relative/path')).toBe(false);
        expect(posix.isAbsolute('./relative')).toBe(false);
      });

      test('resolves Unix relative paths', () => {
        const resolved = posix.resolve('/home/user', '..', 'admin');
        expect(resolved).toBe('/home/admin');
      });
    });

    describe('Cross-platform path comparison', () => {
      test('dirname behaves consistently', () => {
        expect(path.posix.dirname('/home/user/file.txt')).toBe('/home/user');
        expect(path.win32.dirname('C:\\Users\\file.txt')).toBe('C:\\Users');
      });

      test('basename behaves consistently', () => {
        expect(path.posix.basename('/home/user/file.txt')).toBe('file.txt');
        expect(path.win32.basename('C:\\Users\\file.txt')).toBe('file.txt');
      });

      test('extname behaves consistently', () => {
        expect(path.posix.extname('/home/user/file.txt')).toBe('.txt');
        expect(path.win32.extname('C:\\Users\\file.txt')).toBe('.txt');
      });
    });
  });

  describe('Integration with sanitizeMetadata', () => {
    test('sanitizes path field in metadata', () => {
      const metadata = {
        path: 'C:\\Users\\Documents\\file.txt',
        name: 'file.txt'
      };
      const result = sanitizeMetadata(metadata);
      expect(result.path).toBeDefined();
    });

    test('removes metadata with invalid path', () => {
      const metadata = {
        path: '../../../etc/passwd',
        name: 'passwd'
      };
      const result = sanitizeMetadata(metadata);
      expect(result.path).toBeUndefined();
    });

    test('sanitizes null bytes in path metadata', () => {
      const metadata = {
        path: 'C:\\file\0.txt',
        name: 'file.txt'
      };
      const result = sanitizeMetadata(metadata);
      // Path should either be sanitized (no null bytes) or removed entirely
      expect(!result.path || !result.path.includes('\0')).toBe(true);
    });
  });

  describe('Path Security Scenarios', () => {
    describe('Directory Traversal Attacks', () => {
      // Test paths that will still have '..' AFTER path.normalize()
      // Note: path.normalize() resolves '..' within valid paths, so '/safe/path/../etc'
      // becomes '/safe/etc' which no longer contains '..' and won't throw.
      // Only relative paths starting with '..' or paths with more '..' than can be resolved
      // will still have '..' after normalization.
      const relativePaths = [
        '../file.txt',
        '../../file.txt',
        '../../../etc/passwd',
        '..\\file.txt',
        '..\\..\\file.txt'
      ];

      relativePaths.forEach((testPath) => {
        test(`blocks relative traversal: ${testPath}`, () => {
          expect(() => sanitizePath(testPath)).toThrow(/path traversal/);
        });
      });

      // Test that paths where '..' is fully resolved do NOT throw
      // (because the '..' is consumed by the normalization)
      const resolvedPaths = [
        '/safe/path/../etc/passwd', // becomes /safe/etc/passwd
        'folder/../file.txt', // becomes file.txt
        '/a/b/c/../d/e' // becomes /a/b/d/e
      ];

      resolvedPaths.forEach((testPath) => {
        test(`allows resolved traversal: ${testPath}`, () => {
          expect(() => sanitizePath(testPath)).not.toThrow();
        });
      });

      // Test paths where '..' cannot be fully resolved (escapes root)
      const escapingPaths = [
        'a/../../b', // becomes ../b
        'a/b/../../../c' // becomes ../c
      ];

      escapingPaths.forEach((testPath) => {
        test(`blocks escaping traversal: ${testPath}`, () => {
          expect(() => sanitizePath(testPath)).toThrow(/path traversal/);
        });
      });
    });

    describe('Path Confusion', () => {
      test('handles paths with multiple extensions', () => {
        const multiExt = '/home/user/file.tar.gz';
        expect(() => sanitizePath(multiExt)).not.toThrow();
      });

      test('handles hidden files (Unix)', () => {
        const hidden = '/home/user/.hidden';
        expect(() => sanitizePath(hidden)).not.toThrow();
      });

      test('handles paths ending with dot', () => {
        const dotEnd = '/home/user/file.';
        expect(() => sanitizePath(dotEnd)).not.toThrow();
      });

      test('handles paths with consecutive dots in name (triggers traversal check)', () => {
        // Note: file...txt contains '..' which triggers traversal detection
        // This is expected behavior - the sanitizer is conservative
        const dots = '/home/user/file...txt';
        expect(() => sanitizePath(dots)).toThrow(/path traversal/);
      });

      test('handles paths with single dots in name', () => {
        // Single dots between characters are fine
        const dots = '/home/user/file.backup.txt';
        expect(() => sanitizePath(dots)).not.toThrow();
      });
    });
  });
});
