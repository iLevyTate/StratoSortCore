import { requireElectronAPI } from './electronApi';

function callSettings(methodName, ...args) {
  const settingsApi = requireElectronAPI()?.settings;
  if (!settingsApi || typeof settingsApi[methodName] !== 'function') {
    throw new Error(`Settings API method unavailable: ${methodName}`);
  }
  return settingsApi[methodName](...args);
}

export const settingsIpc = {
  get() {
    return callSettings('get');
  },
  save(settings) {
    return callSettings('save', settings);
  },
  getConfigurableLimits() {
    return callSettings('getConfigurableLimits');
  },
  getLogsInfo() {
    return callSettings('getLogsInfo');
  },
  openLogsFolder() {
    return callSettings('openLogsFolder');
  },
  export(exportPath) {
    return callSettings('export', exportPath);
  },
  import(importPath) {
    return callSettings('import', importPath);
  },
  createBackup() {
    return callSettings('createBackup');
  },
  listBackups() {
    return callSettings('listBackups');
  },
  restoreBackup(backupPath) {
    return callSettings('restoreBackup', backupPath);
  },
  deleteBackup(backupPath) {
    return callSettings('deleteBackup', backupPath);
  }
};
