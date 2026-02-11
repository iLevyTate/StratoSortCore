const { BrowserWindow, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('../../shared/logger');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { bringWindowToForeground } = require('./platformBehavior');

const logger = createLogger('CreateWindow');
const windowStateKeeper = require('electron-window-state');
const { isDevelopment, getEnvBool } = require('../../shared/configDefaults');

const isDev = isDevelopment();
const isMac = process.platform === 'darwin';

function getAppRootPath() {
  // Works in both dev (repo root) and packaged (app.asar)
  try {
    const appPath = app.getAppPath();
    // When running from src/main/simple-main.js, app.getAppPath() returns src/main
    // We need to go up to the repo root in that case
    if (appPath.endsWith('src/main') || appPath.endsWith('src\\main')) {
      return path.resolve(appPath, '../..');
    }
    // When running from dist/main.js, app.getAppPath() can return dist
    if (appPath.endsWith('dist') || appPath.endsWith('dist\\')) {
      return path.resolve(appPath, '..');
    }
    return appPath;
  } catch {
    return process.cwd();
  }
}

const getAssetPath = (...paths) => {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(getAppRootPath(), 'assets');
  return path.join(base, ...paths);
};

function getPreloadPath() {
  // In dev and in packaged builds, main/preload are emitted to `dist/`
  // We avoid using `__dirname` because webpack outputs `dist/main.js` and the old
  // relative traversal can accidentally resolve outside the repo (as seen in logs).
  const root = getAppRootPath();
  return path.join(root, 'dist', 'preload.js');
}

function getRendererIndexPath() {
  const root = getAppRootPath();
  const distCandidate = path.join(root, 'dist', 'index.html');
  if (fs.existsSync(distCandidate)) {
    return distCandidate;
  }
  const directCandidate = path.join(root, 'index.html');
  if (fs.existsSync(directCandidate)) {
    return directCandidate;
  }
  return distCandidate;
}

function createMainWindow() {
  logger.debug('Creating new window');

  // Ensure AppUserModelID for Windows integration (notifications, jump list)
  try {
    app.setAppUserModelId('com.stratosort.app');
  } catch (error) {
    logger.debug('Failed to set AppUserModelId', { error: error.message });
  }

  // Restore previous window position/size
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1400,
    defaultHeight: 900
  });

  logger.debug('Window state loaded', {
    width: mainWindowState.width,
    height: mainWindowState.height,
    x: mainWindowState.x,
    y: mainWindowState.y,
    isMaximized: mainWindowState.isMaximized,
    isFullScreen: mainWindowState.isFullScreen
  });

  // FIX: Check if saved bounds are near-maximized and reset to defaults (Issue 3.2)
  // This prevents the maximize button from only changing size by ~1px
  // Improved threshold: Only reset if VERY close to maximized (within 20px) to avoid
  // resetting users who intentionally want large windows.
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const savedIsMaximized = Boolean(mainWindowState.isMaximized);
  const savedIsFullScreen = Boolean(mainWindowState.isFullScreen);

  // Use a tight threshold (20px) to avoid false positives
  const widthDiff = screenWidth - mainWindowState.width;
  const heightDiff = screenHeight - mainWindowState.height;
  const isNearMaximized = widthDiff >= 0 && widthDiff <= 20 && heightDiff >= 0 && heightDiff <= 20;

  // Only reset if we are essentially maximized but the state says we aren't
  const shouldResetToDefault = !savedIsMaximized && !savedIsFullScreen && isNearMaximized;

  const windowWidth = shouldResetToDefault ? 1400 : mainWindowState.width;
  const windowHeight = shouldResetToDefault ? 900 : mainWindowState.height;
  const windowX = shouldResetToDefault ? undefined : mainWindowState.x;
  const windowY = shouldResetToDefault ? undefined : mainWindowState.y;

  if (shouldResetToDefault) {
    logger.debug(
      'Window state near-maximized but not maximized, resetting to defaults to fix maximize behavior',
      {
        savedWidth: mainWindowState.width,
        savedHeight: mainWindowState.height,
        screenWidth,
        screenHeight
      }
    );
  }

  const win = new BrowserWindow({
    x: windowX,
    y: windowY,
    width: windowWidth,
    height: windowHeight,
    minWidth: 800,
    minHeight: 600,
    // Frameless chrome with platform-sensitive styling
    frame: !!isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { windowButtonPosition: { x: 16, y: 16 } } : {}),
    backgroundColor: '#f8fafc', // Align with glass morphism surface-muted tone
    darkTheme: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sandbox enabled: preload script is bundled with webpack (target: 'web')
      // and only uses contextBridge to expose safe APIs.
      sandbox: true,
      preload: getPreloadPath(),
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      backgroundThrottling: false,
      devTools: isDev,
      hardwareAcceleration: true,
      enableWebGL: true,
      safeDialogs: true,
      // CRITICAL FIX: Add offscreen to prevent Mojo interface errors
      offscreen: false,
      // CRITICAL FIX: Disable features that can cause Mojo errors
      webviewTag: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false
    },
    icon: getAssetPath('stratosort-logo.png'),
    show: false,
    autoHideMenuBar: true // Keep menu accessible via Alt while preserving a clean chrome
  });

  logger.debug('BrowserWindow created');

  // Manage window state with cleanup tracking
  mainWindowState.manage(win);

  // Restore saved window states so user sizing persists between runs
  if (savedIsFullScreen) {
    win.setFullScreen(true);
  } else if (savedIsMaximized) {
    win.maximize();
  }

  // FIX: Force electron-window-state to save immediately on close
  // The library uses debounced saves which may not complete if window closes quickly
  // We call saveState() directly to ensure state is persisted synchronously
  win.on('close', () => {
    try {
      const isMaximized = win.isMaximized();
      const isFullScreen = win.isFullScreen();

      logger.debug('Window closing, triggering state save', {
        isMaximized,
        isFullScreen
      });

      // Force electron-window-state to save immediately
      // This uses its internal tracking which properly handles pre-maximized bounds
      mainWindowState.saveState(win);
      logger.debug('Window state saved via electron-window-state');
    } catch (e) {
      logger.warn('Could not save window state on close', { error: e.message });
    }
  });

  // Add cleanup for window state keeper on window close
  win.once('closed', () => {
    try {
      mainWindowState.unmanage();
    } catch {
      // State keeper might already be cleaned up
    }
  });

  // CRITICAL FIX: Add longer delay and webContents readiness check to prevent Mojo errors
  // Wait for webContents to be fully ready before loading content
  const loadContent = () => {
    const renderMissingBundle = (reason, attemptedPath) => {
      logger.error('[WINDOW] Renderer bundle missing', { reason, attemptedPath });
      const helpText = isDev
        ? 'Run `npm run build:dev` or `npm run dev` to generate renderer assets.'
        : 'Reinstall the app or rebuild the package.';
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>StratoSort</title></head><body style="font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#1f2937;background:#f8fafc;"><h1 style="margin:0 0 12px;">StratoSort failed to load</h1><p style="margin:0 0 12px;">${reason}</p><p style="margin:0 0 12px;">${helpText}</p><pre style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px;overflow:auto;">${attemptedPath}</pre></body></html>`;
      win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
    };

    const loadRendererFromFile = () => {
      const distPath = getRendererIndexPath();
      if (!fs.existsSync(distPath)) {
        renderMissingBundle('Renderer bundle not found.', distPath);
        return;
      }
      win.loadFile(distPath).catch((error) => {
        renderMissingBundle('Failed to load renderer bundle.', distPath);
        logger.error('Failed to load renderer bundle:', error);
      });
    };

    const useDevServer = isDev && getEnvBool('USE_DEV_SERVER');
    if (useDevServer) {
      win.loadURL('http://localhost:3000').catch((error) => {
        logger.info('Development server not available:', error.message);
        logger.info('Loading from built files instead...');
        loadRendererFromFile();
      });
    } else {
      loadRendererFromFile();
    }
  };

  // CRITICAL FIX: Ensure webContents is ready before loading
  // FIX: Store timer ID so it can be cleared if window is destroyed before it fires
  let _loadTimerId = null;
  const scheduleLoad = () => {
    _loadTimerId = setTimeout(loadContent, TIMEOUTS.WINDOW_LOAD_DELAY);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-stop-loading', scheduleLoad);
  } else {
    // Add a small delay to ensure window is fully initialized
    scheduleLoad();
  }
  win.once('closed', () => {
    if (_loadTimerId) clearTimeout(_loadTimerId);
  });

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    // Material-UI requires 'unsafe-inline' for styles to work
    // In a more secure setup, we'd use nonces or hashes, but for now we need inline styles
    const styleSrc = "'self' 'unsafe-inline'";
    // Keep script-src strict — no unsafe-eval even in dev (webpack is configured for
    // source-map devtool which doesn't require eval)
    const scriptSrc = "'self'";
    const csp = `default-src 'self'; script-src ${scriptSrc}; style-src ${styleSrc}; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self';`;

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'], // Prevent clickjacking
        'X-XSS-Protection': ['1; mode=block'], // Legacy XSS protection
        'Referrer-Policy': ['no-referrer'],
        // COOP/COEP can break some integrations; set COOP only
        'Cross-Origin-Opener-Policy': ['same-origin'],
        'Cross-Origin-Resource-Policy': ['same-origin'],
        // Disable sensitive features by default, but allow clipboard for copy path functionality
        'Permissions-Policy': [
          [
            'accelerometer=(), autoplay=(), camera=(), clipboard-read=(self), clipboard-write=(self), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()'
          ].join('')
        ]
      }
    });
  });

  win.once('ready-to-show', () => {
    // FIX: Track all nested timer IDs so they can be cleared on window close
    const pendingTimers = [];
    const track = (id) => {
      pendingTimers.push(id);
      return id;
    };
    win.once('closed', () => pendingTimers.forEach(clearTimeout));

    // CRITICAL FIX: Add delay before showing window to prevent Mojo interface errors
    track(
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.show();

          // Additional delay before focus to ensure window is fully rendered
          track(
            setTimeout(() => {
              if (!win.isDestroyed()) {
                win.focus();
                logger.info('StratoSort window ready and focused');
                logger.debug('Window state', {
                  isVisible: win.isVisible(),
                  isFocused: win.isFocused(),
                  isMinimized: win.isMinimized()
                });

                // Auto-open DevTools in development mode or when forced via env var
                // Opened after window is ready to ensure detached window displays properly
                if (isDev || getEnvBool('FORCE_DEV_TOOLS')) {
                  // FIX: Listen for devtools-opened event to bring main window to foreground
                  // This ensures we act after DevTools has fully opened and stolen focus
                  win.webContents.once('devtools-opened', () => {
                    // Small delay to let DevTools finish rendering
                    track(
                      setTimeout(() => {
                        if (!win.isDestroyed()) {
                          bringWindowToForeground(win);
                          // Second attempt in case DevTools grabs focus again
                          track(
                            setTimeout(() => {
                              if (!win.isDestroyed()) {
                                bringWindowToForeground(win);
                              }
                            }, 300)
                          );
                        }
                      }, 100)
                    );
                  });
                  win.webContents.openDevTools({ mode: 'detach' });
                }
              }
            }, 50)
          );
        }
      }, 100)
    );
  });

  win.on('closed', () => {
    // noop; main process holds the reference
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error('[WINDOW] did-fail-load', {
      errorCode,
      errorDescription,
      validatedURL
    });
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[WINDOW] Render process gone', details);
  });

  // Capture renderer console output for diagnosis (always enabled)
  // Electron 40 still passes positional args (deprecated); fall back to event properties
  win.webContents.on('console-message', (_event, levelArg, messageArg, lineArg, sourceIdArg) => {
    const level = typeof levelArg === 'number' ? levelArg : (_event?.level ?? 0);
    const message =
      typeof messageArg === 'string' ? messageArg : (_event?.message ?? String(messageArg));
    const line = typeof lineArg === 'number' ? lineArg : (_event?.line ?? 0);
    const sourceId = typeof sourceIdArg === 'string' ? sourceIdArg : (_event?.sourceId ?? '');
    const prefix = '[RENDERER]';
    const meta = { line, sourceId: sourceId ? sourceId.split('/').pop() : '' };

    const normalizedMessage =
      typeof message === 'string'
        ? message.trim().replace(/^['"](.*)['"]$/, '$1')
        : String(message);

    // Pino's browser logger calls console.* with structured objects which serialise
    // as "[object Object]" through Electron's console-message event. Chromium may
    // wrap the literal value in quotes, so normalize first and drop both forms.
    // Structured log payloads are already forwarded via window.electronAPI.system.log.
    if (normalizedMessage === '[object Object]') {
      return;
    }

    if (level >= 3) {
      logger.error(`${prefix} ${normalizedMessage}`, meta);
    } else if (level >= 2) {
      logger.warn(`${prefix} ${normalizedMessage}`, meta);
    } else {
      logger.info(`${prefix} ${normalizedMessage}`, meta);
    }
  });

  // Log when the page finishes loading for startup diagnosis
  win.webContents.on('did-finish-load', () => {
    logger.info('[WINDOW] did-finish-load fired');
    // Check splash status after page load to detect stuck splash
    win.webContents
      .executeJavaScript('document.getElementById("splash-status")?.textContent || "NO_SPLASH"')
      .then((status) => {
        logger.info('[WINDOW] Splash status after load: ' + status);
      })
      .catch(() => {});

    // Delayed health check: verify the app fully rendered after 5s
    // FIX: Store timer ID for cleanup on window close
    const _healthCheckTimerId = setTimeout(() => {
      if (win.isDestroyed()) return;
      win.webContents
        .executeJavaScript(
          `JSON.stringify({
        splashPresent: !!document.getElementById('initial-loading'),
        rootChildren: document.getElementById('root')?.children?.length ?? 0,
        hasElectronAPI: !!window.electronAPI,
        bootErrors: (window.__STRATOSORT_BOOT_ERRORS || []).length
      })`
        )
        .then((json) => {
          const state = JSON.parse(json);
          if (state.splashPresent || state.bootErrors > 0 || state.rootChildren === 0) {
            logger.error('[WINDOW] Post-load check: app may not have rendered', state);
          } else {
            logger.info('[WINDOW] Post-load check: app rendered successfully');
          }
        })
        .catch(() => {});
    }, 5000);
    win.once('closed', () => clearTimeout(_healthCheckTimerId));
  });

  // Block navigation attempts within the app (e.g., dropped links or external redirects)
  win.webContents.on('will-navigate', (event, url) => {
    try {
      // Always prevent in-app navigations; open externally only if explicitly allowed elsewhere
      event.preventDefault();
      logger.debug('Blocked navigation attempt', { url });
    } catch (error) {
      logger.debug('Error blocking navigation', { error: error.message });
    }
  });

  // Disallow embedding arbitrary webviews
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    logger.warn('Blocked webview attachment attempt');
  });

  // Deny all permission requests by default, but allow clipboard access
  try {
    win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
      // FIX: Allow clipboard read/write permissions for features like "Copy Path"
      if (permission === 'clipboard-read' || permission === 'clipboard-sanitized-write') {
        callback(true);
        return;
      }
      logger.debug('Denied permission request', { permission });
      callback(false);
    });
  } catch (error) {
    logger.debug('Failed to set permission handler', { error: error.message });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // SECURITY: Use URL hostname matching instead of startsWith to prevent
    // subdomain bypass (e.g., github.com.evil.com matching github.com)
    const allowedHosts = [
      'github.com',
      'docs.github.com',
      'microsoft.com',
      'docs.microsoft.com',
      'huggingface.co'
    ];
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol === 'https:' &&
        allowedHosts.some(
          (host) => parsed.hostname === host || parsed.hostname.endsWith('.' + host)
        )
      ) {
        shell.openExternal(url).catch(() => {});
      }
    } catch {
      // Invalid URL -- deny silently
    }
    return { action: 'deny' };
  });

  return win;
}

module.exports = createMainWindow;
