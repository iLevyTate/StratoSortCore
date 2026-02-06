/**
 * CJS-compatible mock for p-queue (ESM-only since v7).
 *
 * p-queue is used for concurrency-limited task queuing.
 * This mock provides the same interface so tests that transitively
 * import parallelProcessor.js or ModelAccessCoordinator.js don't
 * fail with "Cannot use import statement outside a module".
 */

class PQueue {
  constructor(opts = {}) {
    this.concurrency = opts.concurrency || Infinity;
    this._pending = 0;
    this._queue = [];
    this.size = 0;
  }

  async add(fn, _opts) {
    this.size++;
    this._pending++;
    try {
      return await fn();
    } finally {
      this._pending--;
      this.size = Math.max(0, this.size - 1);
    }
  }

  async addAll(fns, opts) {
    return Promise.all(fns.map((fn) => this.add(fn, opts)));
  }

  async onIdle() {
    return Promise.resolve();
  }

  async onEmpty() {
    return Promise.resolve();
  }

  async onSizeLessThan(limit) {
    return Promise.resolve();
  }

  get pending() {
    return this._pending;
  }

  clear() {
    this._queue = [];
    this.size = 0;
  }

  pause() {}
  start() {}
}

// p-queue v7+ is ESM, so require('p-queue').default is the common CJS interop pattern
module.exports = { default: PQueue };
