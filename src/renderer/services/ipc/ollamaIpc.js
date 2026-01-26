import { requireElectronAPI } from './electronApi';

export const ollamaIpc = {
  getModels() {
    return requireElectronAPI().ollama.getModels();
  },
  testConnection(hostUrl) {
    return requireElectronAPI().ollama.testConnection(hostUrl);
  },
  pullModels(models) {
    return requireElectronAPI().ollama.pullModels(models);
  },
  deleteModel(model) {
    return requireElectronAPI().ollama.deleteModel(model);
  }
};
