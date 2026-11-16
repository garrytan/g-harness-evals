# Amendment 3 (2026-11-15 UTC): leave each gstack runtime out of the results mirror, and retry a smoke whose agent setup timed out

Committed before any counted trial of run `fable-diagnosis-2026-11`. The trials run from the commit that adds this file, not from amendment 2's 790160a6.

**Why:** a sibling run's pre-smoke found that the results mirror (`run-shard.sh --replicate-to`) copied each host's whole installed gstack runtime from the keyless install check, about 3.5 GB per shard. The drive mount also refused its node_modules hard links. Amendment 2's exclude covered only that runtime's test directory. Our own pre-smoke also saw the Hermes install hang until Harbor's AgentSetupTimeoutError. That is a network stall, but it fails the smoke, and a failed smoke ends a shard before its first trial. No paid trial has run.

**What changed:** this ports the same two fixes the sibling run took (its commit d81fad5b):
- `scripts/ubicloud/run-shard.sh` leaves out `smoke/results/gstack/agents/run/gstack/*/runtime` and `results/gstack/agents/run/gstack/*/runtime` from the mirror. The local pull still keeps them, and key-shaped text anywhere else still stops the mirror.
- `scripts/ubicloud/vm-shard.sh` retries the keyless smoke only when it ended in AgentSetupTimeoutError, up to 4 tries with backoff, starting each retry from an empty results directory. Any other smoke failure still ends the shard.
- Tests: `tests/ubicloud-lane-retry.test.ts` and `tests/ubicloud-mirror-smoke-edition.test.ts`, as in d81fad5b.

No task, label, cell, lease, cap, setting, pin or analysis script changes, and counted trials run exactly as before.
