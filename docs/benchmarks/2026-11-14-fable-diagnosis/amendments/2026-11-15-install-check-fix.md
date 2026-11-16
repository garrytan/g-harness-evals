# Amendment 2 (2026-11-15 UTC): run from the preregistration commit plus the install-check fix

Committed before any counted trial of run `fable-diagnosis-2026-11`. The trials run from the commit that adds this file, not from 5f981093337ae5be38b66a65790c57be1ee58e8b.

**Why:** the one-VM pre-smoke at 5f981093 failed the keyless frontier install check, and every counted frontier-harbor shard runs that check as its smoke. It failed for two reasons that don't touch this run's Claude Code cells. First, the Cursor cell's documented keyless stop always records `effort_flag: "unchecked"`, which the check counted as a failure. Second, the gstack check threw when a harness's `none` baseline trial had no captured request. The pre-smoke also found that the secret scan in run-shard.sh refused every results mirror for frontier-harbor shards. The cause was key-shaped test text inside the gstack install copy. No paid trial ran.

**What changed:** these three scripts are byte-identical to the reviewed fix in pull request #461 at ec3fc8a77fcfbfd8394bdceddc661efb9fa073e9:
- `scripts/frontier-harbor/install-check.sh`
- `scripts/frontier-harbor/gstack-check.ts`
- `scripts/ubicloud/run-shard.sh`

`scripts/frontier-harbor/README.md` carries #461's two documentation lines on top of this run's copy.

The commit holds nothing else beyond this file and amendment 1, which is docs only. No task, label, cell, lease, cap, setting, pin or analysis script changes, and no file pinned by sha256 in the plan files changes. Main's later changes, #381 included, are not in this run.
