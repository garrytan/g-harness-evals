# Reproduce and inspect: 2026-11-20-h10-rule-placement-rerun

The [report](report.md) stays as published; the data behind it is linked here.

<!-- data-archive:start (generated from docs/archive/index.json by scripts/archive/raw.ts link) -->
## Data archive

- **Raw trial data (private):** [2026-11-20-h10-rule-placement-rerun.manifest.json](https://github.com/garrytan/harness-evals/releases/download/raw-2026-11-20-h10-rule-placement-rerun/2026-11-20-h10-rule-placement-rerun.manifest.json), sha256 `4135f08a7d6eb54524a9c8d12597ced3f9809697c3f3402261a38a57132d7a32`. 35,670 files, 57.3 MB compressed in 1 part, covering folder: run/ the six counted shards (cx, he, oc, cc-cli, cc-sdk, qm) with trials, smoke, proxy logs, ledgers and fan-out logs; pilot/ the 36-trial pilot; the set-aside first OpenClaw launch and first pilot launch. Keys, tokens, sealed material and personal data were stripped before upload; the manifest lists what was removed. Private because raw transcripts carry the harness vendors' own system prompts, task text and simulated-world credentials, which are not ours to publish.
- Format and how to check a download: [raw-archive.md](../../raw-archive.md).

<!-- data-archive:end -->

## Rebuild the numbers (keyless)

- `bun run verify --run 2026-11-20-h10-rule-placement-rerun` reruns the scorer and `report-extras.ts` on the committed receipts and compares them with the published files. It needs the full checkout: the public copy leaves out the ledgers, proxy usage and VM records it reads, so there it reports the run as not rebuildable (recipe: [scripts/verify/runs/2026-11-20-h10-rule-placement-rerun.json](../../../scripts/verify/runs/2026-11-20-h10-rule-placement-rerun.json)).
- By hand: `bun scripts/instruction-followed-h10.ts --results docs/benchmarks/2026-11-20-h10-rule-placement-rerun/results --prereg docs/benchmarks/2026-11-20-h10-rule-placement-rerun/prereg.json --out docs/benchmarks/2026-11-20-h10-rule-placement-rerun/results`, then `bun docs/benchmarks/2026-11-20-h10-rule-placement-rerun/report-extras.ts --check`.

## Rerun the trials (paid)

Each shard ran through `scripts/ubicloud/fanout.sh` from commit `249cb8ec` with `--timeout-hours 4 --gbrain-image harness-eval/gbrain:ae4bef02 --smoke-task sy-01-quarrendon-ticket-numbers --smoke-lease-usd <smoke lease> --pre-smoke scripts/matrix/clean-arm-preflight.sh -- --max-output-tokens 128000` and the leases in [AMENDMENTS.md](AMENDMENTS.md) (2026-11-24). The shards were merged with `bun scripts/merge-shards.ts --out <dir> --shard cx=<dir> --shard he=<dir> --shard oc=<dir> --shard cc-cli=<dir> --shard cc-sdk=<dir> --shard qm=<dir>`.
