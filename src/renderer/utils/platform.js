// Platform detection helpers for renderer
// Uses navigator data to avoid relying on Node globals in the sandboxed renderer
const detectedPlatform =
  typeof navigator !== 'undefined'
    ? (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase()
    : '';

export const isMac = detectedPlatform.includes('mac');
export const isWindows = detectedPlatform.includes('win');
export const isLinux = detectedPlatform.includes('linux');

/**
 * Get the platform-specific path separator
 * @returns {string} '\\' for Windows, '/' for Unix-like systems
 */
export function getPathSeparator() {
  return isWindows ? '\\' : '/';
}

/**
 * Join path segments using the platform-specific separator
 * Handles both forward and back slashes in input paths
 * @param {...string} segments - Path segments to join
 * @returns {string} Joined path with correct separators
 */
export function joinPath(...segments) {
  const sep = getPathSeparator();
  const otherSep = isWindows ? '/' : '\\';

  return segments
    .filter((s) => s && typeof s === 'string')
    .map((s) => s.replace(new RegExp(`[${otherSep.replace('\\', '\\\\')}]`, 'g'), sep))
    .join(sep)
    .replace(new RegExp(`[${sep.replace('\\', '\\\\')}]+`, 'g'), sep); // Remove duplicate separators
}

/**
 * Normalize a path to use the platform's separator
 * @param {string} inputPath - Path to normalize
 * @returns {string} Normalized path
 */
export function normalizePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') return inputPath;

  const sep = getPathSeparator();
  const otherSep = isWindows ? '/' : '\\';

  let normalized = inputPath.replace(new RegExp(`[${otherSep.replace('\\', '\\\\')}]`, 'g'), sep);

  // Remove duplicate separators (but preserve UNC paths on Windows)
  if (isWindows && normalized.startsWith('\\\\')) {
    // UNC path - preserve leading \\, normalize the rest
    normalized = `\\\\${normalized.slice(2).replace(/\\+/g, '\\')}`;
  } else {
    normalized = normalized.replace(new RegExp(`[${sep.replace('\\', '\\\\')}]+`, 'g'), sep);
  }

  return normalized;
}

/**
 * Apply a platform-specific class to the document body for styling hooks.
 * Falls back to 'linux' when platform cannot be determined.
 */
export function applyPlatformClass() {
  if (typeof document === 'undefined') return '';

  const resolved = isMac ? 'darwin' : isWindows ? 'win32' : 'linux';
  const className = `platform-${resolved}`;

  if (!document.body.classList.contains(className)) {
    // Remove any previously added platform-* classes to avoid accumulation
    const platformClasses = Array.from(document.body.classList).filter((cls) =>
      cls.startsWith('platform-')
    );
    platformClasses.forEach((cls) => document.body.classList.remove(cls));
    document.body.classList.add(className);
  }

  return className;
}

// Auto-apply on module load for convenience
applyPlatformClass();
