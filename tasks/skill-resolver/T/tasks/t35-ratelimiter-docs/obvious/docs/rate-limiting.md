# Rate limiting

The gateway limits requests per client with a token bucket (`src/ratelimit/`).

## How it works

Every client key gets its own `TokenBucket`. The bucket holds up to `burst` tokens and refills at `ratePerSec` tokens per second. Each request takes one token; when the bucket is empty the gateway answers `429` with a `retry-after` header.

The key is the `x-api-key` header, or the client IP when there is no key.

## Configuration

In `config/gateway.yaml`:

```yaml
rateLimit:
  ratePerSec: 5   # tokens added per second (0.5 = one request every 2 s)
  burst: 20       # bucket size, the largest burst; must be at least 1
```

| Option | Required | Notes |
|---|---|---|
| `ratePerSec` | yes | must be > 0 |
| `burst` | yes | must be >= 1; `0` makes the gateway fail at startup |

## Things that surprise people

- **Limits are per process.** Buckets live in memory, so with 4 replicas a client can get 4x the configured rate. Divide `ratePerSec` by the number of replicas.
- **`retry-after` is in whole seconds**, rounded up, so it may say 1 when 200 ms would be enough.
- **There is no way to turn bursting off** other than `burst: 1`.

## API

- `new TokenBucket({ ratePerSec, burst, now? })`: throws `RangeError` on invalid options.
- `tryTake(cost = 1)`: takes tokens if available, returns `true`/`false`.
- `retryAfterMs(cost = 1)`: milliseconds until enough tokens are available.
- `rateLimit(opts)`: middleware; pass `key` to change what a bucket is per.
