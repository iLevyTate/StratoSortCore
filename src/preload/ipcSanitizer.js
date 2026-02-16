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
      // Preserve tab (9), newline (10), and carriage return (13) -- these are
      // normal whitespace characters used in multi-line user text (chat, notes, descriptions)
      if (code >= 32 || code === 9 || code === 10 || code === 13) {
        output += str[i];
      }
    }
    return output;
  };

  const looksLikeSimpleText = (str) => {
    if (typeof str !== 'string' || str.length === 0) return true;
    // Fast-path common plain text payloads to avoid regex-heavy URL/path detection.
    if (str.includes('<') || str.includes('>') || str.includes('&')) return false;
    if (str.includes('\\') || str.includes('/')) return false;
    if (str.includes('://')) return false;
    if (str.includes(':') && /^[A-Za-z]:/.test(str)) return false;
    if (/^localhost(:\d+)?/i.test(str)) return false;
    return true;
  };

  /**
   * Check if a string looks like a file path
   * File paths typically contain drive letters (Windows) or start with / (Unix)
   */
  const looksLikeFilePath = (str) => {
    if (typeof str !== 'string' || str.length === 0) return false;

    // Check absolute path patterns FIRST — these are definitive path indicators
    // regardless of whether the string also contains HTML-like characters.
    // This prevents a path like "C:\Users\..\Windows<tag>" from bypassing
    // path traversal checks by falling through to HTML sanitization.

    // Windows path: C:\ or C:/ (drive letter can be any letter)
    if (/^[A-Za-z]:[\\/]/.test(str)) return true;

    // Unix absolute path: starts with /
    if (/^\/[\p{L}\p{N}\p{M}\s._-]/u.test(str)) return true;

    // UNC paths: \\server\share or //server/share
    if (/^[\\/]{2}[\p{L}\p{N}\p{M}\s._-]/u.test(str)) return true;

    // For non-absolute patterns, HTML tags indicate non-path strings
    if (str.includes('<') || str.includes('>')) {
      return false;
    }

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

    // Remove dangerous executable tags (script, style, iframe)
    cleaned = cleaned.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    cleaned = cleaned.replace(/<script\b[^>]*>[\s\S]*$/gi, '');

    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    cleaned = cleaned.replace(/<style\b[^>]*>[\s\S]*$/gi, '');

    cleaned = cleaned.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

    // FIX: Do NOT strip generic HTML tags, truncate at '<', or entity-encode < and >.
    // IPC data is rendered through React JSX which auto-escapes, so entity encoding
    // is unnecessary. The previous code corrupted user text like "size < 10MB",
    // search queries with comparison operators, and folder descriptions.
    // Only strip control chars from the result.
    return stripControlChars(cleaned);
  };

  /**
   * Deep sanitization for objects
   * Fixed: Added prototype pollution protection
   * Fixed: File paths should NOT be HTML sanitized (breaks file system operations)
   */
  const MAX_SANITIZE_DEPTH = 32;
  const depthLimitedFallback = (value) => {
    if (typeof value === 'string') return stripControlChars(value);
    if (Array.isArray(value)) return [];
    if (value && typeof value === 'object') return {};
    return value;
  };

  const sanitizeObject = (obj, isFilePath = false, _depth = 0) => {
    if (_depth > MAX_SANITIZE_DEPTH) {
      log.warn('[SecureIPC] Sanitization depth limit reached, returning safe fallback value');
      return depthLimitedFallback(obj);
    }

    if (typeof obj === 'string') {
      const stripped = stripControlChars(obj);
      if (!isFilePath && looksLikeSimpleText(stripped)) {
        return stripped;
      }
      if (isFilePath || looksLikeFilePath(stripped)) {
        // Only strip ? and * on Windows where they are invalid in filenames.
        // process.platform may be undefined in bundled preload (process/browser polyfill),
        // so fall back to navigator.platform which is always available in Electron's renderer context.
        const isWin =
          (typeof navigator !== 'undefined' && /^Win/i.test(navigator.platform)) ||
          (typeof process !== 'undefined' && process.platform === 'win32');
        const invalidCharsPattern = isWin ? /[<>"|?*]/g : /[<>"]/g;
        let sanitized = stripped.replace(invalidCharsPattern, '');

        // Decode percent-encoded sequences before traversal check to catch
        // encoded variants like %2e%2e, %2E%2E, or double-encoded forms
        let decoded = sanitized;
        try {
          let prev;
          do {
            prev = decoded;
            decoded = decodeURIComponent(decoded);
          } while (decoded !== prev);
        } catch {
          // If decoding fails, use the original sanitized value
          decoded = sanitized;
        }

        const parts = decoded.split(/[\\/]+/).filter((segment) => segment.length > 0);
        const hasTraversal = parts.some((segment) => segment === '..');
        if (hasTraversal) {
          log.warn('[SecureIPC] Blocked path traversal attempt in file path:', {
            originalLength: obj.length
          });
          return '';
        }
        return sanitized;
      }
      if (looksLikeUrl(stripped)) {
        return stripped.replace(/[<>"|*]/g, '');
      }
      return basicSanitizeHtml(stripped);
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => sanitizeObject(item, isFilePath, _depth + 1));
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
        const cleanKey = isPathKey
          ? key
          : looksLikeSimpleText(key)
            ? stripControlChars(key)
            : basicSanitizeHtml(key);

        if (dangerousKeys.includes(cleanKey)) {
          log.warn(`Blocked dangerous sanitized key: ${cleanKey}`);
          continue;
        }

        sanitized[cleanKey] = sanitizeObject(value, isPathKey, _depth + 1);
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
