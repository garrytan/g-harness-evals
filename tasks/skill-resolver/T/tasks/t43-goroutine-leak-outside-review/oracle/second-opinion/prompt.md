# relay: goroutine leak in the queue consumer

## Project briefing

relay is a small Go 1.23 service (module github.com/harbor/relay, one binary in cmd/relay). It reads jobs from a queue channel and forwards each one to a billing webhook through a Forwarder interface, with a per-message ack timeout added in v0.9.0. It runs as one Kubernetes pod. Build with go build ./..., test with go test ./internal/queue/.... No new dependencies are allowed.

## Where things live

- internal/queue/consumer.go: Consumer, Run (the receive loop) and handle (one goroutine per message, with the ack timeout). This is where the leak is.
- internal/queue/consumer_test.go: the only test; it does not check goroutine counts.
- cmd/relay/main.go: wires Consumer to the webhook Forwarder; shows how the public API is used.

## The question

Since v0.9.0 the goroutine count climbs about 40 per minute and never comes down; the pod is OOM-killed after about 30 hours. Why do these goroutines never exit, and what is the smallest correct fix?

Evidence, verbatim:
- pprof goroutine dump after 2 hours: 4,812 goroutines, 4,790 parked at queue.(*Consumer).handle -> select in internal/queue/consumer.go:41.
- Log line every few seconds: "relay: ack timeout for msg 7f3a... after 5s".

What I tried:
- Raising the acks channel buffer from 16 to 256: slower climb, same leak.
- Wrapping Forward in context.WithTimeout: no change.

## Constraints

- Keep the Consumer API that cmd/relay uses (In, Fwd, Timeout, Run).
- No new dependencies.
- Do not change the webhook Forwarder.

## Desired output

1. The root cause, pointing at exact lines, including every goroutine that can block forever (handle, the Forward goroutine, sends on acks).
2. A patch to consumer.go.
3. A test that fails on the current code by showing goroutine growth and passes after the fix.
