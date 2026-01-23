/**
 * IPC Rate Limiter
 *
 * Encapsulates per-channel rate limiting and cleanup.
 */

class IpcRateLimiter {
  constructor({ maxRequestsPerSecond, perfLimits }) {
    this.rateLimiter = new Map();
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.perfLimits = perfLimits;
    this._cleanupScheduled = false;
  }

  /**
   * Rate limiting to prevent IPC abuse
   * Fixed: Add cleanup to prevent memory leaks
   */
  checkRateLimit(channel) {
    const now = Date.now();
    const channelData = this.rateLimiter.get(channel) || {
      count: 0,
      resetTime: now + 1000
    };

    if (now > channelData.resetTime) {
      channelData.count = 1;
      channelData.resetTime = now + 1000;
    } else {
      channelData.count++;
    }

    this.rateLimiter.set(channel, channelData);

    // Schedule cleanup asynchronously to prevent race conditions
    if (
      this.rateLimiter.size > this.perfLimits.RATE_LIMIT_CLEANUP_THRESHOLD &&
      !this._cleanupScheduled
    ) {
      this._cleanupScheduled = true;
      setTimeout(() => {
        this._cleanupRateLimiter();
        this._cleanupScheduled = false;
      }, 0);
    }

    if (channelData.count > this.maxRequestsPerSecond) {
      const resetIn = Math.ceil((channelData.resetTime - now) / 1000);
      throw new Error(
        `Rate limit exceeded for channel: ${channel}. Please wait ${resetIn}s before retrying. Consider reducing concurrent requests.`
      );
    }

    return true;
  }

  /**
   * Separate cleanup method to avoid inline iteration during rate limit checks
   */
  _cleanupRateLimiter() {
    const now = Date.now();
    const staleEntries = [];
    for (const [ch, data] of this.rateLimiter.entries()) {
      if (now > data.resetTime + this.perfLimits.RATE_LIMIT_STALE_MS) {
        staleEntries.push(ch);
      }
    }
    staleEntries.forEach((ch) => this.rateLimiter.delete(ch));
  }
}

module.exports = {
  IpcRateLimiter
};
