# Rate limiter reference

Source: `src/ratelimit/token-bucket.ts`, `src/ratelimit/middleware.ts`.

## API / Interface

### `new TokenBucket(opts: BucketOptions)`

Throws `RangeError` when `ratePerSec <= 0` or `burst < 1`. The bucket starts full (`burst` tokens).

- `tryTake(cost = 1): boolean`: refills by elapsed time, then takes `cost` tokens if available. Returns `false` and takes nothing otherwise.
- `retryAfterMs(cost = 1): number`: milliseconds until `cost` tokens are available.

### `rateLimit(opts: BucketOptions & { key?: KeyFn })`

Middleware with one `TokenBucket` per key. Default key: the `x-api-key` header, else the client IP. On refusal it sends `429`, a `retry-after` header in whole seconds (rounded up), and the body `rate limited`.

## Options / Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `ratePerSec` | number > 0 | none | tokens added per second; 0.5 means one request every 2 s |
| `burst` | integer >= 1 | none | bucket size and largest burst; 0 is rejected at startup |
| `now` | () => number | `Date.now` | clock in ms, for tests |
| `key` | KeyFn | x-api-key, then IP | what one bucket is per |

Set in `config/gateway.yaml` under `rateLimit`.

## Examples

```yaml
rateLimit:
  ratePerSec: 5
  burst: 20
```

## Related

- [Why the limiter works this way](explanation-rate-limiter.md)
