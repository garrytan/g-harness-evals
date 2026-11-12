import { TokenBucket, type BucketOptions } from './token-bucket.ts';

export type KeyFn = (req: { headers: Record<string, string | undefined>; ip: string }) => string;

/** One bucket per key (default: the x-api-key header, falling back to the client IP). Buckets live in process memory. */
export function rateLimit(opts: BucketOptions & { key?: KeyFn }) {
  const buckets = new Map<string, TokenBucket>();
  const key: KeyFn = opts.key ?? ((req) => req.headers['x-api-key'] ?? req.ip);
  return (req: any, res: any, next: () => void) => {
    const k = key(req);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = new TokenBucket(opts)));
    if (b.tryTake()) return next();
    res.statusCode = 429;
    res.setHeader('retry-after', String(Math.ceil(b.retryAfterMs() / 1000)));
    res.end('rate limited');
  };
}
