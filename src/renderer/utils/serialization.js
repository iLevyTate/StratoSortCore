/**
 * Recursively serializes an object, converting Date objects to ISO strings.
 * Used to sanitize data before storing in Redux to avoid non-serializable value errors.
 */
export const serializeData = (data, _seen) => {
  if (data === null || data === undefined) return data;

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (data instanceof Error) {
    return { message: data.message, name: data.name, stack: data.stack };
  }

  if (Array.isArray(data)) {
    const seen = _seen || new WeakSet();
    if (seen.has(data)) return '[Circular]';
    seen.add(data);
    return data.map((item) => serializeData(item, seen));
  }

  if (typeof data === 'object') {
    const seen = _seen || new WeakSet();
    if (seen.has(data)) return '[Circular]';
    seen.add(data);
    const serialized = {};
    Object.keys(data).forEach((key) => {
      serialized[key] = serializeData(data[key], seen);
    });
    return serialized;
  }

  return data;
};
