// Ensure global/globalThis polyfills for libraries expecting Node-like globals
if (typeof global === 'undefined') {
  window.global = window;
}
if (typeof globalThis === 'undefined') {
  window.globalThis = window;
}
