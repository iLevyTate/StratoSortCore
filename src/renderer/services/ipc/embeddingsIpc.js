import { requireElectronAPI } from './electronApi';

export const embeddingsIpc = {
  getStats() {
    return requireElectronAPI().embeddings.getStats();
  },
  rebuildFiles() {
    return requireElectronAPI().embeddings.rebuildFiles();
  }
};
