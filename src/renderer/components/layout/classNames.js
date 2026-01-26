/**
 * Small className join helper (avoids new deps).
 */
export function cx(...parts) {
  return parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter(Boolean)
    .join(' ');
}
