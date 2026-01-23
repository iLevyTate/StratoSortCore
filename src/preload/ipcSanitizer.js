/**
 * IPC Sanitizer
 *
 * Provides argument and string sanitization for IPC calls.
 */

function createIpcSanitizer({ log }) {
  /**
   * Remove ASCII control characters from a string without using control-char regexes
   */
  const stripControlChars = (str) => {
    if (typeof str !== 'string') return str;
    let output = '';
    for (let i = 0; i < str.length; i += 1) {
      const code = str.charCodeAt(i);
      if (code >= 32) {
        output += str[i];
      }
    }
    return output;
  };

  /**
   * Check if a string looks like a file path
   * File paths typically contain drive letters (Windows) or start with / (Unix)
   */
  const looksLikeFilePath = (str) => {
    if (typeof str !== 'string' || str.length === 0) return false;

    // Check for HTML tags first - if it contains < or >, it's likely HTML, not a file path
    if (str.includes('<') || str.includes('>')) {
      return false;
    }

    // Windows path: C:\ or C:/ (drive letter can be any letter)
    if (/^[A-Za-z]:[\\/]/.test(str)) return true;

    // Unix absolute path: starts with /
    // eslint-disable-next-line no-useless-escape
    if (/^\/[\p{L}\p{N}\p{M}\s._-]/u.test(str)) return true;

    // UNC paths: \\server\share or //server/share
    if (/^[\\/]{2}[\p{L}\p{N}\p{M}\s._-]/u.test(str)) return true;

    // Relative path with typical file extensions
    if (/^[\p{L}\p{N}\p{M}\s_.-]+\/[\p{L}\p{N}\p{M}\s_./-]+\.[\p{L}\p{N}]+$/u.test(str)) {
      return true;
    }

    // If it contains backslash (Windows path separator), it's likely a path
    if (str.includes('\\')) {
      if (!str.includes('=') && !str.includes('"')) {
        return true;
      }
    }

    return false;
  };

  /**
   * Check if a string looks like a URL
   * Used to skip HTML sanitization which would break URL structure
   */
  const looksLikeUrl = (str) => {
    if (typeof str !== 'string' || str.length === 0) return false;

    // Check for HTML tags first - if it contains < or >, it's likely HTML, not a URL
    if (str.includes('<') || str.includes('>')) {
      return false;
    }

    // HTTP/HTTPS URLs
    if (/^https?:\/\//i.test(str)) return true;

    // Common localhost patterns (with port)
    if (/^localhost(:\d+)?/i.test(str)) return true;

    // IP address with optional port
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?/.test(str)) return true;

    // IPv6 URLs
    if (/^\[[\da-fA-F:]+\](:\d+)?/.test(str)) return true;

    return false;
  };

  /**
   * Basic HTML sanitization without external library
   * Removes HTML tags and dangerous characters
   */
  const basicSanitizeHtml = (str) => {
    if (typeof str !== 'string') return str;

    let cleaned = str;

    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*$/gi, '');

    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*$/gi, '');

    cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    cleaned = cleaned.replace(/<[^>]*>?/g, '');

    const openTagIndex = cleaned.indexOf('<');
    if (openTagIndex !== -1) {
      cleaned = cleaned.substring(0, openTagIndex);
    }

    cleaned = cleaned.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return cleaned;
  };

  /**
   * Deep sanitization for objects
   * Fixed: Added prototype pollution protection
   * Fixed: File paths should NOT be HTML sanitized (breaks file system operations)
   */
  const sanitizeObject = (obj, isFilePath = false) => {
    if (typeof obj === 'string') {
      if (isFilePath || looksLikeFilePath(obj)) {
        let sanitized = stripControlChars(obj).replace(/[<>"|?*]/g, '');
        const parts = sanitized.split(/[\\/]+/).filter((segment) => segment.length > 0);
        const hasTraversal = parts.some((segment) => segment === '..');
        if (hasTraversal) {
          log.warn('[SecureIPC] Blocked path traversal attempt in file path');
          const hasLeadingSlash = sanitized.startsWith('/') || sanitized.startsWith('\\\\');
          const filtered = parts.filter((segment) => segment !== '..');
          sanitized = filtered.join('/');
          if (hasLeadingSlash && !/^[a-zA-Z]:/.test(sanitized)) {
            sanitized = `/${sanitized}`;
          }
          sanitized = sanitized.replace(/[/\\]+/g, '/');
        }
        return sanitized;
      }
      if (looksLikeUrl(obj)) {
        return stripControlChars(obj).replace(/[<>"|*]/g, '');
      }
      return basicSanitizeHtml(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeObject(item, isFilePath));
    }

    if (obj && typeof obj === 'object') {
      const sanitized = {};
      const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

      for (const [key, value] of Object.entries(obj)) {
        if (dangerousKeys.includes(key)) {
          log.warn(`Blocked dangerous object key: ${key}`);
          continue;
        }

        const isPathKey = key.toLowerCase().includes('path') || key.toLowerCase().includes('file');
        const cleanKey = isPathKey ? key : basicSanitizeHtml(key);

        if (dangerousKeys.includes(cleanKey)) {
          log.warn(`Blocked dangerous sanitized key: ${cleanKey}`);
          continue;
        }

        sanitized[cleanKey] = sanitizeObject(value, isPathKey);
      }
      return sanitized;
    }

    return obj;
  };

  /**
   * Sanitize arguments to prevent injection attacks
   * Fixed: Detect file path arguments and skip HTML sanitization for them
   */
  const sanitizeArguments = (args) =>
    args.map((arg) => {
      const isFilePath = typeof arg === 'string' && looksLikeFilePath(arg);
      return sanitizeObject(arg, isFilePath);
    });

  return {
    sanitizeArguments,
    sanitizeObject,
    stripControlChars,
    looksLikeFilePath,
    looksLikeUrl,
    basicSanitizeHtml
  };
}

module.exports = {
  createIpcSanitizer
};
