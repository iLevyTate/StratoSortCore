import { requireElectronAPI } from './electronApi';
import { TIMEOUTS } from '../../../shared/performanceConstants';

const DEFAULT_DESCRIPTION_TIMEOUT_MS = TIMEOUTS.AI_ANALYSIS_SHORT || 30000;

function withDescriptionTimeout(promise, timeoutMs) {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_DESCRIPTION_TIMEOUT_MS;

  let timeoutId;
  const timeoutPromise = new Promise((resolve) => {
    timeoutId = setTimeout(() => {
      resolve({
        success: false,
        error: 'Description generation timed out. Please try again.'
      });
    }, effectiveTimeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

export const smartFoldersIpc = {
  get() {
    return requireElectronAPI().smartFolders.get();
  },
  add(folder) {
    return requireElectronAPI().smartFolders.add(folder);
  },
  edit(folderId, updatedFolder) {
    return requireElectronAPI().smartFolders.edit(folderId, updatedFolder);
  },
  delete(folderId) {
    return requireElectronAPI().smartFolders.delete(folderId);
  },
  resetToDefaults() {
    return requireElectronAPI().smartFolders.resetToDefaults();
  },
  generateDescription(folderName, options = {}) {
    const timeoutMs = options?.timeoutMs;
    return withDescriptionTimeout(
      requireElectronAPI().smartFolders.generateDescription(folderName),
      timeoutMs
    );
  }
};
