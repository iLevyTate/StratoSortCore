import { requireElectronAPI } from './electronApi';

export const eventsIpc = {
  onOperationProgress(callback) {
    return requireElectronAPI().events.onOperationProgress(callback);
  }
};
