# The rules-at-scale Ubicloud lane

Run rules-at-scale shards on Ubicloud VMs with these two commands. They use the shared lane in [scripts/ubicloud/](../../ubicloud/), and nothing in it is edited.

- `fanout.sh --manifest <fanout.json> ...` launches every shard of a plan. The manifest is the one `plan.ts plan --manifest` writes.
- `run-shard.sh --attach --dest <dest>/<shard>` rejoins a shard whose controller died. Use it for `--resume` too. Without it, the pull, the mirror and the teardown would treat the shard as a harness shard.

Both take every flag of the matching `scripts/ubicloud/` command except `--workload`, which is always `rules-at-scale` here. [docs/ubicloud.md](../../../docs/ubicloud.md) covers the keys, the quota, the TTL, `--replicate-to` and the VM cleanup.

## What a shard does

1. **Keyless smoke.** `scripts/rules-at-scale/run-shard.sh --smoke --fake-upstream` runs with every key unset: one trial of the shard behind the fake model, with no spend. If it fails, or its row has an infra code, the shard stops with exit 4 and the counted run never starts.
2. **Counted run.** `run-shard.sh` runs the shard under its lease, with `--out ~/shard/results` and the arguments after `--`.
3. **Mirror.** `--replicate-to` copies the shard while it runs. The copy leaves out `proxy-capture/` and both Harbor job trees (`results/run` and `smoke/results/run`), which would not fit a Capy drive. The pull into `--dest` still brings them back.
4. **Mid-run pulls** skip the files a running Harbor trial still owns, instead of failing. A later pull picks them up.
5. **Stopping a shard** waits up to 240 s for `run-shard.sh` to drain its meter and write `rules-trials.jsonl` and `shard.json`.
6. **At the end**, `fanout.sh` prints the results directories. `merge-shards.ts` doesn't read `rules-trials.jsonl`, so read those directories with `analyze.ts`.

## How it is built

`scripts/ubicloud/fanout.sh`, `run-shard.sh` and `vm-shard.sh` can't be edited while the harness shootout runs. None of their workloads can start `scripts/rules-at-scale/run-shard.sh`:

- **The harness workload** always runs `scripts/run-shard.sh`, and builds its smoke from `tasks/multiuser`. Its `--pre-smoke` hook runs before the keys reach the VM, so it can't run our smoke's proxy either.
- **The frontier-harbor workload** always runs `scripts/frontier-harbor/vm-run.sh`, which the frontier preregistration pins. Its controller also refuses an `openai:` cell without a zero-data-retention check from a frontier install check.

So `lane.py` builds the lane from those three files as they stand in this checkout:

- **The three files** are copied into a lane directory and patched (the list is in `lane.py`). The patches add the `rules-at-scale` workload, splice [vm-rules-at-scale.sh](vm-rules-at-scale.sh) into `vm-shard.sh` after the checkout, and fix the repository root, since the lane directory sits outside the repository.
- **Every other file** in `scripts/ubicloud/` is a symlink: the runner, the bootstrap, the keys list and the rest.
- **The lane directory** is `~/.cache/rules-at-scale-ubicloud/<key>` (`RAS_LANE_ROOT` or `XDG_CACHE_HOME` move it). The key is a hash of the patched files, so an unchanged checkout reuses the directory.
- **If `scripts/ubicloud/` changes** so that a patch no longer matches, `lane.py` stops with exit 2, names the patch, and no VM is created. Update the patch in `lane.py`. `tests/rules-at-scale-ubicloud.test.ts` checks that every patch applies to the current files.

`vm-rules-at-scale.sh` runs on the VM as part of `vm-shard.sh`. It is uploaded from the controller's checkout, as `vm-shard.sh` itself is, and the shard's own scripts come from the pinned commit.
