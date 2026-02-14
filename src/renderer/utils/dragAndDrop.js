import { normalizeFileUri } from './pathNormalization';

const FILE_DRAG_TYPES = new Set([
  'files',
  'text/uri-list',
  'text/plain',
  'application/x-moz-file',
  'application/x-moz-file-promise'
]);

const collectDataTransferTypes = (dataTransfer) => {
  const types = dataTransfer?.types;
  if (!types) return [];
  if (Array.isArray(types)) return types;
  if (typeof types === 'string') return [types];
  if (typeof types[Symbol.iterator] === 'function') {
    return Array.from(types);
  }
  if (typeof types.length === 'number' && typeof types.item === 'function') {
    const results = [];
    for (let i = 0; i < types.length; i += 1) {
      const value = types.item(i);
      if (value) results.push(value);
    }
    return results;
  }
  return [];
};

export const isFileDragEvent = (event) => {
  const dataTransfer = event?.dataTransfer;
  if (!dataTransfer) return false;

  // Check types first — available during dragenter, dragover, AND drop.
  // dataTransfer.files and dataTransfer.items are empty/restricted during
  // dragenter/dragover in most browsers, so checking them first caused the
  // drop zone to never activate visually.
  const types = collectDataTransferTypes(dataTransfer);
  if (types.some((type) => FILE_DRAG_TYPES.has(String(type).toLowerCase()))) {
    return true;
  }

  if (dataTransfer.files && dataTransfer.files.length > 0) return true;
  if (dataTransfer.items && Array.from(dataTransfer.items).some((item) => item?.kind === 'file')) {
    return true;
  }

  return false;
};

/**
 * Extract file paths and File objects from a DataTransfer.
 *
 * @param {DataTransfer} dataTransfer - The drop event's dataTransfer
 * @param {Object}       [options]
 * @param {Function}     [options.getFilePath] - Resolve a DOM File to its
 *   absolute filesystem path. In Electron with sandbox: true the legacy
 *   File.path property is always empty; pass
 *   `window.electronAPI.files.getPathForFile` to use webUtils instead.
 * @returns {{ paths: string[], fileList: File[], itemFiles: File[] }}
 */
export const extractDroppedFiles = (dataTransfer, options = {}) => {
  if (!dataTransfer) {
    return { paths: [], fileList: [], itemFiles: [] };
  }

  const { getFilePath } = options;

  const resolveFilePath = (file) => {
    // Prefer the Electron webUtils resolver (works in sandboxed renderers)
    if (getFilePath) {
      try {
        const resolved = getFilePath(file);
        if (resolved) return resolved;
      } catch {
        /* fall through to legacy path */
      }
    }
    return file.path || file.name;
  };

  const fileList = Array.from(dataTransfer.files || []);
  const itemFiles = Array.from(dataTransfer.items || [])
    .filter((item) => item?.kind === 'file')
    .map((item) => item.getAsFile?.())
    .filter(Boolean);

  const uriListRaw = dataTransfer.getData?.('text/uri-list') || '';
  const textPlainRaw = dataTransfer.getData?.('text/plain') || '';

  const parsedUris = uriListRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => normalizeFileUri(line));

  const parsedPlainText =
    textPlainRaw && !textPlainRaw.includes('\n')
      ? [normalizeFileUri(textPlainRaw)]
      : textPlainRaw
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => normalizeFileUri(line));

  const collectedPaths = [
    ...fileList.map((file) => normalizeFileUri(resolveFilePath(file))),
    ...itemFiles.map((file) => normalizeFileUri(resolveFilePath(file))),
    ...parsedUris,
    ...parsedPlainText
  ].filter(Boolean);

  return {
    paths: Array.from(new Set(collectedPaths)),
    fileList,
    itemFiles
  };
};
