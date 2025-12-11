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
