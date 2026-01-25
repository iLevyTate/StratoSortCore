import { requireElectronAPI } from './electronApi';

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
  generateDescription(folderName) {
    return requireElectronAPI().smartFolders.generateDescription(folderName);
  }
};
