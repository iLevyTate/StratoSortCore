/**
 * IPC Validator
 *
 * Provides event source and result validation helpers.
 */

function createIpcValidator() {
  /**
   * Validate event source to prevent spoofing
   */
  const validateEventSource = (event) => event && event.sender && typeof event.sender === 'object';

  /**
   * Validate system metrics data structure
   */
  const isValidSystemMetrics = (data) => {
    if (!data || typeof data !== 'object') return false;
    const hasUptime = typeof data.uptime === 'number' || typeof data.uptime === 'string';
    const hasMemory = typeof data.memory === 'object' || typeof data.memory?.used === 'number';
    return hasUptime || hasMemory;
  };

  /**
   * Validate IPC results
   */
  const validateResult = (result, channel) => {
    switch (channel) {
      case 'get-system-metrics':
        return isValidSystemMetrics(result) ? result : null;
      case 'select-directory':
        return result && typeof result === 'object' && result.success !== undefined
          ? result
          : { success: false, path: null };
      case 'get-custom-folders':
        return Array.isArray(result) ? result : [];
      default:
        return result;
    }
  };

  return {
    validateEventSource,
    validateResult,
    isValidSystemMetrics
  };
}

module.exports = {
  createIpcValidator
};
