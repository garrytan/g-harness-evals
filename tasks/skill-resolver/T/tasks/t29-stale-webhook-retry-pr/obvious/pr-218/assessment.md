# PR #218: retry failed webhook deliveries

## Summary

Dana's PR adds up to three retries with 1s/2s/4s backoff around the webhook HTTP call and skips retries on 4xx. It was approved in June but needs a rebase.

## Is the problem still there?

Yes. Main still makes one HTTP attempt per webhook job: `send_once()` returns False on a 5xx and the worker marks the job failed. The 1.15.0 changelog even lists "failed webhook jobs are not retried yet (tracked in #218)".

## What changed on main

- `deliver()` was renamed to `send_once()` (4c1e9a2) and the test was renamed (9b07d11), so the PR will conflict in both files.
- Delivery moved into a background worker with a pool of 8 threads (e52f3c8). Sleeping up to 7 seconds in a worker thread ties up one of the 8 threads, which is fine for now but worth watching.

## Recommendation

Rebase and merge. The fix is still needed and nothing on main replaces it. On the rebase:

1. Apply the retry loop around `send_once()` (or add a `send_with_retry()` the worker calls) instead of the old `deliver()`.
2. Update the new tests to the renamed function.
3. Run tests/test_sender.py and get a fresh review, since Marco's approval is on the old code.

Thanks to Dana for the original fix.
