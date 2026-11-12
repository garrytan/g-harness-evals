# What changed on main since PR #218 was opened

Pulled from `git log origin/main --since 2026-06-03` and CHANGELOG.md.

## CHANGELOG entries

### 1.14.0 (2026-07-22)
- Webhook sending moved out of the request path: `src/webhooks/worker.py` now pulls jobs from the
  `webhook_jobs` table and calls the sender. Request handlers only enqueue.
- `sender.deliver()` renamed to `sender.send_once()`; it still makes exactly one HTTP attempt and
  returns True or False. The worker marks the job `failed` on False.

### 1.15.0 (2026-09-09)
- Delivery log page in the dashboard shows every attempt per job.
- Known gap: failed webhook jobs are not retried yet (tracked in #218).

### 1.16.2 (2026-10-28)
- The worker processes jobs with a pool of 8 threads.

## Commits touching src/webhooks/ or tests/test_sender.py

- 4c1e9a2 Move webhook delivery into worker (renames deliver -> send_once)
- 9b07d11 tests: rename test_deliver_success -> test_send_once_success
- e52f3c8 Worker: thread pool of 8
