/**
 * Global test setup for DOM-dependent packages
 * Sets up necessary globals before tests run
 */

// Polyfill setImmediate for test environment (Node.js function not available in jsdom)
if (typeof setImmediate === 'undefined') {
  global.setImmediate = (fn, ...args) => setTimeout(fn, 0, ...args);
  global.clearImmediate = (id) => clearTimeout(id);
}

// Patch setTimeout to add unref() method (needed by DownloadWatcher)
// jsdom timers don't have unref() which is a Node.js-specific method
const originalSetTimeout = global.setTimeout;
global.setTimeout = (...args) => {
  const timer = originalSetTimeout(...args);
  if (timer && typeof timer === 'object' && !timer.unref) {
    timer.unref = () => timer;
    timer.ref = () => timer;
  }
  return timer;
};

// Mock DOM globals that packages like officeparser expect
global.window = global.window || {
  location: { href: 'http://localhost' },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  navigator: {
    userAgent: 'Test'
  }
};

global.document = global.document || {
  querySelector: jest.fn(),
  querySelectorAll: jest.fn(() => []),
  createElement: jest.fn(() => ({
    click: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    style: {},
    setAttribute: jest.fn(),
    getAttribute: jest.fn()
  })),
  body: {
    appendChild: jest.fn(),
    removeChild: jest.fn()
  },
  head: {
    appendChild: jest.fn(),
    removeChild: jest.fn()
  }
};

// Prevent jsdom from attempting real network requests via XMLHttpRequest during unit tests.
// Some codepaths (e.g. service health checks) may use XHR and generate noisy ECONNREFUSED logs.
// We stub XHR to a minimal in-memory implementation.
class MockXMLHttpRequest {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.responseText = '';
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this._listeners = new Map();
    this._request = { method: null, url: null };
  }

  open(method, url) {
    this._request = { method, url };
    this.readyState = 1;
  }

  addEventListener(type, handler) {
    const list = this._listeners.get(type) || [];
    list.push(handler);
    this._listeners.set(type, list);
  }

  removeEventListener(type, handler) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(
      type,
      list.filter((h) => h !== handler)
    );
  }

  _emit(type) {
    const list = this._listeners.get(type) || [];
    list.forEach((h) => {
      try {
        h.call(this);
      } catch {
        // ignore listener errors in tests
      }
    });
  }

  send() {
    // Simulate an immediate successful response.
    this.readyState = 4;
    this.status = 200;
    this.responseText = '{}';
    if (typeof this.onreadystatechange === 'function') this.onreadystatechange();
    if (typeof this.onload === 'function') this.onload();
    this._emit('readystatechange');
    this._emit('load');
  }
}

global.XMLHttpRequest = MockXMLHttpRequest;
if (global.window) {
  global.window.XMLHttpRequest = MockXMLHttpRequest;
}

// Mock Element constructor that officeparser checks for
global.Element =
  global.Element ||
  class Element {
    constructor() {
      this.style = {};
      this.children = [];
    }

    appendChild() {}
    removeChild() {}
    addEventListener() {}
    removeEventListener() {}
    setAttribute() {}
    getAttribute() {
      return null;
    }
  };

// Mock console methods to reduce test noise
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  // Suppress specific warnings we know about
  warn: jest.fn((message) => {
    if (typeof message === 'string' && message.includes('pdfjs')) return;
    originalConsole.warn(message);
  }),
  error: jest.fn((message) => {
    if (typeof message === 'string' && message.includes('pdfjs')) return;
    originalConsole.error(message);
  })
};

// Mock fetch for any network-dependent packages
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
    blob: () => Promise.resolve(new Blob())
  })
);
