import { requireElectronAPI } from './electronApi';

export const filesIpc = {
  selectDirectory() {
    return requireElectronAPI().files.selectDirectory();
  },
  getDocumentsPath() {
    return requireElectronAPI().files.getDocumentsPath();
  },
  createFolder(fullPath) {
    return requireElectronAPI().files.createFolder(fullPath);
  },
  openFolder(folderPath) {
    return requireElectronAPI().files.openFolder(folderPath);
  }
};
