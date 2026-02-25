import { FILE_STATES } from '../../shared/constants';

function isWindowsPath(filePath) {
  return typeof filePath === 'string' && (/^[A-Za-z]:/.test(filePath) || filePath.includes('\\'));
}

function normalizePathKey(filePath) {
  if (typeof filePath !== 'string') return '';
  const normalized = filePath.trim().replace(/[\\/]+/g, '/');
  if (!normalized) return '';
  return isWindowsPath(filePath) ? normalized.toLowerCase() : normalized;
}

function basename(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return '';
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || '';
}

function buildFileFromReadyEntry(entry) {
  const filePath = typeof entry?.path === 'string' ? entry.path : '';
  if (!filePath) return null;
  return {
    path: filePath,
    name: entry?.name || basename(filePath),
    size: Number.isFinite(Number(entry?.size)) ? Number(entry.size) : 0,
    created: entry?.created || null,
    modified: entry?.modified || null
  };
}

function buildResultFromReadyEntry(entry, fileInfo) {
  if (!entry?.analysis || typeof entry.analysis !== 'object') return null;
  return {
    ...fileInfo,
    analysis: entry.analysis,
    status: FILE_STATES.CATEGORIZED,
    analyzedAt: entry?.analyzedAt || new Date().toISOString()
  };
}

function buildFileStateFromReadyEntry(entry, fileInfo) {
  if (!entry?.analysis || typeof entry.analysis !== 'object') return null;
  return {
    state: 'ready',
    analysis: entry.analysis,
    analyzedAt: entry?.analyzedAt || new Date().toISOString(),
    name: fileInfo.name,
    size: fileInfo.size,
    created: fileInfo.created,
    modified: fileInfo.modified
  };
}

export function normalizeReadyQueuePayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.readyFiles)) return payload.readyFiles;
  return [];
}

export function mergeReadyQueueIntoState(existingState, readyEntries) {
  const selectedFiles = Array.isArray(existingState?.selectedFiles)
    ? [...existingState.selectedFiles]
    : [];
  const analysisResults = Array.isArray(existingState?.analysisResults)
    ? [...existingState.analysisResults]
    : [];
  const fileStates =
    existingState?.fileStates && typeof existingState.fileStates === 'object'
      ? { ...existingState.fileStates }
      : {};

  const selectedKeys = new Set(selectedFiles.map((file) => normalizePathKey(file?.path)));
  const resultKeys = new Set(analysisResults.map((result) => normalizePathKey(result?.path)));
  const fileStateKeys = new Set(
    Object.keys(fileStates).map((filePath) => normalizePathKey(filePath))
  );
  const hydratedPathKeys = new Set();
  const addedSelectedFiles = [];
  const addedAnalysisResults = [];
  const addedFileStates = {};

  for (const entry of readyEntries || []) {
    const fileInfo = buildFileFromReadyEntry(entry);
    if (!fileInfo) continue;

    const key = normalizePathKey(fileInfo.path);
    if (!key) continue;

    let touched = false;

    if (!selectedKeys.has(key)) {
      selectedFiles.push(fileInfo);
      addedSelectedFiles.push(fileInfo);
      selectedKeys.add(key);
      touched = true;
    }

    const result = buildResultFromReadyEntry(entry, fileInfo);
    if (result && !resultKeys.has(key)) {
      analysisResults.push(result);
      addedAnalysisResults.push(result);
      resultKeys.add(key);
      touched = true;
    }

    if (!fileStateKeys.has(key)) {
      const state = buildFileStateFromReadyEntry(entry, fileInfo);
      if (state) {
        fileStates[fileInfo.path] = state;
        addedFileStates[fileInfo.path] = state;
        fileStateKeys.add(key);
        touched = true;
      }
    }

    if (touched) {
      hydratedPathKeys.add(key);
    }
  }

  return {
    selectedFiles,
    analysisResults,
    fileStates,
    hydratedCount: hydratedPathKeys.size,
    addedSelectedFiles,
    addedAnalysisResults,
    addedFileStates
  };
}
