/**
 * Format filesystem paths for UI display.
 *
 * When redaction is enabled, returns an ellipsis + last N path segments:
 * - "C:\\Users\\Alice\\Downloads\\file.pdf" -> "…\\Downloads\\file.pdf"
 * - "/Users/alice/Downloads/file.pdf"       -> "…/Downloads/file.pdf"
 */
export function formatDisplayPath(inputPath, options = {}) {
  const { redact = false, segments = 2 } = options;

  if (typeof inputPath !== 'string') return '';

  const raw = inputPath.trim();
  if (!raw) return '';
  if (!redact) return raw;

  const safeSegments = Number.isInteger(segments) && segments > 0 && segments <= 10 ? segments : 2;

  const separator = raw.includes('\\') ? '\\' : '/';
  const normalized = raw.replace(/[\\/]+/g, separator);
  const parts = normalized.split(separator).filter(Boolean);

  if (parts.length <= safeSegments) return raw;

  const tail = parts.slice(-safeSegments).join(separator);
  return `…${separator}${tail}`;
}
