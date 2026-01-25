/**
 * Central access point for `window.electronAPI`.
 * Keeps feature-detection and errors consistent across the renderer.
 */
export function getElectronAPI() {
  if (typeof window === 'undefined') return null;
  return window.electronAPI || null;
}

export function requireElectronAPI() {
  const api = getElectronAPI();
  if (!api) {
    throw new Error('Electron API not available. Please restart the application.');
  }
  return api;
}
