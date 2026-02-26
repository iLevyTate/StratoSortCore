/**
 * IPC Validator
 *
 * Provides event source and result validation helpers.
 */

function createIpcValidator({ log: _log } = {}) {
  const MAX_RESULT_DEPTH = 24;
  const MAX_RESULT_NODES = 20000;
  const MAX_ARRAY_LENGTH = 10000;
  const MAX_OBJECT_KEYS = 5000;
  const MAX_STRING_LENGTH = 500000; // ~500KB per string payload

  /**
   * Validate event source to prevent spoofing.
   *
   * In the preload/renderer context, ipcRenderer.on() events are delivered
   * exclusively by the main process via webContents.send(). The event.sender
   * is the IpcRenderer instance (not a WebContents), so WebContents-specific
   * properties like .id (positive integer) and .getURL() do not exist.
   *
   * We perform structural validation appropriate for the renderer context:
   *   1. `event` must be a non-null object.
   *   2. `event.sender` must exist and be an object (the IpcRenderer instance).
   *   3. If `event.senderFrame` is present (Electron >= 22), its `url` must be
   *      a string (additional structural check).
   */
  const validateEventSource = (event) => {
    if (!event || typeof event !== 'object') {
      return false;
    }

    // Verify sender exists and is an object (IpcRenderer in renderer context)
    if (!event.sender || typeof event.sender !== 'object') {
      return false;
    }

    // If senderFrame is present, verify its url is a string (structural check)
    if (event.senderFrame && typeof event.senderFrame.url !== 'string') {
      return false;
    }

    return true;
  };

  /**
   * Validate system metrics data structure
   */
  const isValidSystemMetrics = (data) => {
    if (!data || typeof data !== 'object') return false;
    const hasUptime = typeof data.uptime === 'number' || typeof data.uptime === 'string';
    const hasMemory =
      (typeof data.memory === 'object' && data.memory !== null) ||
      typeof data.memory?.used === 'number';
    return hasUptime || hasMemory;
  };

  /**
   * Generic payload guard to prevent oversized/deep IPC responses
   * from destabilizing the renderer.
   */
  const isSafePayload = (value) => {
    if (value === null || value === undefined) return true;
    const valueType = typeof value;
    if (valueType === 'string') return value.length <= MAX_STRING_LENGTH;
    if (valueType === 'number' || valueType === 'boolean') return true;
    if (valueType !== 'object') return false;

    const seen = new WeakSet();
    const stack = [{ node: value, depth: 0 }];
    let visitedNodes = 0;

    while (stack.length > 0) {
      const current = stack.pop();
      const { node, depth } = current;

      if (node === null || node === undefined) continue;
      const nodeType = typeof node;

      if (nodeType === 'string') {
        if (node.length > MAX_STRING_LENGTH) return false;
        continue;
      }
      if (nodeType === 'number' || nodeType === 'boolean') continue;
      if (nodeType !== 'object') return false;

      if (depth > MAX_RESULT_DEPTH) return false;
      if (seen.has(node)) continue;
      seen.add(node);

      visitedNodes += 1;
      if (visitedNodes > MAX_RESULT_NODES) return false;

      if (Array.isArray(node)) {
        if (node.length > MAX_ARRAY_LENGTH) return false;
        for (let i = 0; i < node.length; i += 1) {
          stack.push({ node: node[i], depth: depth + 1 });
        }
        continue;
      }

      const keys = Object.keys(node);
      if (keys.length > MAX_OBJECT_KEYS) return false;
      for (let i = 0; i < keys.length; i += 1) {
        stack.push({ node: node[keys[i]], depth: depth + 1 });
      }
    }

    return true;
  };

  /**
   * Validate IPC results
   */
  const validateResult = (result, channel) => {
    if (!isSafePayload(result)) {
      _log?.warn?.('[SecureIPC] Rejected oversized/deep IPC response payload', { channel });
      switch (channel) {
        case 'files:select-directory':
          return { success: false, path: null };
        case 'smart-folders:get-custom':
          return [];
        case 'analysis-history:get':
          return [];
        case 'undo-redo:get-history':
          return [];
        case 'undo-redo:get-state':
          return { stack: [], pointer: -1, canUndo: false, canRedo: false };
        case 'undo-redo:undo':
        case 'undo-redo:redo':
          return {
            success: false,
            message: 'Undo/redo response rejected: payload exceeded safety limits'
          };
        default:
          return {
            success: false,
            error: 'IPC response rejected: payload exceeded safety limits'
          };
      }
    }

    switch (channel) {
      case 'system:get-metrics':
        return isValidSystemMetrics(result) ? result : null;
      case 'files:select-directory':
        return result && typeof result === 'object' && result.success !== undefined
          ? result
          : { success: false, path: null };
      case 'smart-folders:get-custom':
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
