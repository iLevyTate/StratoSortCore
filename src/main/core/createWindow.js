const { BrowserWindow, shell, app } = require('electron');
const path = require('path');
const { logger } = require('../../shared/logger');
logger.setContext('CreateWindow');
const windowStateKeeper = require('electron-window-state');
const { isDevelopment, getEnvBool } = require('../../shared/configDefaults');

const isDev = isDevelopment();

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
    defaultWidth: 1440,
    defaultHeight: 900,
  });

  const win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    minWidth: 1024,
    minHeight: 768,
    // Use native frame with dark theme
    frame: true,
    backgroundColor: '#0f0f10', // Dark background while loading
    darkTheme: true, // Force dark theme on Windows
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      enableRemoteModule: false,
      preload: path.join(__dirname, '../../preload/preload.js'),
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
      nodeIntegrationInSubFrames: false,
    },
    icon: path.join(__dirname, '../../../assets/stratosort-logo.png'),
    show: false,
    titleBarStyle: 'default',
    autoHideMenuBar: false, // Keep menu bar visible
  });

  logger.debug('BrowserWindow created');

  // Manage window state with cleanup tracking
  mainWindowState.manage(win);

  // Add cleanup for window state keeper on window close
  win.once('closed', () => {
    try {
      mainWindowState.unmanage();
    } catch (e) {
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
        const distPath = path.join(__dirname, '../../../dist/index.html');
        win.loadFile(distPath).catch((fileError) => {
          logger.error(
            'Failed to load from built files, trying original:',
            fileError,
          );
          win.loadFile(path.join(__dirname, '../../renderer/index.html'));
        });
      });
      if (getEnvBool('FORCE_DEV_TOOLS')) {
        win.webContents.openDevTools();
      }
    } else {
      const distPath = path.join(__dirname, '../../../dist/index.html');
      win.loadFile(distPath).catch((error) => {
        logger.error('Failed to load from dist, falling back:', error);
        win.loadFile(path.join(__dirname, '../../renderer/index.html'));
      });
    }
  };

  // CRITICAL FIX: Ensure webContents is ready before loading
  if (win.webContents.isLoading()) {
    win.webContents.once('did-stop-loading', () => {
      setTimeout(loadContent, 100);
    });
  } else {
    // Add a small delay to ensure window is fully initialized
    setTimeout(loadContent, 100);
  }

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    let ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    try {
      const { getOllamaHost } = require('../ollamaUtils');
      const configured =
        typeof getOllamaHost === 'function' ? getOllamaHost() : null;
      if (configured && typeof configured === 'string') {
        ollamaHost = configured;
      }
    } catch (error) {
      logger.debug('Failed to get Ollama host', { error: error.message });
    }
    let wsHost = '';
    try {
      const url = new URL(ollamaHost);
      wsHost =
        url.protocol === 'https:' ? `wss://${url.host}` : `ws://${url.host}`;
    } catch (error) {
      logger.debug('Failed to parse Ollama host URL', { error: error.message });
      wsHost = '';
    }

    // Material-UI requires 'unsafe-inline' for styles to work
    // In a more secure setup, we'd use nonces or hashes, but for now we need inline styles
    const styleSrc = "'self' 'unsafe-inline'";
    const csp = `default-src 'self'; script-src 'self'; style-src ${styleSrc}; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${ollamaHost} ${wsHost}; object-src 'none'; base-uri 'self'; form-action 'self';`;

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
        // Disable sensitive features by default
        'Permissions-Policy': [
          [
            'accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=()',
          ].join(''),
        ],
      },
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
              isMinimized: win.isMinimized(),
            });
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

  // Deny all permission requests by default (camera, mic, etc.)
  try {
    win.webContents.session.setPermissionRequestHandler(
      (_wc, permission, callback) => {
        logger.debug('Denied permission request', { permission });
        callback(false);
      },
    );
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
    ];
    if (allowedDomains.some((domain) => url.startsWith(domain))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

module.exports = createMainWindow;
