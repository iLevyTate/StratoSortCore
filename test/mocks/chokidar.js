/**
 * Mock for chokidar file watcher
 *
 * Provides a mock implementation for testing file watcher behavior.
 */

const EventEmitter = require('events');

class MockWatcher extends EventEmitter {
  constructor() {
    super();
    this.watching = new Set();
    this.closed = false;
  }

  add(paths) {
    if (Array.isArray(paths)) {
      paths.forEach((p) => this.watching.add(p));
    } else {
      this.watching.add(paths);
    }
    return this;
  }

  unwatch(paths) {
    if (Array.isArray(paths)) {
      paths.forEach((p) => this.watching.delete(p));
    } else {
      this.watching.delete(paths);
    }
    return this;
  }

  close() {
    this.closed = true;
    this.removeAllListeners();
    return Promise.resolve();
  }

  getWatched() {
    return Array.from(this.watching);
  }

  // Helper to simulate file events
  simulateAdd(filePath) {
    if (!this.closed) {
      this.emit('add', filePath);
    }
  }

  simulateChange(filePath) {
    if (!this.closed) {
      this.emit('change', filePath);
    }
  }

  simulateUnlink(filePath) {
    if (!this.closed) {
      this.emit('unlink', filePath);
    }
  }

  simulateError(error) {
    if (!this.closed) {
      this.emit('error', error);
    }
  }

  simulateReady() {
    if (!this.closed) {
      this.emit('ready');
    }
  }
}

// Store the last created watcher for testing
let lastWatcher = null;

// eslint-disable-next-line no-unused-vars
const watch = jest.fn((paths, options) => {
  lastWatcher = new MockWatcher();
  lastWatcher.add(paths);

  // Simulate ready event asynchronously
  setImmediate(() => {
    if (!lastWatcher.closed) {
      lastWatcher.emit('ready');
    }
  });

  return lastWatcher;
});

// Helper to get the last created watcher
const getLastWatcher = () => lastWatcher;

// Helper to reset the mock
const reset = () => {
  if (lastWatcher) {
    lastWatcher.close();
    lastWatcher = null;
  }
  watch.mockClear();
};

module.exports = {
  watch,
  getLastWatcher,
  reset,
  MockWatcher
};
