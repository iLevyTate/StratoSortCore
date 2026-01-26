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
  async getConfigValue(path) {
    const result = await requireElectronAPI().system.getConfigValue(path);
    return normalizeConfigValueResponse(result);
  }
};
