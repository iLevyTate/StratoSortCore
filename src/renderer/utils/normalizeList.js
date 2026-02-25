/**
 * Normalize a value into a flat, deduplicated array of non-empty strings.
 * Accepts an array (filters falsy entries) or a comma-separated string.
 * Always returns a new array — safe to mutate / slice.
 */
export default function normalizeList(value) {
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean))];
  if (typeof value === 'string' && value.trim().length > 0) {
    return [
      ...new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ];
  }
  return [];
}
