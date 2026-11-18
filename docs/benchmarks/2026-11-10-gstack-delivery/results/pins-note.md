# Note on main's later changes to files this run pins

**Dated 2026-11-15, moved here from the frontier model shootout's PR (#469); addendum dated 2026-11-17.**

The frontier model shootout (#469) changed 10 files under `scripts/frontier-harbor/` that this run's `pins.sha256` pins: `agents.py`, `broker.ts`, the two egress blocklists, `frontier_settings.py`, `gstack-exposure.ts`, `pin.json`, `plan.ts`, `to-trials.ts` and `vm-run.sh`. Two more PRs re-pinned `to-trials.ts` in main's copy of `pins.sha256`:

- #467 re-hashed the `to-trials.ts` line when it changed how a finished trial's cost is recorded.
- #472 re-pinned `to-trials.ts` again when it closed small gaps in shard smoke retries and trial cost recording.

**None of these changes reached this run's trials.** Every shard ran from a worktree pinned at one commit on branch `gstack-delivery-amendment-1`, never main: `fanout.sh` passes `--commit` to each shard, and `vm-shard.sh` runs `git checkout --detach <commit>` on the VM and builds the run images there.

**Addendum, 2026-11-17: the commits the run loaded.** The 2026-11-15 note named `d81fad5b05fd` as the run commit. The counted shards ran at three later commits on the same branch:

- `b543fa4d4f78`: 34 shards.
- `4fd6a2e49914`: 7 re-costed hook and placebo shards.
- `dc429809395e`: opus-hermes-hook and particle-hermes-hook.

`docs/benchmarks/preregistrations.d/gstack-delivery.json` names all three in `run_commit.amendments`. Since #468, CI checks the pins at the latest one (`dc429809395e`), and this folder's `pins.sha256` is that commit's copy. The results land with a merge commit, so all three commits stay on main.

