# Nightly invoice export: how we stop silent failures

**Problem:** The nightly invoice export can fail without anyone finding out before finance needs the files.

**Options:**

- **Option A: Keep cron, add a dead man's switch and a retry wrapper.**
  Pros: Smallest change; no new infrastructure; a missed or failed run pages ops within an hour.
  Cons: Still one VM; a reboot at the wrong time still delays the export until the retry.

- **Option B: Move the job to our existing CI scheduler.**
  Pros: Runs on fresh runners, has logs and failure notifications built in, no VM to patch.
  Cons: Needs the finance bucket credentials in CI; a 12-minute job uses scheduled CI minutes.

- **Option C: Rewrite as a queue-driven worker with per-customer retries.**
  Pros: One customer's failure no longer blocks the rest; every customer export is tracked.
  Cons: Most work by far; ops would run a queue they do not have time for this quarter.

**Recommendation:** Option A. Both failures were "it did not run or died and nobody knew", which a heartbeat check and one retry fix, and ops asked for no new infrastructure.

**Definition of Done:**
- A missed or failed 02:00 run pages the ops on-call by 03:00.
- A failed run retries once after 15 minutes before paging.
- The script cleans its own temp directory and checks free space first.
- One forced failure in staging shows the page and the retry.

**Implementation Plan:**
1. Wrap the export in a script that retries once and pings the heartbeat URL only on success.
2. Create the heartbeat check with a 60-minute grace period, routed to the ops on-call.
3. Point the job's temp files at its own directory and add a free-space check.
4. Force a failure in staging and confirm the page arrives.
