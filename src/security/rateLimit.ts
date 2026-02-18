type Bucket = {
  tokens: number;
  lastRefillMs: number;
};

/**
 * Token bucket per connection — lazy refill (no timers, no memory leaks).
 * Thread-safe for single-process Node.js (event loop is single-threaded).
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillTokens: number;
  private readonly refillEveryMs: number;
  private state: Bucket;

  constructor(opts: { capacity: number; refillTokens: number; refillEveryMs: number }) {
    this.capacity = opts.capacity;
    this.refillTokens = opts.refillTokens;
    this.refillEveryMs = opts.refillEveryMs;
    this.state = { tokens: opts.capacity, lastRefillMs: Date.now() };
  }

  take(tokens: number): boolean {
    this.refill();
    if (tokens <= 0) return true;
    if (this.state.tokens < tokens) return false;
    this.state.tokens -= tokens;
    return true;
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.state.lastRefillMs;
    if (elapsed <= 0) return;
    const periods = Math.floor(elapsed / this.refillEveryMs);
    if (periods <= 0) return;
    const add = periods * this.refillTokens;
    this.state.tokens = Math.min(this.capacity, this.state.tokens + add);
    this.state.lastRefillMs += periods * this.refillEveryMs;
  }
}

/**
 * Per-IP WebSocket connection limiter.
 * Prevents a single IP from opening too many connections.
 */
export class IpConnectionLimiter {
  private readonly maxPerIp: number;
  private readonly counts = new Map<string, number>();

  constructor(maxPerIp: number) {
    this.maxPerIp = maxPerIp;
  }

  tryInc(ip: string): boolean {
    const cur = this.counts.get(ip) ?? 0;
    if (cur >= this.maxPerIp) return false;
    this.counts.set(ip, cur + 1);
    return true;
  }

  dec(ip: string) {
    const cur = this.counts.get(ip) ?? 0;
    if (cur <= 1) this.counts.delete(ip);
    else this.counts.set(ip, cur - 1);
  }

  getCount(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }
}

/**
 * Global WebSocket connection cap.
 * Hard ceiling across all IPs — prevents memory exhaustion under DDoS.
 */
export class GlobalConnectionLimiter {
  private count = 0;

  constructor(private readonly max: number) { }

  tryInc(): boolean {
    if (this.count >= this.max) return false;
    this.count++;
    return true;
  }

  dec() {
    if (this.count > 0) this.count--;
  }

  get current() {
    return this.count;
  }
}

/**
 * Sliding-window HTTP rate limiter per IP.
 * Cleans up stale entries automatically to avoid memory growth.
 */
export class HttpRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: NodeJS.Timeout;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {
    // Cleanup every 2 windows to avoid unbounded memory growth
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs * 2).unref();
  }

  check(ip: string): boolean {
    const now = Date.now();
    const entry = this.windows.get(ip);

    if (!entry || now > entry.resetAt) {
      this.windows.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.maxRequests) return false;
    entry.count++;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.windows) {
      if (now > entry.resetAt) this.windows.delete(ip);
    }
  }

  destroy() {
    clearInterval(this.cleanupTimer);
  }
}
