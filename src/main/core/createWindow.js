const { BrowserWindow, shell, app } = require('electron');
const path = require('path');
const { logger } = require('../../shared/logger');
const { TIMEOUTS } = require('../../shared/performanceConstants');
const { bringWindowToForeground } = require('./platformBehavior');

logger.setContext('CreateWindow');
const windowStateKeeper = require('electron-window-state');
const { isDevelopment, getEnvBool, SERVICE_URLS } = require('../../shared/configDefaults');

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
  return path.join(root, 'dist', 'index.html');
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
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    backgroundColor: '#f8fafc', // Align with glass morphism surface-muted tone
    darkTheme: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // FIX CRIT-26: Enable sandbox for better security
      sandbox: false,
      enableRemoteModule: false,
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
    const useDevServer = isDev && getEnvBool('USE_DEV_SERVER');
    if (useDevServer) {
      win.loadURL('http://localhost:3000').catch((error) => {
        logger.info('Development server not available:', error.message);
        logger.info('Loading from built files instead...');
        const distPath = getRendererIndexPath();
        win.loadFile(distPath).catch((fileError) => {
          logger.error('Failed to load from built files, trying original:', fileError);
          win.loadFile(path.join(getAppRootPath(), 'src', 'renderer', 'index.html'));
        });
      });
    } else {
      const distPath = getRendererIndexPath();
      win.loadFile(distPath).catch((error) => {
        logger.error('Failed to load from dist, falling back:', error);
        win.loadFile(path.join(getAppRootPath(), 'src', 'renderer', 'index.html'));
      });
    }
  };

  // CRITICAL FIX: Ensure webContents is ready before loading
  if (win.webContents.isLoading()) {
    win.webContents.once('did-stop-loading', () => {
      setTimeout(loadContent, TIMEOUTS.WINDOW_LOAD_DELAY);
    });
  } else {
    // Add a small delay to ensure window is fully initialized
    setTimeout(loadContent, TIMEOUTS.WINDOW_LOAD_DELAY);
  }

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    let ollamaHost = process.env.OLLAMA_HOST || SERVICE_URLS.OLLAMA_HOST;
    try {
      const { getOllamaHost } = require('../ollamaUtils');
      const configured = typeof getOllamaHost === 'function' ? getOllamaHost() : null;
      if (configured && typeof configured === 'string') {
        ollamaHost = configured;
      }
    } catch (error) {
      logger.debug('Failed to get Ollama host', { error: error.message });
    }

    // Sanitize hosts for CSP to prevent injection attacks
    // Only extract valid URL origins to include in CSP
    let sanitizedOllamaHost = '';
    let wsHost = '';
    try {
      const url = new URL(ollamaHost);
      // Only use the origin (protocol + host) - this prevents CSP injection
      sanitizedOllamaHost = url.origin;
      wsHost = url.protocol === 'https:' ? `wss://${url.host}` : `ws://${url.host}`;
    } catch (error) {
      logger.debug('Failed to parse Ollama host URL', { error: error.message });
      sanitizedOllamaHost = '';
      wsHost = '';
    }

    // Material-UI requires 'unsafe-inline' for styles to work
    // In a more secure setup, we'd use nonces or hashes, but for now we need inline styles
    const styleSrc = "'self' 'unsafe-inline'";
    // Keep script-src strict to avoid Electron CSP warnings; avoid unsafe-eval even in dev
    const scriptSrc = "'self' 'unsafe-eval'";
    const csp = `default-src 'self'; script-src ${scriptSrc}; style-src ${styleSrc}; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${sanitizedOllamaHost} ${wsHost}; object-src 'none'; base-uri 'self'; form-action 'self';`;

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
    // CRITICAL FIX: Add delay before showing window to prevent Mojo interface errors
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.show();

        // Additional delay before focus to ensure window is fully rendered
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
                setTimeout(() => {
                  if (!win.isDestroyed()) {
                    bringWindowToForeground(win);
                    // Second attempt in case DevTools grabs focus again
                    setTimeout(() => {
                      if (!win.isDestroyed()) {
                        bringWindowToForeground(win);
                      }
                    }, 300);
                  }
                }, 100);
              });
              win.webContents.openDevTools({ mode: 'detach' });
            }
          }
        }, 50);
      }
    }, 100);
  });

  win.on('closed', () => {
    // noop; main process holds the reference
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
    const allowedDomains = [
      'https://github.com',
      'https://docs.github.com',
      'https://microsoft.com',
      'https://docs.microsoft.com',
      'https://ollama.ai',
      'https://ollama.com' // FIX HIGH-60: Added ollama.com
    ];
    if (allowedDomains.some((domain) => url.startsWith(domain))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

module.exports = createMainWindow;
