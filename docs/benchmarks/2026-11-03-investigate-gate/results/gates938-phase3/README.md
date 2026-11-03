# gates938-phase3 results

Files for [../../report.md](../../report.md). Run id `gates938-phase3`, 22 plan shards plus two never-started-trial shards (`p3-opus-02r`, `p3-sol-06r`).

In this folder:

- `trials.jsonl`: every trial record that came back, 163 rows from 22 shard directories, concatenated in shard-name order. Each row's `counted` field says whether it counts.
- `results.json`, `table.md`: output of `phase3-analyze.py`.
- `infra-reaped.json`, `infra-lease.json`: 17 planned-trial records: the 13 INFRA trials lost with two reaped VMs, which have no row in `trials.jsonl`, and the 4 never-started trials, which do have rows from the shards they later ran in (named in each record).
- `mdd.json`: bootstrap standard deviation, minimum detectable difference and the KEEP threshold arithmetic, from `trials.jsonl` alone.

On the unmerged scratch branch `harn14/gates-938` at [`07312a7ed`](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-results/), kept out of this pull request to keep it inside the reviewer's size limit (sha256 in brackets):

- [`phase3-analyze.py`](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-analyze.py) (`a07f277e…`): the analysis that wrote `results.json` and `table.md`.
- [`audit.json`](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-results/audit.json) (`5cbf15f9…`): `scripts/gates-938/audit.ts` over every session (N contamination).
- [`reconcile-sol.csv`](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-results/reconcile-sol.csv) (`5b813f2d…`): `scripts/gates-938/reconcile.ts` over every OpenRouter (Sol) request, 3,471 rows, all ok.
- [`mdd.py`](https://github.com/garrytan/harness-evals/blob/07312a7ed46faa2fd9d20ba40057a865d6c20ee3/scripts/gates-938/phase3-results/mdd.py) (`2e0bb159…`): writes `mdd.json`.

If the scratch branch goes away, these four files are kept in the Captain drive at handoffs/internal-task/gates-938/evidence/phase3/, with the sha256s above, and can be republished on request.

## Rerunning

`mdd.py` reads the `trials.jsonl` beside it. From a checkout of `harn14/gates-938` at `07312a7ed`: `cd scripts/gates-938/phase3-results && python3 mdd.py > mdd.json`.

`phase3-analyze.py` needs the per-trial recorder and gate-state files, which are not committed. They sit in the shard directories on internal-task's machine and are copied to the Captain drive under handoffs/internal-task/gates-938/evidence/phase3/shards/<shard>/out/trials/. With those in place, from `scripts/gates-938/` at `07312a7ed`:

```
python3 phase3-analyze.py --results <dir of shard dirs> --gate-src <garrytan/gstack checkout at f5a7cce> \
  --audit phase3-results/audit.json --infra-extra phase3-results/infra-reaped.json --infra-extra phase3-results/infra-lease.json \
  --out <out dir> --resamples 10000 --seed 938
```

It runs `scripts/investigate-gate/score.ts` from the gate checkout once per session (with `--gate-state` for H), then the bootstrap.
