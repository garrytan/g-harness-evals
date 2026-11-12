# Help wanted: goroutine leak in a Go queue consumer

## Context

relay is a Go 1.23 service that reads jobs from a channel and forwards them to a billing webhook. Each message is handled in its own goroutine with a per-message ack timeout, which was added in v0.9.0. It is built with go build ./... and tested with go test ./internal/queue/....

## Problem

Since v0.9.0 the number of goroutines grows by about 40 per minute and never drops. The pod gets OOM-killed after roughly 30 hours.

- pprof after 2 hours: 4,812 goroutines, 4,790 parked at queue.(*Consumer).handle in a select at internal/queue/consumer.go:41.
- The log shows "relay: ack timeout for msg 7f3a... after 5s" every few seconds.

## What I have tried

- Increasing the acks channel buffer from 16 to 256: the leak slows but does not stop.
- Adding context.WithTimeout around Forward: no effect.

## Constraints

- Keep the Consumer API used by cmd/relay.
- No new dependencies.

## What I want back

1. The root cause, with the exact lines involved.
2. A minimal patch.
3. A test that would have caught it.

The attached files follow this prompt.
