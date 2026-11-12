# PR #218 (webhook retries): is it still worth landing?

**Verdict: MODERNIZE**

| Verdict | Meaning | Next |
|---|---|---|
| **MODERNIZE** | The claim still holds; the change is right on today's main after a rebase with a mechanical fix. | Rebase, prove nothing was lost, push with a lease pinned to the observed head. |

## The PR as a claim

1. **Problem:** a webhook delivery that hits a 5xx or a connection error is dropped after one attempt, so customers miss events when their endpoint blips.
2. **Change:** retry the HTTP call up to 3 more times with 1s, 2s and 4s backoff, never retrying a 4xx.
3. **What would have to be true** of the codebase for this to be the right change: delivery still makes a single attempt with no retry anywhere else, and the function the PR wraps is still the place that owns one delivery.

## What moved under it

- **Textual:** `deliver()` was renamed to `send_once()` in 4c1e9a2, and `test_deliver_success` became `test_send_once_success` in 9b07d11. Both files the PR touches conflict.
- **Conceptual:** delivery now runs in `src/webhooks/worker.py` from the `webhook_jobs` table, but `send_once()` still makes exactly one attempt and the worker just marks the job failed. The 1.15.0 CHANGELOG still lists "failed webhook jobs are not retried yet (tracked in #218)". So the problem is open and nothing on main solves it another way.
- **One thing to fix on the rebase:** the worker runs 8 threads (e52f3c8). Sleeping up to 7s inside a worker thread holds one of 8 slots, which is acceptable for a first version, but worth one line in the PR body. The retry loop belongs inside `send_once()`'s caller or a new `send_with_retry()` that the worker calls, keeping `send_once()` a single attempt as its name says.

## Next step (not done yet)

Nothing has been pushed. With a go-ahead: rebase onto origin/main keeping Dana's two commits as hers, add a separate commit for the rename to `send_once` and the test rename, check `git range-diff` so every changed hunk has a one-line explanation, run tests/test_sender.py, then push with `--force-with-lease=webhook-retries:<observed head sha>`.

Credit: the change is Dana's (dana-k); Marco approved it in June.
