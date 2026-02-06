// Ensure global/globalThis polyfills for libraries expecting Node-like globals
if (typeof global === 'undefined') {
  window.global = window;
}
if (typeof globalThis === 'undefined') {
  window.globalThis = window;
}

// Splash safety timeout: if the React app doesn't remove the splash within 8 seconds,
// replace it with a diagnostic message so the user isn't stuck on "Initializing..." forever.
// This fires even if renderer/index.js completely fails to load or execute.
(function splashSafetyNet() {
  var TIMEOUT_MS = 8000;
  var timerId = setTimeout(function () {
    var splash = document.getElementById('initial-loading');
    if (!splash) return; // splash already removed, app loaded fine

    // Collect diagnostic info
    var hasElectronAPI = !!window.electronAPI;
    var hasReactRoot = !!(
      document.getElementById('root') && document.getElementById('root').children.length > 0
    );
    var errors = window.__STRATOSORT_BOOT_ERRORS || [];
    var errorText =
      errors.length > 0
        ? errors
            .map(function (e) {
              return e.message || String(e);
            })
            .join('\n')
        : 'No errors captured (renderer.js may not have loaded)';

    // eslint-disable-next-line no-console -- polyfill runs before logger is available
    console.error('[SPLASH-TIMEOUT] App did not initialize within ' + TIMEOUT_MS + 'ms', {
      hasElectronAPI: hasElectronAPI,
      hasReactRoot: hasReactRoot,
      errorCount: errors.length
    });

    // Replace splash with diagnostic info
    var statusEl = document.getElementById('splash-status');
    if (statusEl) {
      statusEl.textContent = 'Startup timed out';
      statusEl.style.color = '#ef4444';
    }

    // Add diagnostic section below the loader
    var loaderContainer = splash.querySelector('.splash-loader-container');
    if (loaderContainer) {
      var diagDiv = document.createElement('div');
      diagDiv.style.cssText =
        'margin-top:16px;padding:16px;background:#fff;border:1px solid #e5e7eb;border-radius:8px;max-width:480px;text-align:left;font-size:13px;color:#374151;word-break:break-word;';
      diagDiv.innerHTML =
        '<p style="margin:0 0 8px;font-weight:600;">Startup diagnostic</p>' +
        '<p style="margin:0 0 4px;">Electron API: ' +
        (hasElectronAPI ? 'OK' : '<span style="color:#ef4444">MISSING</span>') +
        '</p>' +
        '<p style="margin:0 0 4px;">React mounted: ' +
        (hasReactRoot ? 'Yes' : '<span style="color:#ef4444">No</span>') +
        '</p>' +
        '<pre style="margin:8px 0 0;padding:8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;overflow:auto;max-height:120px;font-size:11px;white-space:pre-wrap;">' +
        errorText +
        '</pre>' +
        '<p style="margin:8px 0 0;font-size:11px;color:#6b7280;">Check the log file at %APPDATA%/stratosort/logs/ for details.</p>';
      loaderContainer.parentNode.insertBefore(diagDiv, loaderContainer.nextSibling);
    }
  }, TIMEOUT_MS);

  // Let the React app cancel the timeout on successful boot
  window.__STRATOSORT_CANCEL_SPLASH_TIMEOUT = function () {
    clearTimeout(timerId);
  };

  // Capture early errors before React's error boundary loads
  window.__STRATOSORT_BOOT_ERRORS = [];
  window.addEventListener('error', function (e) {
    window.__STRATOSORT_BOOT_ERRORS.push({
      message: (e.error ? e.error.message : e.message) || String(e),
      stack: e.error ? e.error.stack : '',
      filename: e.filename,
      lineno: e.lineno
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    window.__STRATOSORT_BOOT_ERRORS.push({
      message: e.reason ? e.reason.message || String(e.reason) : 'unhandled promise rejection',
      stack: e.reason ? e.reason.stack : ''
    });
  });
})();
