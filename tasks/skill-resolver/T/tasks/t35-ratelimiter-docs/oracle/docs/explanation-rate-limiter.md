# Why the gateway rate limiter is a per-process token bucket

## The problem

The gateway has to stop one API key from flooding the relay workers, while still letting a client send a short burst after being idle.

## The approach

Each key gets a `TokenBucket`: it holds up to `burst` tokens and refills at `ratePerSec`. A request takes one token or gets a 429. Buckets live in a `Map` in process memory, so there is no shared store to run.

## Trade-offs

- **Limits are per process.** With 4 replicas, a client can get up to 4 times the configured rate. Divide the rate by the replica count, or move buckets to a shared store.
- **`retry-after` is whole seconds**, rounded up, because the header takes seconds; a client may be told 1 s when 200 ms would do.
- **Memory grows with the number of keys**, since buckets are never evicted.

## Alternatives considered

- **Fixed window counters:** simpler, but allow double bursts at window edges.
- **A shared Redis bucket:** exact limits across replicas, at the cost of a network call per request and one more service.

## Related

- [Rate limiter reference](reference-rate-limiter.md)
