# relay goroutine leak

- relay consumes jobs from the queue and forwards them to the billing webhook. Go 1.23, one binary (cmd/relay).
- Since v0.9.0 (2026-10-21) goroutine count climbs about 40 per minute under normal traffic and never comes down;
  the pod is OOM-killed after about 30 hours.
- pprof goroutine dump after 2 hours: 4,812 goroutines, 4,790 of them parked at
  queue.(*Consumer).handle -> select in internal/queue/consumer.go:41.
- v0.9.0 added the per-message ack timeout in consumer.go.
- What I tried: raising the acks channel buffer from 16 to 256 (slower climb, same leak); adding a
  context.WithTimeout around Forward (no change).
- Log line seen every few seconds: "relay: ack timeout for msg 7f3a... after 5s".
- Constraints: keep the Consumer API used by cmd/relay; no new dependencies.
- Build and test: go build ./... and go test ./internal/queue/...
