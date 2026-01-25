import { requireElectronAPI } from './electronApi';

export const settingsIpc = {
  get() {
    return requireElectronAPI().settings.get();
  },
  save(settings) {
    return requireElectronAPI().settings.save(settings);
  }
};
