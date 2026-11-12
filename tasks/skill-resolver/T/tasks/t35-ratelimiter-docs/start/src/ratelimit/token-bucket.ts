export interface BucketOptions {
  /** Tokens added per second. */
  ratePerSec: number;
  /** Maximum tokens the bucket holds; also the largest burst allowed. */
  burst: number;
  /** Clock in ms, injectable for tests. Defaults to Date.now. */
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly now: () => number;

  constructor(private readonly opts: BucketOptions) {
    if (opts.ratePerSec <= 0) throw new RangeError('ratePerSec must be > 0');
    if (opts.burst < 1) throw new RangeError('burst must be >= 1');
    this.now = opts.now ?? Date.now;
    this.tokens = opts.burst;
    this.last = this.now();
  }

  /** Takes `cost` tokens if available. Returns false (and takes nothing) otherwise. */
  tryTake(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.opts.burst, this.tokens + ((t - this.last) / 1000) * this.opts.ratePerSec);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Milliseconds until `cost` tokens will be available. */
  retryAfterMs(cost = 1): number {
    const missing = Math.max(0, cost - this.tokens);
    return Math.ceil((missing / this.opts.ratePerSec) * 1000);
  }
}
