import { requireElectronAPI } from './electronApi';

function normalizeConfigValueResponse(result) {
  // Expected shape from preload: { success: true, path, value }
  if (
    result &&
    typeof result === 'object' &&
    Object.prototype.hasOwnProperty.call(result, 'success')
  ) {
    if (result.success === false) {
      throw new Error(result.error || 'Failed to read configuration');
    }
    return result.value;
  }
  // Fallback: some implementations might return the raw value directly
  return result;
}

export const systemIpc = {
  async checkForUpdates() {
    const result = await requireElectronAPI().system.checkForUpdates();
    if (result && typeof result === 'object' && result.success === false) {
      throw new Error(result.error || 'Failed to check for updates');
    }
    return result;
  },
  async getConfigValue(path) {
    const result = await requireElectronAPI().system.getConfigValue(path);
    return normalizeConfigValueResponse(result);
  },
  async exportLogs() {
    const result = await requireElectronAPI().system.exportLogs();
    if (result && typeof result === 'object' && result.success === false) {
      throw new Error(result.error || 'Failed to export logs');
    }
    return result;
  }
};
