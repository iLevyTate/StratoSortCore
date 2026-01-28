import { normalizeText } from '../../shared/normalization/text';
import { safeBasename } from './pathUtils';

const coercePathValue = (value) => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.path === 'string') {
    return value.path;
  }
  return '';
};

const stripWrappingQuotes = (value) => value.replace(/^(['"])(.*)\1$/, '$2');

const decodeFileUrl = (value) => {
  if (!value.toLowerCase().startsWith('file://')) return value;
  try {
    const url = new URL(value);
    const pathname = decodeURIComponent(url.pathname || '');
    if (/^\/[a-zA-Z]:[\\/]/.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return value;
  }
};

export const normalizePathValue = (value, options = {}) => {
  const raw = coercePathValue(value);
  if (!raw) return '';
  const { maxLength = 2048, collapseWhitespace = true } = options;
  const trimmed = normalizeText(raw, { maxLength, collapseWhitespace, trim: true });
  const unquoted = stripWrappingQuotes(trimmed);
  return decodeFileUrl(unquoted);
};

export const normalizeFileUri = (value, options = {}) =>
  normalizePathValue(value, {
    ...options,
    collapseWhitespace: options.collapseWhitespace ?? false
  });

export const isAbsolutePath = (value, options = {}) => {
  const normalized = normalizePathValue(value, options);
  if (!normalized) return false;
  return (
    /^[a-zA-Z]:[\\/]/.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('/')
  );
};

export const extractFileName = (value) => safeBasename(coercePathValue(value));
