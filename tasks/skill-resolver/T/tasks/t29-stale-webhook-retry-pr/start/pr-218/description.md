# PR #218: Retry failed webhook deliveries with backoff

- Author: dana-k (outside contributor, maintainer edits allowed)
- Opened: 2026-06-03
- Base: main
- Head: dana-k:webhook-retries (2 commits)
- Reviews: one approval from Marco on 2026-06-10 ("looks right, needs a rebase before merge"), then no activity

## Description

Right now a webhook delivery that gets a 5xx or a connection error is logged and dropped.
Customers miss order.created events whenever their endpoint has a blip.

This PR wraps the HTTP call in `deliver()` (src/webhooks/sender.py) with up to 3 attempts,
backing off 1s, 2s and 4s between them. A 4xx response is not retried. Tests in
tests/test_sender.py cover a 503 that recovers on the second try and a 400 that is not retried.
